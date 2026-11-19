export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> | { count: number; resetAt: number };
}

export interface CachedIdempotentEntry {
  status: number;
  body?: any;
  rawBody?: ArrayBuffer;
  contentType?: string;
  expiresAt: number;
}

export interface IdempotencyStore {
  get(key: string): Promise<CachedIdempotentEntry | undefined> | CachedIdempotentEntry | undefined;
  set(key: string, entry: CachedIdempotentEntry, ttlMs: number): Promise<void> | void;
  acquire(key: string, ttlMs?: number): Promise<boolean> | boolean;
  release(key: string): Promise<void> | void;
}

export interface RevocationStore {
  revoke(tokenOrJti: string, ttlMs: number): Promise<void> | void;
  isRevoked(tokenOrJti: string): Promise<boolean> | boolean;
}

export type BareStore = RateLimitStore & IdempotencyStore & RevocationStore;

export interface RedisStoreOptions {
  /** Key prefix for all entries (default: 'barejs:') */
  prefix?: string;
}

/**
 * Lightweight Redis adapter compatible with both Bun.redis and ioredis.
 * Implements RateLimitStore, IdempotencyStore, and RevocationStore.
 */
export const redisStore = (client: any, options: RedisStoreOptions = {}): BareStore => {
  const prefix = options.prefix ?? 'barejs:';

  const useSend = typeof client.send === 'function';

  const cmdGet = (key: string) =>
    useSend ? client.send('GET', [key]) : client.get(key);

  const cmdDel = (key: string) =>
    useSend ? client.send('DEL', [key]) : client.del(key);

  const cmdIncr = (key: string) =>
    useSend ? client.send('INCR', [key]) : client.incr(key);

  const setWithTtl = async (key: string, value: string, ttlMs: number): Promise<void> => {
    if (useSend) {
      await client.send('SET', [key, value, 'PX', String(ttlMs)]);
      return;
    }
    try {
      await client.set(key, value, 'PX', ttlMs);
    } catch {
      await client.set(key, value);
      if (typeof client.pexpire === 'function') {
        await client.pexpire(key, ttlMs);
      } else if (typeof client.expire === 'function') {
        await client.expire(key, Math.max(1, Math.ceil(ttlMs / 1000)));
      }
    }
  };

  return {
    async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
      const fullKey = `${prefix}rl:${key}`;
      const count = Number(await cmdIncr(fullKey));
      if (count === 1) {
        if (useSend) {
          await client.send('PEXPIRE', [fullKey, String(windowMs)]);
        } else if (typeof client.pexpire === 'function') {
          await client.pexpire(fullKey, windowMs);
        } else if (typeof client.expire === 'function') {
          await client.expire(fullKey, Math.max(1, Math.ceil(windowMs / 1000)));
        }
      }
      let pttl = windowMs;
      if (useSend) {
        const res = Number(await client.send('PTTL', [fullKey]));
        if (Number.isFinite(res) && res > 0) pttl = res;
      } else if (typeof client.pttl === 'function') {
        const res = Number(await client.pttl(fullKey));
        if (Number.isFinite(res) && res > 0) pttl = res;
      } else if (typeof client.ttl === 'function') {
        const res = Number(await client.ttl(fullKey));
        if (Number.isFinite(res) && res > 0) pttl = res * 1000;
      }
      return { count, resetAt: Date.now() + pttl };
    },

    async get(key: string): Promise<CachedIdempotentEntry | undefined> {
      const raw = await cmdGet(`${prefix}idem:${key}`);
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw));
        if (parsed.rawBodyBase64) {
          const buf = Buffer.from(parsed.rawBodyBase64, 'base64');
          return {
            status: parsed.status,
            rawBody: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            contentType: parsed.contentType,
            expiresAt: parsed.expiresAt
          };
        }
        return parsed;
      } catch {
        return undefined;
      }
    },

    async set(key: string, entry: CachedIdempotentEntry, ttlMs: number): Promise<void> {
      const serializable: any = {
        status: entry.status,
        expiresAt: entry.expiresAt
      };
      if (entry.rawBody !== undefined) {
        serializable.rawBodyBase64 = Buffer.from(entry.rawBody).toString('base64');
        serializable.contentType = entry.contentType;
      } else {
        serializable.body = entry.body;
      }
      await setWithTtl(`${prefix}idem:${key}`, JSON.stringify(serializable), ttlMs);
    },

    async acquire(key: string, ttlMs: number = 30_000): Promise<boolean> {
      const lockKey = `${prefix}idem:lock:${key}`;
      if (useSend) {
        const res = await client.send('SET', [lockKey, '1', 'PX', String(ttlMs), 'NX']);
        return res === 'OK' || res === true;
      }
      const res = await client.set(lockKey, '1', 'PX', ttlMs, 'NX');
      return res === 'OK' || res === true || res === 1;
    },

    async release(key: string): Promise<void> {
      await cmdDel(`${prefix}idem:lock:${key}`);
    },

    async revoke(tokenOrJti: string, ttlMs: number): Promise<void> {
      await setWithTtl(`${prefix}rev:${tokenOrJti}`, '1', ttlMs);
    },

    async isRevoked(tokenOrJti: string): Promise<boolean> {
      const val = await cmdGet(`${prefix}rev:${tokenOrJti}`);
      return val !== null && val !== undefined;
    }
  };
};
