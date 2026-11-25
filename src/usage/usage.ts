import type { LanguageModelUsage, streamText, StreamTextResult, ToolSet } from 'ai';

/** Contexte d'exécution de streamText (type non exporté par `ai`, déduit ici). */
export type StreamContext =
  ReturnType<typeof streamText> extends StreamTextResult<ToolSet, infer C, never>
    ? C
    : never;

/** Ce que l'on retient de la fin d'un appel au modèle (`onEnd` de streamText). */
export type AiRequestOutcome = {
  steps?: readonly { toolCalls: readonly { toolName: string }[] }[];
  totalUsage?: Pick<
    LanguageModelUsage,
    'inputTokens' | 'outputTokens' | 'totalTokens'
  >;
  finishReason?: string;
};

/** Usage d'une requête IA, à journaliser par l'application. */
export type AiUsageRecord = {
  /** Usage : 'chat', 'writing', 'audio-summarize' ou celui de l'application. */
  feature: string;
  steps: number;
  tools: string[];
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Usage d'une requête IA : nombre d'étapes, noms des outils appelés, jetons consommés.
 * Jamais le texte des messages ni des réponses : seuls des compteurs et des noms sont copiés.
 */
export function aiUsageRecord(
  feature: string,
  outcome: AiRequestOutcome,
  metadata?: Record<string, unknown>,
): AiUsageRecord {
  const { steps = [], totalUsage, finishReason } = outcome;
  return {
    feature,
    steps: steps.length,
    tools: steps.flatMap((step) => step.toolCalls.map((c) => c.toolName)),
    inputTokens: totalUsage?.inputTokens,
    outputTokens: totalUsage?.outputTokens,
    totalTokens: totalUsage?.totalTokens,
    finishReason,
    ...(metadata && { metadata }),
  };
}

/** Rappel de l'application qui journalise l'usage (audit, métriques…). */
export type OnUsage = (record: AiUsageRecord) => void | Promise<void>;
