import type { UIMessage } from 'ai';
import { AiError } from '../errors.js';
import { defaultTranslate, type Translate } from '../i18n.js';
import { AI_HISTORY_LIMITS, type HistoryLimits } from '../security/limits.js';

type ClientMessage = { id?: unknown; role?: unknown; parts?: unknown };

/** Partie outil dont l'utilisateur vient de répondre à la demande d'approbation. */
function isApprovalResponse(part: Record<string, unknown> | undefined) {
  const approval = part?.approval as Record<string, unknown> | undefined;
  return (
    typeof part?.type === 'string' &&
    part.type.startsWith('tool-') &&
    part.state === 'approval-responded' &&
    typeof part.toolCallId === 'string' &&
    typeof approval?.id === 'string' &&
    typeof approval.approved === 'boolean'
  );
}

export type SanitizeHistoryOptions = {
  limits?: Partial<HistoryLimits>;
  translate?: Translate;
};

/**
 * Historique du chat envoyé par le client : il n'est pas digne de confiance.
 *
 * - structure vérifiée, nombre de messages et taille des textes plafonnés (AiError
 *   AI_INVALID_HISTORY, 400, sinon) ;
 * - seuls les messages `user` et `assistant` sont gardés (les instructions sont fixées par
 *   le serveur) ;
 * - seules les parties texte sont gardées, plus les réponses d'approbation d'un outil
 *   (`approval-responded`) d'un message assistant : un résultat d'outil fabriqué par le client
 *   n'atteint jamais le modèle, et une approbation fabriquée est rejetée par l'AI SDK, qui
 *   vérifie sa signature (`experimental_toolApprovalSecret`) avant d'exécuter l'outil.
 */
export function sanitizeChatHistory(
  messages: unknown,
  options: SanitizeHistoryOptions = {},
): UIMessage[] {
  const limits = { ...AI_HISTORY_LIMITS, ...options.limits };
  const t = options.translate ?? defaultTranslate;
  const invalid = (detail: string) =>
    new AiError(
      'AI_INVALID_HISTORY',
      t('Historique du chat invalide : {detail}', { detail }),
    );
  if (!Array.isArray(messages)) {
    throw invalid(t('messages doit être un tableau'));
  }
  if (messages.length > limits.maxMessages) {
    throw invalid(
      t('{max} messages au plus, démarrez une nouvelle conversation', {
        max: limits.maxMessages,
      }),
    );
  }

  let total = 0;
  const kept: UIMessage[] = [];
  for (const raw of messages as ClientMessage[]) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts)) {
      throw invalid(t('chaque message doit avoir un rôle et des parties'));
    }
    if (raw.role !== 'user' && raw.role !== 'assistant') continue;
    const parts: UIMessage['parts'] = [];
    for (const part of raw.parts as Record<string, unknown>[]) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        if (part.text.length > limits.maxTextLength) {
          throw invalid(
            t('un message dépasse {max} caractères', { max: limits.maxTextLength }),
          );
        }
        total += part.text.length;
        parts.push({ type: 'text', text: part.text });
      } else if (raw.role === 'assistant' && isApprovalResponse(part)) {
        const size = JSON.stringify(part).length;
        if (size > limits.maxApprovalLength) {
          throw invalid(t("une approbation d'outil est trop volumineuse"));
        }
        total += size;
        // Gardée telle quelle : la signature posée par le serveur doit rester intacte.
        parts.push(part as unknown as UIMessage['parts'][number]);
      }
    }
    if (parts.length === 0) continue;
    kept.push({
      id: typeof raw.id === 'string' ? raw.id : String(kept.length),
      role: raw.role,
      parts,
    });
  }
  if (total > limits.maxTotalLength) {
    throw invalid(
      t("l'historique dépasse {max} caractères, démarrez une nouvelle conversation", {
        max: limits.maxTotalLength,
      }),
    );
  }
  return kept;
}

/**
 * Réponses d'approbation de l'historique déjà vérifié par `sanitizeChatHistory`. À la reprise,
 * l'AI SDK repasse ces appels dans `toolApproval` : leur demande a déjà été signalée lors du
 * message précédent, elle ne doit pas l'être une seconde fois.
 */
export function approvalResponses(messages: UIMessage[]) {
  return messages.flatMap((message) =>
    (message.parts as unknown as Record<string, unknown>[])
      .filter((part) => isApprovalResponse(part))
      .map((part) => ({
        toolName: (part.type as string).slice('tool-'.length),
        toolCallId: part.toolCallId as string,
        approved: (part.approval as { approved: boolean }).approved,
      })),
  );
}

/**
 * Écritures que l'utilisateur vient de refuser dans l'interface. Une fois traitée par l'AI SDK,
 * la partie passe à `output-denied` : elle n'est comptée qu'une fois.
 */
export function deniedApprovals(messages: UIMessage[]) {
  return approvalResponses(messages)
    .filter(({ approved }) => !approved)
    .map(({ toolName, toolCallId }) => ({ toolName, toolCallId }));
}
