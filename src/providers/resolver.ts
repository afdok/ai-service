import type { LanguageModel } from 'ai';
import { AiError } from '../errors.js';
import { defaultTranslate, type Translate } from '../i18n.js';
import {
  envAiConfig,
  isAiEnabled,
  supportsAudio,
  type AiConfig,
} from './config.js';

/** Modèle d'une configuration ; les SDK des fournisseurs ne sont chargés qu'au premier appel. */
export async function buildModel(config: AiConfig): Promise<LanguageModel> {
  const { createModel } = await import('./model.js');
  return createModel(config);
}

/** Configuration enregistrée par l'application (base de données, fichier…). */
export type StoredAiConfig = {
  id: string;
  name: string;
  /** Lève une erreur si la clé API est illisible (clé de chiffrement changée…). */
  config: () => AiConfig;
};

/**
 * - READY : un fournisseur est utilisable, enregistré (STORED) ou des variables (ENV) ;
 * - DISABLED : AI_ENABLED=false, l'IA n'existe pas pour ce déploiement ;
 * - NOT_CONFIGURED : ni configuration active, ni variables ; `missing` liste les variables
 *   du relais qui manquent, `unreadableKey` signale une clé enregistrée illisible.
 */
export type AiStatus =
  | {
      state: 'READY';
      source: 'STORED' | 'ENV';
      config: AiConfig;
      configId: string | null;
      configName: string | null;
    }
  | { state: 'DISABLED' }
  | { state: 'NOT_CONFIGURED'; missing: string[]; unreadableKey: boolean };

export type AiProviderResolverOptions = {
  /** Configuration active enregistrée, ou null. Absente : variables d'environnement seules. */
  loadActive?: () => Promise<StoredAiConfig | null>;
  /** Durée du cache du statut (30 s par défaut). Plusieurs instances : délai de propagation. */
  cacheMs?: number;
  env?: NodeJS.ProcessEnv;
  translate?: Translate;
  /** Remplace la création du modèle (tests). */
  build?: (config: AiConfig) => Promise<LanguageModel>;
};

/** Ce que l'utilisateur doit faire quand l'IA n'est pas configurée. */
export function notConfiguredMessage(
  status: Extract<AiStatus, { state: 'NOT_CONFIGURED' }>,
  t: Translate = defaultTranslate,
): string {
  return status.unreadableKey
    ? t(
        "La clé API du fournisseur d'IA enregistré est illisible. Un administrateur doit la ressaisir, la tester puis réactiver la configuration.",
      )
    : t(
        "Aucun fournisseur d'IA n'est configuré. Un administrateur doit enregistrer une configuration (fournisseur, modèle et clé API), la tester puis l'activer.",
      );
}

/**
 * Fournisseur d'IA en vigueur : la configuration active enregistrée, sinon les variables
 * d'environnement, sinon aucun (message à afficher).
 */
export class AiProviderResolver {
  private cached?: { at: number; status: Promise<AiStatus> };
  private built?: { config: AiConfig; model: Promise<LanguageModel> };
  private readonly t: Translate;

  constructor(private readonly options: AiProviderResolverOptions = {}) {
    this.t = options.translate ?? defaultTranslate;
  }

  /** À appeler après toute modification des configurations enregistrées. */
  invalidate() {
    this.cached = undefined;
  }

  status(): Promise<AiStatus> {
    const cacheMs = this.options.cacheMs ?? 30_000;
    if (!this.cached || Date.now() - this.cached.at > cacheMs) {
      const status = this.load();
      this.cached = { at: Date.now(), status };
      // Source injoignable : on réessaiera au prochain appel.
      status.catch(() => {
        if (this.cached?.status === status) this.cached = undefined;
      });
    }
    return this.cached.status;
  }

  /** Lève AiError AI_DISABLED (404) ou AI_NOT_CONFIGURED (503) si l'IA n'est pas utilisable. */
  async assertAvailable(): Promise<Extract<AiStatus, { state: 'READY' }>> {
    const status = await this.status();
    if (status.state === 'DISABLED') {
      throw new AiError('AI_DISABLED', this.t("L'IA est désactivée."));
    }
    if (status.state === 'NOT_CONFIGURED') {
      throw new AiError('AI_NOT_CONFIGURED', notConfiguredMessage(status, this.t));
    }
    return status;
  }

  /** Modèle en vigueur, recréé seulement quand la configuration change. */
  async model(): Promise<LanguageModel> {
    const { config } = await this.assertAvailable();
    if (this.built?.config !== config) {
      const build = this.options.build ?? buildModel;
      this.built = { config, model: build(config) };
    }
    return this.built.model;
  }

  async isAudioSummaryAvailable(): Promise<boolean> {
    const status = await this.status();
    return status.state === 'READY' && supportsAudio(status.config);
  }

  /** Lève AiError AI_AUDIO_UNSUPPORTED (501) si le fournisseur ne comprend pas l'audio. */
  async assertAudioSummaryAvailable(): Promise<void> {
    if (!(await this.isAudioSummaryAvailable())) {
      throw new AiError(
        'AI_AUDIO_UNSUPPORTED',
        this.t(
          "Le résumé audio n'est pas disponible avec le fournisseur d'IA de ce déploiement.",
        ),
      );
    }
  }

  private async load(): Promise<AiStatus> {
    const env = this.options.env ?? process.env;
    if (!isAiEnabled(env)) return { state: 'DISABLED' };

    const active = (await this.options.loadActive?.()) ?? null;
    let unreadableKey = false;
    if (active) {
      try {
        return {
          state: 'READY',
          source: 'STORED',
          config: active.config(),
          configId: active.id,
          configName: active.name,
        };
      } catch {
        // Clé illisible : on tente le relais.
        unreadableKey = true;
      }
    }

    const fromEnv = envAiConfig(env);
    if ('config' in fromEnv) {
      return {
        state: 'READY',
        source: 'ENV',
        config: fromEnv.config,
        configId: null,
        configName: null,
      };
    }
    return { state: 'NOT_CONFIGURED', missing: fromEnv.missing, unreadableKey };
  }
}
