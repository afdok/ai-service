import { streamText, type LanguageModel } from 'ai';
import type { AiLogger } from '../i18n.js';
import {
  loadInstruction,
  responseLanguageInstruction,
} from '../instructions/instructions.js';
import {
  AI_AUDIO_SUMMARIZE_MAX_BYTES,
  AI_AUDIO_SUMMARIZE_MAX_OUTPUT_TOKENS,
} from '../security/limits.js';
import { aiUsageRecord, type OnUsage } from '../usage/usage.js';

/** Réponse du modèle quand l'enregistrement ne contient aucune parole. */
export const NO_SPEECH_MARKER = '[AUCUNE_PAROLE]';

export type AudioInput = {
  data: Uint8Array;
  /** Type MIME ; ses paramètres (« ;codecs=opus ») sont retirés. */
  mediaType: string;
};

export type StreamAudioSummaryOptions = {
  model: LanguageModel;
  audio: AudioInput;
  /**
   * Lignes de contexte placées avant l'audio (ex. « Contrôle audité : … ») : elles aident le
   * modèle à comprendre le vocabulaire, sans être rapportées comme dites.
   */
  context?: (string | undefined | null | false)[];
  /** Instructions système ; par défaut celles du paquet (AUDIO_SUMMARIZE.md). */
  instructions?: string;
  /** Langue de l'interface : le compte rendu est écrit dans cette langue. */
  locale?: string;
  maxBytes?: number;
  maxOutputTokens?: number;
  onUsage?: OnUsage;
  logger?: AiLogger;
};

/** Accepte seulement un fichier audio, plafonné en taille (garde-fou de coût). */
export function assertAudioInput(
  audio: AudioInput,
  maxBytes = AI_AUDIO_SUMMARIZE_MAX_BYTES,
) {
  if (!audio.mediaType.startsWith('audio/')) {
    throw new TypeError('Seuls les fichiers audio sont acceptés');
  }
  if (audio.data.byteLength > maxBytes) {
    throw new RangeError(`Fichier audio trop volumineux (${maxBytes} octets au plus).`);
  }
}

/**
 * Compte rendu Markdown d'un enregistrement, en flux de texte, par un modèle qui comprend
 * l'audio (Gemini) : pas de service de transcription à payer. L'audio n'est ni stocké ni
 * gardé : il reste en mémoire le temps de l'appel. Une erreur du modèle est journalisée et le
 * flux se termine, vide : son détail ne part pas au client.
 */
export async function streamAudioSummary(
  options: StreamAudioSummaryOptions,
): Promise<ReturnType<typeof streamText>> {
  const { model, audio, onUsage } = options;
  const logger = options.logger ?? console;
  assertAudioInput(audio, options.maxBytes);

  const lines = (options.context ?? []).filter(Boolean) as string[];
  const contextParts = lines.length
    ? [{ type: 'text' as const, text: `Contexte :\n${lines.join('\n')}` }]
    : [];
  const instructions =
    (options.instructions ?? (await loadInstruction('AUDIO_SUMMARIZE'))) +
    responseLanguageInstruction(options.locale);

  return streamText({
    model,
    instructions,
    temperature: 0,
    maxOutputTokens: options.maxOutputTokens ?? AI_AUDIO_SUMMARIZE_MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          ...contextParts,
          {
            type: 'file',
            data: audio.data,
            // "audio/webm;codecs=opus" -> "audio/webm" : le fournisseur n'accepte pas les paramètres.
            mediaType: audio.mediaType.split(';')[0],
          },
        ],
      },
    ],
    // Usage seulement, ni l'audio ni le compte rendu.
    onEnd: (event) =>
      onUsage?.(
        aiUsageRecord('audio-summarize', event, { audioBytes: audio.data.byteLength }),
      ),
    onError: ({ error }) => {
      logger.error('Résumé audio échoué', error instanceof Error ? error.stack : error);
    },
  });
}
