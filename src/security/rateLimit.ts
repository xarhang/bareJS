import type { Context, Middleware } from '../core/context';
import type { RateLimitStore } from './store';

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (ctx: Context) => string;
  maxEntries?: number;
  /** Optional external store (e.g. redisStore(client)). Uses in-memory Map fast path when omitted. */
  store?: RateLimitStore;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export const rateLimit = (options: RateLimitOptions = {}): Middleware => {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const message = options.message ?? 'Too many requests, please try again later.';
  const maxEntries = Math.max(1, options.maxEntries ?? 10_000);
  const keyGenerator = options.keyGenerator ?? ((ctx: Context) => ctx.ip);
  const store = options.store;

  const finalizeBucket = (ctx: Context, count: number, resetAt: number, now: number, next: any) => {
    const remaining = Math.max(0, max - count);
    const resetSec = String(Math.ceil(resetAt / 1000));
    ctx.setHeader('X-RateLimit-Limit', String(max));
    ctx.setHeader('X-RateLimit-Remaining', String(remaining));
    ctx.setHeader('X-RateLimit-Reset', resetSec);

    if (count > max) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
      return Response.json(
        { status: 'error', code: 'RATE_LIMITED', message },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': resetSec
          }
        }
      );
    }

    return next?.();
  };

  if (store) {
    return async (ctx, next) => {
      const now = Date.now();
      const key = keyGenerator(ctx);
      const { count, resetAt } = await store.increment(key, windowMs);
      return finalizeBucket(ctx, count, resetAt, now, next);
    };
  }

  const buckets = new Map<string, RateBucket>();

  return (ctx, next) => {
    const now = Date.now();
    const key = keyGenerator(ctx);
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      // Prevent unbounded memory growth under key-flooding DoS
      if (buckets.size >= maxEntries) {
        for (const [k, v] of buckets) {
          if (now >= v.resetAt) buckets.delete(k);
          if (buckets.size < maxEntries) break;
        }
        if (buckets.size >= maxEntries) {
          const firstKey = buckets.keys().next().value;
          if (firstKey !== undefined) buckets.delete(firstKey);
        }
      }
      bucket = { count: 1, resetAt: now + windowMs };
      buckets.delete(key);
      buckets.set(key, bucket);
    } else {
      bucket.count++;
      buckets.delete(key);
      buckets.set(key, bucket);
    }

    return finalizeBucket(ctx, bucket.count, bucket.resetAt, now, next);
  };
};
