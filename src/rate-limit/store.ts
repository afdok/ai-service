import { randomUUID } from 'node:crypto';
import type { AiLogger } from '../i18n.js';

/** Compteur de requêtes sur une fenêtre glissante, par clé (un utilisateur). */
export interface RateLimitStore {
  /** Compte la requête si la limite le permet ; false si elle est atteinte. */
  hit(key: string, limit: number, windowMs: number): Promise<boolean>;
  close?(): Promise<void>;
}

/** Compteur en mémoire : propre à une instance. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly calls = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  hit(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = this.now();
    const recent = (this.calls.get(key) ?? []).filter((t) => now - t < windowMs);
    const allowed = recent.length < limit;
    if (allowed) recent.push(now);
    if (recent.length) this.calls.set(key, recent);
    else this.calls.delete(key);
    return Promise.resolve(allowed);
  }
}

/**
 * Fenêtre glissante dans un ensemble trié Redis, en un seul script (atomique) : purge des
 * requêtes sorties de la fenêtre, comptage, ajout. L'heure est celle du serveur Redis, la
 * même pour toutes les instances.
 */
const SLIDING_WINDOW_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local window = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  return 0
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return 1
`;

/** Ce dont le compteur a besoin d'un client Redis (ioredis convient tel quel). */
export interface RedisLike {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  disconnect(): void;
}

export type RedisRateLimitStoreOptions = {
  /** Préfixe des clés Redis (`ai-rate-limit:` par défaut). */
  prefix?: string;
  fallback?: RateLimitStore;
  logger?: AiLogger;
};

/**
 * Compteur partagé par toutes les instances. Redis injoignable : le compteur en mémoire prend
 * le relais (limite par instance) plutôt que de bloquer l'IA ou de la laisser sans limite.
 *
 * Avec ioredis, créer le client avec `enableOfflineQueue: false` et `maxRetriesPerRequest: 1`
 * (échec immédiat, le compteur en mémoire répond) et un écouteur `error`.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private failing = false;
  private readonly prefix: string;
  private readonly fallback: RateLimitStore;
  private readonly logger: AiLogger;

  constructor(
    private readonly redis: RedisLike,
    options: RedisRateLimitStoreOptions = {},
  ) {
    this.prefix = options.prefix ?? 'ai-rate-limit:';
    this.fallback = options.fallback ?? new MemoryRateLimitStore();
    this.logger = options.logger ?? console;
  }

  async hit(key: string, limit: number, windowMs: number): Promise<boolean> {
    try {
      const allowed = await this.redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        this.prefix + key,
        windowMs,
        limit,
        randomUUID(),
      );
      if (this.failing) {
        this.failing = false;
        this.logger.log('Redis de nouveau joignable : limite de débit partagée');
      }
      return allowed === 1;
    } catch (error) {
      if (!this.failing) {
        this.failing = true;
        this.logger.warn(
          `Redis injoignable, limite de débit comptée par instance : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return this.fallback.hit(key, limit, windowMs);
    }
  }

  /** Coupe aussi une connexion en cours ou en reconnexion (quit attendrait sa fin). */
  close() {
    this.redis.disconnect();
    return Promise.resolve();
  }
}
