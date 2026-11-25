import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type LanguageModel,
  type ToolSet,
} from 'ai';
import type { AiLogger } from '../i18n.js';
import { AI_MAX_STEPS } from '../security/limits.js';
import { aiUsageRecord, type OnUsage } from '../usage/usage.js';
import {
  approvalResponses,
  deniedApprovals,
  sanitizeChatHistory,
  type SanitizeHistoryOptions,
} from './history.js';
import { authorizeTools, createToolApproval, type ToolPolicy } from './tool-policy.js';

export type StreamChatOptions = {
  model: LanguageModel;
  /** Instructions système complètes (rôle, contexte de l'écran, langue…). */
  instructions: string;
  /** Historique tel qu'envoyé par le client : il est vérifié ici. */
  messages: unknown;
  /** Outils de l'application ; ils sont enveloppés par `authorizeTools`. */
  tools?: ToolSet;
  /** Droits et journal des outils. Obligatoire dès qu'il y a des outils. */
  policy?: ToolPolicy;
  /** Secret qui signe les approbations (voir `toolApprovalSecret`). */
  approvalSecret?: string;
  maxSteps?: number;
  history?: SanitizeHistoryOptions;
  /** Métadonnées ajoutées à l'usage journalisé (jamais le texte). */
  usageMetadata?: Record<string, unknown>;
  onUsage?: OnUsage;
  logger?: AiLogger;
};

/**
 * Réponse du chat, en flux. L'historique du client est vérifié et plafonné ; seules les
 * approbations d'écriture (signées par le serveur) y gardent leurs parties outil. Toute
 * écriture attend l'approbation de l'utilisateur (human in the loop). Le résultat se
 * renvoie au client avec `toUIMessageStream` / `pipeUIMessageStreamToResponse` de l'AI SDK.
 */
export async function streamChat(options: StreamChatOptions) {
  const { model, instructions, tools, policy, onUsage } = options;
  const logger = options.logger ?? console;
  if (tools && Object.keys(tools).length && !policy) {
    throw new Error('streamChat : une politique (policy) est obligatoire avec des outils.');
  }
  if (tools && policy && !options.approvalSecret) {
    throw new Error('streamChat : approvalSecret est obligatoire avec des outils.');
  }

  const history = sanitizeChatHistory(options.messages, options.history);
  // Écritures refusées par l'utilisateur depuis le message précédent.
  for (const { toolName, toolCallId } of deniedApprovals(history)) {
    await policy?.onEvent?.({ type: 'approval-denied', toolName, toolCallId });
  }
  const messages = await convertToModelMessages(history);

  return streamText({
    model,
    messages,
    instructions,
    ...(tools &&
      policy && {
        tools: authorizeTools(tools, policy),
        toolApproval: createToolApproval(
          policy,
          new Set(approvalResponses(history).map((r) => r.toolCallId)),
        ),
        experimental_toolApprovalSecret: options.approvalSecret,
      }),
    stopWhen: isStepCount(options.maxSteps ?? AI_MAX_STEPS),
    // Usage de la requête, sans le texte.
    onEnd: (event) => onUsage?.(aiUsageRecord('chat', event, options.usageMetadata)),
    onError: ({ error }) => {
      const cause = error instanceof Error ? error.cause : undefined;
      const issues =
        cause && typeof cause === 'object' && 'issues' in cause ? cause.issues : undefined;
      logger.error(
        [
          `streamText error: ${error instanceof Error ? error.message : String(error)}`,
          issues ? `issues: ${JSON.stringify(issues, null, 2)}` : undefined,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    },
  });
}
