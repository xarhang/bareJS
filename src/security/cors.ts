import type { Middleware } from '../core/context';

export const cors = (options: { origin?: string; methods?: string } = {}) => {
  const origin = options.origin || '*';
  const methods = options.methods || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
  const preflightHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
  if (origin !== '*') {
    preflightHeaders['Vary'] = 'Origin';
  }
  const preflightInit = { status: 204, headers: preflightHeaders };

  const mw: Middleware = (ctx, next) => {
    if (ctx.req.method === 'OPTIONS') {
      return new Response(null, preflightInit);
    }

    ctx.setHeader('Access-Control-Allow-Origin', origin);
    ctx.setHeader('Access-Control-Allow-Methods', methods);
    if (origin !== '*') {
      ctx.setHeader('Vary', 'Origin');
    }

    const res = next?.();
    if (res && typeof (res as any).then === 'function') {
      return (res as Promise<any>).then((r) => {
        if (r instanceof Response) {
          r.headers.set('Access-Control-Allow-Origin', origin);
          r.headers.set('Access-Control-Allow-Methods', methods);
          if (origin !== '*') r.headers.set('Vary', 'Origin');
        }
        return r;
      });
    }
    if (res instanceof Response) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Methods', methods);
      if (origin !== '*') res.headers.set('Vary', 'Origin');
    }
    return res;
  };
  return mw;
};