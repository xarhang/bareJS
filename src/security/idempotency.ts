import { createHash } from 'node:crypto';
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
  /**
   * Scope string mixed into the cache key so one caller can never replay another caller's response.
   * Default: SHA-256 of the Authorization and Cookie headers.
   */
  keyScope?: (ctx: Context) => string | undefined;
}

const REPLAY_HEADERS = ['location', 'content-location', 'etag'];
const pickReplayHeaders = (res: Response): Record<string, string> | undefined => {
  let out: Record<string, string> | undefined;
  for (const h of REPLAY_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) (out ??= {})[h] = v;
  }
  return out;
};

const defaultKeyScope = (ctx: Context): string => {
  const a = ctx.req.headers.get('authorization') || '';
  const c = ctx.req.headers.get('cookie') || '';
  if (!a && !c) return '';
  return createHash('sha256').update(a).update('\0').update(c).digest('hex');
};

const buildReplayResponse = (existing: CachedIdempotentEntry): Response => {
  if (existing.rawBody !== undefined) {
    return new Response(existing.rawBody, {
      status: existing.status,
      headers: {
        ...(existing.headers || {}),
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

const extractIdemKey = (ctx: Context, headerName: string, keyScope: (ctx: Context) => string | undefined): string | undefined => {
  const rawKey = ctx.req.headers.get(headerName)?.trim();
  if (!rawKey) return undefined;
  const rawUrl = ctx.req.url;
  const s = rawUrl.indexOf('/', 8);
  const q = s === -1 ? -1 : rawUrl.indexOf('?', s);
  const path = s === -1 ? '/' : (q === -1 ? rawUrl.slice(s) : rawUrl.slice(s, q));
  return `${ctx.req.method}:${path}:${keyScope(ctx) || ''}:${rawKey}`;
};

/**
 * Payment & Order Double-Charge Protection Middleware (Idempotency-Key).
 * Prevents duplicate state-changing executions and concurrent race conditions.
 */
export const idempotency = (options: IdempotencyOptions = {}): Middleware => {
  const headerName = (options.headerName || 'idempotency-key').toLowerCase();
  const ttlMs = options.ttlMs ?? 300_000;
  const keyScope = options.keyScope ?? defaultKeyScope;
  const maxKeys = options.maxKeys ?? 10_000;
  const externalStore = options.store;

  if (externalStore) {
    const hasAcquireToken = typeof externalStore.acquireToken === 'function';
    const storeLockShim = { delete: (k: string) => { void externalStore.release(k); } };
    const mw: Middleware = async (ctx: Context) => {
      const key = extractIdemKey(ctx, headerName, keyScope);
      if (!key) {
        (ctx as any)._idempotencyKey = undefined;
        return undefined;
      }

      const existing = await externalStore.get(key);
      if (existing && Date.now() < existing.expiresAt) {
        (ctx as any)._idempotencyKey = undefined;
        return buildReplayResponse(existing);
      }

      let acquired = false;
      let lockToken: string | undefined;
      if (hasAcquireToken) {
        const tok = await externalStore.acquireToken!(key, ttlMs);
        if (tok) {
          acquired = true;
          lockToken = tok;
        }
      } else {
        acquired = await externalStore.acquire(key, ttlMs);
      }

      if (!acquired) {
        (ctx as any)._idempotencyKey = undefined;
        return Response.json(
          { status: 'error', code: 'IDEMPOTENT_IN_FLIGHT', message: 'Duplicate request is currently in flight' },
          { status: 409 }
        );
      }

      if ((ctx as any)._detached) {
        (ctx as any)._idempotencyKey = undefined;
        await externalStore.release(key, lockToken);
        return undefined;
      }

      let recheck: CachedIdempotentEntry | undefined;
      try {
        recheck = await externalStore.get(key);
      } catch (err) {
        (ctx as any)._idempotencyKey = undefined;
        await externalStore.release(key, lockToken);
        throw err;
      }

      if ((ctx as any)._detached) {
        (ctx as any)._idempotencyKey = undefined;
        await externalStore.release(key, lockToken);
        return undefined;
      }

      if (recheck && Date.now() < recheck.expiresAt) {
        (ctx as any)._idempotencyKey = undefined;
        await externalStore.release(key, lockToken);
        return buildReplayResponse(recheck);
      }

      (ctx as any)._idempotencyKey = key;
      (ctx as any)._idemExtToken = lockToken;
      (ctx as any)._idemInFlight = hasAcquireToken
        ? {
            delete: (k: string) => {
              const tok = (ctx as any)._idemExtToken;
              (ctx as any)._idemExtToken = undefined;
              void externalStore.release(k, tok);
            }
          }
        : storeLockShim;
      return undefined;
    };

    (mw as any).__idempotencyCommit = (ctx: Context, resVal: any, status: number) => {
      const key = (ctx as any)._idempotencyKey;
      if (!key) return;
      const isResp = resVal instanceof Response;
      const isStream = isResp && (resVal.headers.get('content-type') || '').includes('text/event-stream');
      let clonedRes: any = null;
      if (!isStream && status >= 200 && status < 300 && isResp) {
        try { clonedRes = resVal.clone(); } catch { clonedRes = null; }
      }
      const ct = clonedRes ? (clonedRes.headers.get('content-type') || 'application/json') : undefined;
      return (async () => {
        try {
          if (!(ctx as any)._detached && !isStream && status >= 200 && status < 300) {
            if (isResp) {
              if (clonedRes) {
                const buf = await clonedRes.arrayBuffer();
                if (!(ctx as any)._detached) {
                  await externalStore.set(key, { status, rawBody: buf, contentType: ct, headers: pickReplayHeaders(clonedRes), expiresAt: Date.now() + ttlMs }, ttlMs);
                }
              }
            } else {
              await externalStore.set(key, { status, body: resVal ?? null, expiresAt: Date.now() + ttlMs }, ttlMs);
            }
          }
        } catch {
          // Best-effort cache write
        } finally {
          const extToken = (ctx as any)._idemExtToken;
          const alreadyReleased = Boolean((ctx as any)._detached) || !(ctx as any)._idempotencyKey;
          (ctx as any)._idempotencyKey = undefined;
          (ctx as any)._idemExtToken = undefined;
          (ctx as any)._idemInFlight = undefined;
          if (!alreadyReleased) {
            await externalStore.release(key, extToken);
          }
        }
      })();
    };

    (mw as any).__idempotencyRelease = (ctx: Context) => {
      const key = (ctx as any)._idempotencyKey;
      if (key) {
        const extToken = (ctx as any)._idemExtToken;
        (ctx as any)._idempotencyKey = undefined;
        (ctx as any)._idemExtToken = undefined;
        (ctx as any)._idemInFlight = undefined;
        void externalStore.release(key, extToken);
      }
    };

    return mw;
  }

  const cache = new Map<string, CachedIdempotentEntry>();
  const inFlight = new Map<string, { token: string; expiresAt: number }>();

  const evictIfNeeded = () => {
    if (cache.size >= maxKeys) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  const mw: Middleware = (ctx: Context) => {
    const key = extractIdemKey(ctx, headerName, keyScope);
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

    const lockEntry = inFlight.get(key);
    if (lockEntry !== undefined) {
      if (now < lockEntry.expiresAt) {
        (ctx as any)._idempotencyKey = undefined;
        return Response.json(
          { status: 'error', code: 'IDEMPOTENT_IN_FLIGHT', message: 'Duplicate request is currently in flight' },
          { status: 409 }
        );
      }
      inFlight.delete(key);
    }

    const token = crypto.randomUUID();
    inFlight.set(key, { token, expiresAt: now + ttlMs });
    (ctx as any)._idempotencyKey = key;
    (ctx as any)._idemToken = token;
    (ctx as any)._idemInFlight = {
      delete: (k: string) => {
        const cur = inFlight.get(k);
        if (cur && cur.token === token) inFlight.delete(k);
      }
    };
    return undefined;
  };

  const releaseOwned = (ctx: Context, key: string) => {
    const token = (ctx as any)._idemToken;
    (ctx as any)._idempotencyKey = undefined;
    (ctx as any)._idemToken = undefined;
    (ctx as any)._idemInFlight = undefined;
    const cur = inFlight.get(key);
    if (cur && (!token || cur.token === token)) {
      inFlight.delete(key);
    }
  };

  (mw as any).__idempotencyCommit = (ctx: Context, resVal: any, status: number) => {
    const key = (ctx as any)._idempotencyKey;
    if (!key) return;
    const isResp = resVal instanceof Response;
    const isStream = isResp && (resVal.headers.get('content-type') || '').includes('text/event-stream');
    if (!(ctx as any)._detached && !isStream && status >= 200 && status < 300) {
      if (isResp) {
        let cloned: any = null;
        try { cloned = resVal.clone(); } catch { cloned = null; }
        if (cloned) {
          const ct = cloned.headers.get('content-type') || 'application/json';
          return cloned.arrayBuffer().then((buf: ArrayBuffer) => {
            if ((ctx as any)._detached) return;
            evictIfNeeded();
            cache.set(key, {
              status,
              rawBody: buf,
              contentType: ct,
              headers: pickReplayHeaders(cloned),
              expiresAt: Date.now() + ttlMs
            });
          }).catch(() => {}).finally(() => {
            releaseOwned(ctx, key);
          });
        }
        releaseOwned(ctx, key);
        return;
      }
      evictIfNeeded();
      cache.set(key, {
        status,
        body: resVal ?? null,
        expiresAt: Date.now() + ttlMs
      });
    }
    releaseOwned(ctx, key);
  };

  (mw as any).__idempotencyRelease = (ctx: Context) => {
    const key = (ctx as any)._idempotencyKey;
    if (key) {
      releaseOwned(ctx, key);
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
