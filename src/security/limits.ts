/** Garde-fous par défaut ; chaque fonction accepte ses propres valeurs. */

const TOOL_APPROVAL_SECRET_MIN_LENGTH = 32;

/**
 * Secret qui signe les demandes d'approbation d'écriture du chat
 * (`experimental_toolApprovalSecret` de l'AI SDK). Sans lui, un client pourrait fabriquer une
 * approbation dans l'historique qu'il renvoie : il est donc obligatoire (32 caractères au
 * moins, identique sur toutes les instances).
 */
export const toolApprovalSecret = (
  env: NodeJS.ProcessEnv = process.env,
  name = 'TOOL_APPROVAL_SECRET',
) => {
  const secret = env[name];
  if (!secret || secret.length < TOOL_APPROVAL_SECRET_MIN_LENGTH) {
    throw new Error(
      `${name} manquant ou trop court (${TOOL_APPROVAL_SECRET_MIN_LENGTH} caractères minimum)`,
    );
  }
  return secret;
};

/** Nombre maximal d'étapes (appels d'outils) par réponse du chat. */
export const AI_MAX_STEPS = 8;

/** Historique du chat envoyé par le client. */
export type HistoryLimits = {
  maxMessages: number;
  maxTextLength: number;
  maxTotalLength: number;
  maxApprovalLength: number;
};

export const AI_HISTORY_LIMITS: HistoryLimits = {
  maxMessages: 50,
  maxTextLength: 8_000,
  maxTotalLength: 60_000,
  maxApprovalLength: 16_000,
};

/** Texte à corriger ou reformuler. */
export const AI_WRITING_MAX_LENGTH = 10_000;

/** Enregistrement à résumer : 10 minutes en mono à 32 kbit/s font environ 2,4 Mo. */
export const AI_AUDIO_SUMMARIZE_MAX_BYTES = 4 * 1024 * 1024;

/** Plafond du compte rendu : 10 minutes d'échange donnent au plus 3 000 à 4 000 jetons. */
export const AI_AUDIO_SUMMARIZE_MAX_OUTPUT_TOKENS = 6_000;

/** Entier strictement positif lu dans une variable d'environnement, `fallback` sinon. */
export const positiveIntEnv = (
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/** Requêtes IA par minute et par utilisateur (AI_RATE_LIMIT_PER_MINUTE, 20 par défaut). */
export const aiRateLimitPerMinute = (env: NodeJS.ProcessEnv = process.env) =>
  positiveIntEnv('AI_RATE_LIMIT_PER_MINUTE', 20, env);
