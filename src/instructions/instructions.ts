import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Dossier `instructions/` du paquet (même chemin depuis src/ et dist/). */
export const BUILTIN_INSTRUCTIONS_DIR = fileURLToPath(
  new URL('../../instructions/', import.meta.url),
);

/** Instructions fournies : FIX_SPELLING, REPHRASE_FORMAL, AUDIO_SUMMARIZE. */
export type BuiltinInstruction = 'FIX_SPELLING' | 'REPHRASE_FORMAL' | 'AUDIO_SUMMARIZE';

/**
 * Instructions `<nom>.md` d'un dossier (celui du paquet par défaut). L'application peut garder
 * ses propres instructions (celles de son chat, par exemple) dans son dossier.
 */
export const loadInstruction = (
  name: BuiltinInstruction | (string & {}),
  dir: string = BUILTIN_INSTRUCTIONS_DIR,
) => readFile(join(dir, `${name}.md`), 'utf-8');

/** Nom des langues, dans la langue des instructions (le français). */
export const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'français',
  en: 'anglais (English)',
};

/**
 * Langue des réponses du modèle : celle de l'interface de l'utilisateur. Les instructions
 * restent en français ; cette consigne, ajoutée à la fin, fixe la langue de sortie. Dans la
 * langue par défaut, rien n'est ajouté.
 */
export function responseLanguageInstruction(
  locale: string | undefined,
  options: { defaultLocale?: string; names?: Record<string, string> } = {},
): string {
  const { defaultLocale = 'fr', names = LANGUAGE_NAMES } = options;
  if (!locale || locale === defaultLocale) return '';
  const language = names[locale] ?? locale;
  return `\n\n## LANGUE DE RÉPONSE\n\nL'interface de l'utilisateur est en ${language}. Rédige toutes tes réponses dans cette langue, quelle que soit la langue de ces instructions ou des données. Les noms propres et les valeurs saisies restent tels quels.`;
}
