import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AiError } from '../errors.js';

/**
 * Chiffrement AES-256-GCM des secrets stockés (clés API des fournisseurs). Format stocké :
 * `v1:iv:tag:données`, en base64.
 *
 * Clé : 32 octets aléatoires, en base64 ou en hexadécimal.
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

const VERSION = 'v1';

/** Lit une clé de 32 octets (base64 ou hexadécimal) ; null si la variable est vide. */
export function parseAesKey(
  value: string | undefined,
  envName: string,
): Buffer | null {
  const raw = value?.trim();
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `${envName} doit faire 32 octets (64 caractères hexadécimaux ou 44 en base64).`,
    );
  }
  return key;
}

export function encryptWithKey(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':');
}

/** Lève une erreur si le texte est mal formé, modifié, ou chiffré avec une autre clé. */
export function decryptWithKey(stored: string, key: Buffer): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('Secret chiffré illisible');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Chiffrement des clés API avec une clé dédiée, lue dans `envName` (AI_ENCRYPTION_KEY par
 * défaut). Sans clé : AiError AI_SECRET_UNAVAILABLE (503) ; changer la clé oblige à
 * ressaisir les clés API.
 */
export function createSecretCipher(
  envName = 'AI_ENCRYPTION_KEY',
  env: NodeJS.ProcessEnv = process.env,
) {
  const requireKey = () => {
    const key = parseAesKey(env[envName], envName);
    if (!key) {
      throw new AiError(
        'AI_SECRET_UNAVAILABLE',
        `L'enregistrement des clés d'IA n'est pas disponible sur ce serveur (${envName} manquante).`,
      );
    }
    return key;
  };
  return {
    encrypt: (plain: string) => encryptWithKey(plain, requireKey()),
    decrypt: (stored: string) => decryptWithKey(stored, requireKey()),
  };
}
