import type { Context, Middleware } from '../core/context';
import type { CachedIdempotentEntry, IdempotencyStore } from './store';

export interface IdempotencyOptions {
  /** Header name (default: 'idempotency-key') */
  headerName?: string;
  /** Cache TTL in milliseconds (default: 300_000 = 5 minutes) */
  ttlMs?: number;
  /** Maximum cached keys before LRU eviction (default: 10_000) */
  maxKeys?: number;
  /** Optional external store (e.g. redisStore(client)). Uses in-memory Map fast path when omitted. */
  store?: IdempotencyStore;
}

const buildReplayResponse = (existing: CachedIdempotentEntry): Response => {
  if (existing.rawBody !== undefined) {
    return new Response(existing.rawBody, {
      status: existing.status,
      headers: {
        'content-type': existing.contentType || 'application/json',
        'X-Idempotent-Replayed': 'true'
      }
    });
  }
  return Response.json(existing.body ?? null, {
    status: existing.status,
    headers: { 'X-Idempotent-Replayed': 'true' }
  });
};

const extractIdemKey = (ctx: Context, headerName: string): string | undefined => {
  const rawKey = ctx.req.headers.get(headerName)?.trim();
  if (!rawKey) return undefined;
  const rawUrl = ctx.req.url;
  const s = rawUrl.indexOf('/', 8);
  const q = s === -1 ? -1 : rawUrl.indexOf('?', s);
  const path = s === -1 ? '/' : (q === -1 ? rawUrl.slice(s) : rawUrl.slice(s, q));
  return `${ctx.req.method}:${path}:${rawKey}`;
};

/**
 * Payment & Order Double-Charge Protection Middleware (Idempotency-Key).
 * Prevents duplicate state-changing executions and concurrent race conditions.
 */
export const idempotency = (options: IdempotencyOptions = {}): Middleware => {
  const headerName = (options.headerName || 'idempotency-key').toLowerCase();
  const ttlMs = options.ttlMs ?? 300_000;
  const maxKeys = options.maxKeys ?? 10_000;
  const externalStore = options.store;

  if (externalStore) {
    const storeLockShim = { delete: (k: string) => { void externalStore.release(k); } };
    const mw: Middleware = async (ctx: Context) => {
      const key = extractIdemKey(ctx, headerName);
      if (!key) {
        (ctx as any)._idempotencyKey = undefined;
        return undefined;
      }

      const existing = await externalStore.get(key);
      if (existing && Date.now() < existing.expiresAt) {
        (ctx as any)._idempotencyKey = undefined;
        return buildReplayResponse(existing);
      }

      const acquired = await externalStore.acquire(key, ttlMs);
      if (!acquired) {
        (ctx as any)._idempotencyKey = undefined;
        return Response.json(
          { status: 'error', code: 'IDEMPOTENT_IN_FLIGHT', message: 'Duplicate request is currently in flight' },
          { status: 409 }
        );
      }

      const recheck = await externalStore.get(key);
      if (recheck && Date.now() < recheck.expiresAt) {
        (ctx as any)._idempotencyKey = undefined;
        await externalStore.release(key);
        return buildReplayResponse(recheck);
      }

      (ctx as any)._idempotencyKey = key;
      (ctx as any)._idemInFlight = storeLockShim;
      return undefined;
    };

    (mw as any).__idempotencyCommit = (ctx: Context, resVal: any, status: number) => {
      const key = (ctx as any)._idempotencyKey;
      if (!key) return;
      (ctx as any)._idempotencyKey = undefined;
      (ctx as any)._idemInFlight = undefined;
      const isStream = resVal instanceof Response && (resVal.headers.get('content-type') || '').includes('text/event-stream');
      const clonedRes = !isStream && status >= 200 && status < 300 && resVal instanceof Response ? resVal.clone() : null;
      const ct = clonedRes ? (clonedRes.headers.get('content-type') || 'application/json') : undefined;
      return (async () => {
        try {
          if (!isStream && status >= 200 && status < 300) {
            if (clonedRes) {
              const buf = await clonedRes.arrayBuffer();
              await externalStore.set(key, { status, rawBody: buf, contentType: ct, expiresAt: Date.now() + ttlMs }, ttlMs);
            } else {
              await externalStore.set(key, { status, body: resVal ?? null, expiresAt: Date.now() + ttlMs }, ttlMs);
            }
          }
        } catch {
          // Best-effort cache write
        } finally {
          await externalStore.release(key);
        }
      })();
    };

    (mw as any).__idempotencyRelease = (ctx: Context) => {
      const key = (ctx as any)._idempotencyKey;
      if (key) {
        (ctx as any)._idempotencyKey = undefined;
        (ctx as any)._idemInFlight = undefined;
        void externalStore.release(key);
      }
    };

    return mw;
  }

  const cache = new Map<string, CachedIdempotentEntry>();
  const inFlight = new Set<string>();

  const evictIfNeeded = () => {
    if (cache.size >= maxKeys) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  const mw: Middleware = (ctx: Context) => {
    const key = extractIdemKey(ctx, headerName);
    if (!key) {
      (ctx as any)._idempotencyKey = undefined;
      return undefined;
    }

    const now = Date.now();
    const existing = cache.get(key);
    if (existing) {
      if (now < existing.expiresAt) {
        (ctx as any)._idempotencyKey = undefined;
        return buildReplayResponse(existing);
      }
      cache.delete(key);
    }

    if (inFlight.has(key)) {
      (ctx as any)._idempotencyKey = undefined;
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
    (ctx as any)._idempotencyKey = undefined;
    (ctx as any)._idemInFlight = undefined;
    const isStream = resVal instanceof Response && (resVal.headers.get('content-type') || '').includes('text/event-stream');
    if (!isStream && status >= 200 && status < 300) {
      if (resVal instanceof Response) {
        const ct = resVal.headers.get('content-type') || 'application/json';
        return resVal.clone().arrayBuffer().then((buf) => {
          evictIfNeeded();
          cache.set(key, {
            status,
            rawBody: buf,
            contentType: ct,
            expiresAt: Date.now() + ttlMs
          });
        }).catch(() => {}).finally(() => {
          inFlight.delete(key);
        });
      }
      evictIfNeeded();
      cache.set(key, {
        status,
        body: resVal,
        expiresAt: Date.now() + ttlMs
      });
    }
    inFlight.delete(key);
  };

  (mw as any).__idempotencyRelease = (ctx: Context) => {
    const key = (ctx as any)._idempotencyKey;
    if (key) {
      (ctx as any)._idempotencyKey = undefined;
      (ctx as any)._idemInFlight = undefined;
      inFlight.delete(key);
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
