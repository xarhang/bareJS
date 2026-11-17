import type { Context, Middleware } from '../core/context';

export interface IdempotencyOptions {
  /** Header name (default: 'idempotency-key') */
  headerName?: string;
  /** Cache TTL in milliseconds (default: 300_000 = 5 minutes) */
  ttlMs?: number;
  /** Maximum cached keys before LRU eviction (default: 10_000) */
  maxKeys?: number;
}

interface CachedIdempotentEntry {
  status: number;
  body: any;
  expiresAt: number;
}

/**
 * Payment & Order Double-Charge Protection Middleware (Idempotency-Key).
 * Prevents duplicate state-changing executions and concurrent race conditions.
 */
export const idempotency = (options: IdempotencyOptions = {}): Middleware => {
  const headerName = (options.headerName || 'idempotency-key').toLowerCase();
  const ttlMs = options.ttlMs ?? 300_000;
  const maxKeys = options.maxKeys ?? 10_000;

  const cache = new Map<string, CachedIdempotentEntry>();
  const inFlight = new Set<string>();

  const mw: Middleware = (ctx: Context) => {
    const key = ctx.req.headers.get(headerName);
    if (!key) return undefined;

    const now = Date.now();
    const existing = cache.get(key);
    if (existing) {
      if (now < existing.expiresAt) {
        return Response.json(existing.body, {
          status: existing.status,
          headers: { 'X-Idempotent-Replayed': 'true' }
        });
      }
      cache.delete(key);
    }

    if (inFlight.has(key)) {
      return Response.json(
        { status: 'error', code: 'IDEMPOTENT_IN_FLIGHT', message: 'Duplicate request is currently in flight' },
        { status: 409 }
      );
    }

    inFlight.add(key);
    (ctx as any)._idempotencyKey = key;
    (ctx as any)._idemInFlight = inFlight;
    return undefined;
  };

  (mw as any).__idempotencyCommit = (ctx: Context, resVal: any, status: number) => {
    const key = (ctx as any)._idempotencyKey;
    if (!key) return;
    inFlight.delete(key);
    if (status >= 200 && status < 300 && !(resVal instanceof Response)) {
      if (cache.size >= maxKeys) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, {
        status,
        body: resVal,
        expiresAt: Date.now() + ttlMs
      });
    }
  };

  return mw;
};

/**
 * Singleflight Helper for Thundering-Herd / Cache-Stampede Protection.
 * Coalesces N concurrent identical async calls into 1 underlying execution.
 */
export const createSingleflight = () => {
  const inFlight = new Map<string, Promise<any>>();

  return async <T>(key: string, fn: () => Promise<T>): Promise<{ data: T; shared: boolean }> => {
    const existing = inFlight.get(key);
    if (existing) {
      const data = await existing;
      return { data, shared: true };
    }
    const promise = fn().finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    const data = await promise;
    return { data, shared: false };
  };
};
