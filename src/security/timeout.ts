import type { Context, Middleware, Next } from '../core/context';

export interface TimeoutOptions {
  status?: number;
  message?: string;
}

export const timeout = (ms = 10000, options: TimeoutOptions = {}): Middleware => {
  const status = options.status ?? 408;
  const message = options.message ?? 'Request Timeout';
  const delayMs = Number.isFinite(ms) ? Math.min(Math.max(ms, 0), 2 ** 31 - 1) : 2 ** 31 - 1;

  const mw: Middleware = async (ctx: Context, next: Next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const nextPromise = Promise.resolve(next());
      const timeoutPromise = new Promise<Response>((resolve) => {
        timer = setTimeout(() => {
          ctx._detached = true;
          nextPromise.catch(() => {});
          resolve(
            Response.json(
              { status: 'error', code: 'REQUEST_TIMEOUT', message },
              { status }
            )
          );
        }, delayMs);
      });
      return await Promise.race([nextPromise, timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  (mw as any).__timeout = { ms: delayMs, status, message };
  return mw;
};
