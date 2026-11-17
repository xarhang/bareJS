import type { Context, Middleware, Next } from '../core/context';

export interface TimeoutOptions {
  status?: number;
  message?: string;
}

export const timeout = (ms = 10000, options: TimeoutOptions = {}): Middleware => {
  const status = options.status ?? 408;
  const message = options.message ?? 'Request Timeout';

  const mw: Middleware = async (_ctx: Context, next: Next) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeoutPromise = new Promise<Response>((resolve) => {
        timer = setTimeout(() => {
          resolve(
            Response.json(
              { status: 'error', code: 'REQUEST_TIMEOUT', message },
              { status }
            )
          );
        }, ms);
      });
      return await Promise.race([Promise.resolve(next()), timeoutPromise]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  (mw as any).__timeout = { ms, status, message };
  return mw;
};
