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

  const setExpiry = async (fullKey: string, windowMs: number): Promise<void> => {
    if (useSend) {
      await client.send('PEXPIRE', [fullKey, String(windowMs)]);
    } else if (typeof client.pexpire === 'function') {
      await client.pexpire(fullKey, windowMs);
    } else if (typeof client.expire === 'function') {
      await client.expire(fullKey, Math.max(1, Math.ceil(windowMs / 1000)));
    }
  };

  const lockTokens = new Map<string, string[]>();
  const RELEASE_LUA = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

  return {
    async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
      const fullKey = `${prefix}rl:${key}`;
      const count = Number(await cmdIncr(fullKey));
      if (count === 1) {
        await setExpiry(fullKey, windowMs);
      }
      let pttl = windowMs;
      let rawPttl: number | null = null;
      if (useSend) {
        rawPttl = Number(await client.send('PTTL', [fullKey]));
      } else if (typeof client.pttl === 'function') {
        rawPttl = Number(await client.pttl(fullKey));
      } else if (typeof client.ttl === 'function') {
        const t = Number(await client.ttl(fullKey));
        rawPttl = t < 0 ? t : t * 1000;
      }
      if (rawPttl === -1) {
        await setExpiry(fullKey, windowMs);
      } else if (rawPttl !== null && Number.isFinite(rawPttl) && rawPttl > 0) {
        pttl = rawPttl;
      }
      return { count, resetAt: Date.now() + pttl };
    },

    async get(key: string): Promise<CachedIdempotentEntry | undefined> {
      const raw = await cmdGet(`${prefix}idem:${key}`);
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw));
        if (typeof parsed.rawBodyBase64 === 'string') {
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
      const token = crypto.randomUUID();
      if (useSend) {
        const res = await client.send('SET', [lockKey, token, 'PX', String(ttlMs), 'NX']);
        if (res === 'OK' || res === true) {
          let q = lockTokens.get(key);
          if (!q) { q = []; lockTokens.set(key, q); }
          q.push(token);
          return true;
        }
        return false;
      }
      const res = await client.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (res === 'OK' || res === true || res === 1) {
        let q = lockTokens.get(key);
        if (!q) { q = []; lockTokens.set(key, q); }
        q.push(token);
        return true;
      }
      return false;
    },

    async release(key: string): Promise<void> {
      const lockKey = `${prefix}idem:lock:${key}`;
      const q = lockTokens.get(key);
      const token = q?.pop();
      if (q && q.length === 0) lockTokens.delete(key);
      if (!token) return;
      if (useSend) {
        try {
          await client.send('EVAL', [RELEASE_LUA, '1', lockKey, token]);
          return;
        } catch {
          // Fallback if mock/client does not support EVAL
        }
      } else if (typeof client.eval === 'function') {
        try {
          await client.eval(RELEASE_LUA, 1, lockKey, token);
          return;
        } catch {
          // Fallback if mock/client does not support eval
        }
      }
      const current = await cmdGet(lockKey);
      if (current === token) {
        await cmdDel(lockKey);
      }
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
