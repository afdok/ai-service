import {
  Output,
  streamText,
  type LanguageModel,
  type StreamTextResult,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import { AI_WRITING_MAX_LENGTH } from '../security/limits.js';
import { loadInstruction } from '../instructions/instructions.js';
import { aiUsageRecord, type OnUsage, type StreamContext } from '../usage/usage.js';

export const WRITING_ACTIONS = ['FIX_SPELLING', 'REPHRASE_FORMAL'] as const;
export type WritingAction = (typeof WRITING_ACTIONS)[number];

export const aiWritingOutputSchema = z.object({
  hasModification: z
    .boolean()
    .describe('Indique si le texte généré apporte un changement ou corrige une erreur'),
  content: z
    .string()
    .describe(
      "Le texte corrigé ou reformulé, ou chaîne vide si aucune correction n'est requise",
    ),
});

export type AIWritingOutput = z.infer<typeof aiWritingOutputSchema>;

const writingOutput = Output.object({ schema: aiWritingOutputSchema });

export type AIWritingResult = StreamTextResult<ToolSet, StreamContext, typeof writingOutput>;

export const DEFAULT_WRITING_PROMPTS: Record<WritingAction, string> = {
  FIX_SPELLING: 'Corrige les fautes d’orthographe et de grammaire sans modifier le fond.',
  REPHRASE_FORMAL: 'Reformule avec le ton rigoureux et neutre propre à l’audit interne.',
};

export type StreamWritingOptions = {
  model: LanguageModel;
  text: string;
  action: WritingAction;
  /** Instructions système ; par défaut celles du paquet (`<action>.md`). */
  instructions?: string;
  /** Consigne courte de l'action ; par défaut DEFAULT_WRITING_PROMPTS. */
  prompt?: string;
  maxLength?: number;
  onUsage?: OnUsage;
  onError?: (error: unknown) => void;
};

/**
 * Correction ou reformulation d'un texte, en flux d'objet `{ hasModification, content }`.
 * Le texte garde sa langue : il n'est jamais traduit.
 */
export async function streamWriting(options: StreamWritingOptions): Promise<AIWritingResult> {
  const { model, text, action, onUsage, onError } = options;
  const maxLength = options.maxLength ?? AI_WRITING_MAX_LENGTH;
  if (text.length > maxLength) {
    throw new RangeError(`Texte trop long (${maxLength} caractères au plus).`);
  }
  const instructions = options.instructions ?? (await loadInstruction(action));
  const prompt = options.prompt ?? DEFAULT_WRITING_PROMPTS[action];

  return streamText({
    model,
    instructions,
    output: writingOutput,
    // Usage seulement, jamais le texte traité.
    onEnd: (event) => onUsage?.(aiUsageRecord('writing', event, { action })),
    onError: ({ error }) => {
      if (onError) return onError(error);
      throw error;
    },
    prompt: `${prompt}
Garde la langue du texte à traiter, ne le traduis pas.
Texte à traiter : ${text}`,
  });
}
