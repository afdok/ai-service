/**
 * Traduction des messages destinés à l'utilisateur. Par défaut, le texte français est gardé
 * et les paramètres `{nom}` sont remplacés ; l'application peut fournir sa propre fonction.
 */
export type Translate = (
  message: string,
  params?: Record<string, string | number>,
) => string;

export const defaultTranslate: Translate = (message, params = {}) =>
  message.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );

/** Journal minimal ; `console` convient. */
export type AiLogger = Pick<Console, 'error' | 'warn' | 'log'>;
