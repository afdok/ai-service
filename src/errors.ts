/**
 * Erreurs de la librairie. Chacune porte le code HTTP conseillé (`status`) : l'application
 * qui l'utilise la traduit dans son framework (NestJS, Express…) sans que la librairie en
 * dépende.
 */
export type AiErrorCode =
  | 'AI_DISABLED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_AUDIO_UNSUPPORTED'
  | 'AI_INVALID_HISTORY'
  | 'AI_SECRET_UNAVAILABLE';

const STATUS: Record<AiErrorCode, number> = {
  AI_DISABLED: 404,
  AI_NOT_CONFIGURED: 503,
  AI_AUDIO_UNSUPPORTED: 501,
  AI_INVALID_HISTORY: 400,
  AI_SECRET_UNAVAILABLE: 503,
};

export class AiError extends Error {
  readonly status: number;

  constructor(
    readonly code: AiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
    this.status = STATUS[code];
  }
}

export const isAiError = (error: unknown): error is AiError =>
  error instanceof AiError;
