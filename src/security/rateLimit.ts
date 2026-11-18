import type { Context, Middleware } from '../core/context';

export interface RateLimitOptions {
  windowMs?: number;
  max?: number;
  message?: string;
  keyGenerator?: (ctx: Context) => string;
  maxEntries?: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export const rateLimit = (options: RateLimitOptions = {}): Middleware => {
  const windowMs = options.windowMs ?? 60_000;
  const max = options.max ?? 100;
  const message = options.message ?? 'Too many requests, please try again later.';
  const maxEntries = options.maxEntries ?? 10_000;
  const keyGenerator = options.keyGenerator ?? ((ctx: Context) => ctx.ip);

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
      buckets.set(key, bucket);
    } else {
      bucket.count++;
    }

    const remaining = Math.max(0, max - bucket.count);
    ctx.setHeader('X-RateLimit-Limit', String(max));
    ctx.setHeader('X-RateLimit-Remaining', String(remaining));
    ctx.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return Response.json(
        { status: 'error', code: 'RATE_LIMITED', message },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfter),
            'X-RateLimit-Limit': String(max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000))
          }
        }
      );
    }

    return next?.();
  };
};
