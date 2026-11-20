import type { Middleware } from '../core/context';

export interface CorsOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string;
  credentials?: boolean;
  allowedHeaders?: string | string[];
  exposedHeaders?: string | string[];
}

export const cors = (options: CorsOptions = {}) => {
  const originOpt = options.origin ?? '*';
  const methods = options.methods || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
  const allowHeaders = Array.isArray(options.allowedHeaders)
    ? options.allowedHeaders.join(', ')
    : (options.allowedHeaders || 'Content-Type, Authorization');
  const exposeHeaders = Array.isArray(options.exposedHeaders)
    ? options.exposedHeaders.join(', ')
    : options.exposedHeaders;
  const credentials = options.credentials === true;

  // Fast-path for static string origin
  if (typeof originOpt === 'string') {
    if (originOpt === '') {
      const mw: Middleware = (ctx, next) => {
        if (ctx.req.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: { 'Vary': 'Origin' } });
        }
        ctx.setHeader('Vary', 'Origin');
        return next?.();
      };
      return mw;
    }
    const allowCreds = credentials && originOpt !== '*';
    const preflightHeaders: Record<string, string> = {
      'Access-Control-Allow-Origin': originOpt,
      'Access-Control-Allow-Methods': methods,
      'Access-Control-Allow-Headers': allowHeaders
    };
    if (originOpt !== '*') preflightHeaders['Vary'] = 'Origin';
    if (allowCreds) preflightHeaders['Access-Control-Allow-Credentials'] = 'true';
    const preflightInit = { status: 204, headers: preflightHeaders };

    const mw: Middleware = (ctx, next) => {
      if (ctx.req.method === 'OPTIONS') {
        return new Response(null, preflightInit);
      }
      ctx.setHeader('Access-Control-Allow-Origin', originOpt);
      ctx.setHeader('Access-Control-Allow-Methods', methods);
      if (originOpt !== '*') ctx.setHeader('Vary', 'Origin');
      if (allowCreds) ctx.setHeader('Access-Control-Allow-Credentials', 'true');
      if (exposeHeaders) ctx.setHeader('Access-Control-Expose-Headers', exposeHeaders);

      const res = next?.();
      if (res && typeof (res as any).then === 'function') {
        return (res as Promise<any>).then((r) => {
          if (r instanceof Response) {
            r.headers.set('Access-Control-Allow-Origin', originOpt);
            r.headers.set('Access-Control-Allow-Methods', methods);
            if (originOpt !== '*') r.headers.set('Vary', 'Origin');
            if (allowCreds) r.headers.set('Access-Control-Allow-Credentials', 'true');
            if (exposeHeaders) r.headers.set('Access-Control-Expose-Headers', exposeHeaders);
          }
          return r;
        });
      }
      if (res instanceof Response) {
        res.headers.set('Access-Control-Allow-Origin', originOpt);
        res.headers.set('Access-Control-Allow-Methods', methods);
        if (originOpt !== '*') res.headers.set('Vary', 'Origin');
        if (allowCreds) res.headers.set('Access-Control-Allow-Credentials', 'true');
        if (exposeHeaders) res.headers.set('Access-Control-Expose-Headers', exposeHeaders);
      }
      return res;
    };
    return mw;
  }

  // Dynamic origin (array or function)
  const allowedSet = Array.isArray(originOpt) ? new Set(originOpt) : null;
  const resolveOrigin = (reqOrigin: string | null): string | null => {
    if (!reqOrigin) return null;
    if (allowedSet) return allowedSet.has(reqOrigin) ? reqOrigin : null;
    return (originOpt as (o: string) => boolean)(reqOrigin) ? reqOrigin : null;
  };

  const mw: Middleware = (ctx, next) => {
    const matched = resolveOrigin(ctx.req.headers.get('origin'));
    if (ctx.req.method === 'OPTIONS') {
      const h: Record<string, string> = {
        'Access-Control-Allow-Methods': methods,
        'Access-Control-Allow-Headers': allowHeaders,
        'Vary': 'Origin'
      };
      if (matched) h['Access-Control-Allow-Origin'] = matched;
      if (credentials && matched) h['Access-Control-Allow-Credentials'] = 'true';
      return new Response(null, { status: 204, headers: h });
    }

    ctx.setHeader('Vary', 'Origin');
    ctx.setHeader('Access-Control-Allow-Methods', methods);
    if (matched) {
      ctx.setHeader('Access-Control-Allow-Origin', matched);
      if (credentials) ctx.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (exposeHeaders) ctx.setHeader('Access-Control-Expose-Headers', exposeHeaders);

    const res = next?.();
    if (res && typeof (res as any).then === 'function') {
      return (res as Promise<any>).then((r) => {
        if (r instanceof Response) {
          r.headers.set('Vary', 'Origin');
          r.headers.set('Access-Control-Allow-Methods', methods);
          if (matched) {
            r.headers.set('Access-Control-Allow-Origin', matched);
            if (credentials) r.headers.set('Access-Control-Allow-Credentials', 'true');
          }
          if (exposeHeaders) r.headers.set('Access-Control-Expose-Headers', exposeHeaders);
        }
        return r;
      });
    }
    if (res instanceof Response) {
      res.headers.set('Vary', 'Origin');
      res.headers.set('Access-Control-Allow-Methods', methods);
      if (matched) {
        res.headers.set('Access-Control-Allow-Origin', matched);
        if (credentials) res.headers.set('Access-Control-Allow-Credentials', 'true');
      }
      if (exposeHeaders) res.headers.set('Access-Control-Expose-Headers', exposeHeaders);
    }
    return res;
  };
  return mw;
};