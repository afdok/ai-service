/**
 * Fournisseur du modèle d'IA. L'application peut enregistrer une configuration (voir
 * `AiProviderResolver`) ; sans configuration enregistrée active, les variables
 * d'environnement ci-dessous prennent le relais ; sans elles, l'IA n'est pas disponible et
 * un message dit quoi fournir.
 *
 * Variables (relais) :
 * - `google` (défaut) : GOOGLE_GENERATIVE_AI_API_KEY (AI_MODEL facultatif) ;
 * - `azure_openai` : AZURE_API_KEY et AZURE_RESOURCE_NAME (ou AZURE_BASE_URL) ; AI_MODEL est
 *   le nom du déploiement ;
 * - `mistral` : MISTRAL_API_KEY et AI_MODEL ;
 * - `openai_compatible` : AI_BASE_URL et AI_MODEL (et AI_API_KEY si le serveur en demande
 *   une), pour un modèle hébergé chez le client (vLLM, Ollama…).
 *
 * Avec AI_ENABLED=false, l'IA est coupée pour ce déploiement, configuration enregistrée ou non.
 */
export type AiProvider =
  | 'google'
  | 'azure_openai'
  | 'mistral'
  | 'openai_compatible';

export const AI_PROVIDERS: readonly AiProvider[] = [
  'google',
  'azure_openai',
  'mistral',
  'openai_compatible',
];

export const DEFAULT_GOOGLE_MODEL = 'gemini-3.1-flash-lite';

/**
 * Connexion au fournisseur, quelle que soit sa source. Sans `apiKey` (relais par les
 * variables), le SDK lit la clé dans sa variable habituelle.
 */
export type AiConfig = {
  provider: AiProvider;
  model: string;
  apiKey?: string;
  resourceName?: string;
  baseURL?: string;
};

/** Configuration lue dans les variables, ou les variables qui manquent. */
export type EnvAiConfig = { config: AiConfig } | { missing: string[] };

type Env = NodeJS.ProcessEnv;

const read = (env: Env, name: string) => env[name]?.trim() || undefined;

export const isAiEnabled = (env: Env = process.env) =>
  read(env, 'AI_ENABLED') !== 'false';

/**
 * Le résumé audio envoie l'enregistrement tel quel : seul Gemini le comprend directement.
 * Les autres fournisseurs demandent une transcription préalable.
 */
export const supportsAudio = (config: AiConfig) => config.provider === 'google';

/** Configuration des variables d'environnement ; ne lève jamais d'erreur. */
export function envAiConfig(env: Env = process.env): EnvAiConfig {
  const value = read(env, 'AI_PROVIDER') ?? 'google';
  if (!AI_PROVIDERS.includes(value as AiProvider)) {
    return {
      missing: [`AI_PROVIDER (${AI_PROVIDERS.join(', ')} ; reçu : ${value})`],
    };
  }
  const provider = value as AiProvider;
  const missing = (names: string[]) => names.filter((name) => !read(env, name));
  const model = read(env, 'AI_MODEL');

  switch (provider) {
    case 'google': {
      const lacking = missing(['GOOGLE_GENERATIVE_AI_API_KEY']);
      if (lacking.length) return { missing: lacking };
      return { config: { provider, model: model ?? DEFAULT_GOOGLE_MODEL } };
    }
    case 'azure_openai': {
      const lacking = missing(['AZURE_API_KEY', 'AI_MODEL']);
      if (!read(env, 'AZURE_RESOURCE_NAME') && !read(env, 'AZURE_BASE_URL')) {
        lacking.push('AZURE_RESOURCE_NAME ou AZURE_BASE_URL');
      }
      if (lacking.length) return { missing: lacking };
      return {
        config: { provider, model: model!, baseURL: read(env, 'AZURE_BASE_URL') },
      };
    }
    case 'mistral': {
      const lacking = missing(['MISTRAL_API_KEY', 'AI_MODEL']);
      if (lacking.length) return { missing: lacking };
      return { config: { provider, model: model! } };
    }
    case 'openai_compatible': {
      const lacking = missing(['AI_BASE_URL', 'AI_MODEL']);
      if (lacking.length) return { missing: lacking };
      return {
        config: {
          provider,
          model: model!,
          baseURL: read(env, 'AI_BASE_URL'),
          apiKey: read(env, 'AI_API_KEY'),
        },
      };
    }
  }
}
