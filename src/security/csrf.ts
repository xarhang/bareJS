import type { Context, Middleware, Next } from '../core/context';
import { timingSafeEqual } from 'node:crypto';

export interface CsrfOptions {
  /** Allowed origins for state-changing requests (defaults to same-origin matching request Host) */
  allowedOrigins?: string[];
  /** HTTP methods exempt from CSRF checks (default: ['GET', 'HEAD', 'OPTIONS']) */
  ignoreMethods?: string[];
  /** Optional cookie + header double-submit check */
  cookieName?: string;
  headerName?: string;
  requireToken?: boolean;
  /** Allow requests that omit both Origin and Referer headers (default: false) */
  allowMissingOrigin?: boolean;
}

const DEFAULT_IGNORE = new Set(['GET', 'HEAD', 'OPTIONS']);

const resolveRequestOrigin = (ctx: Context): string => {
  try {
    const parsed = new URL(ctx.req.url);
    if (ctx._trustProxy) {
      const fwdHost = ctx.req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
      const fwdProto = ctx.req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      if (fwdHost) {
        const proto = fwdProto ? `${fwdProto}:` : parsed.protocol;
        return `${proto}//${fwdHost}`;
      }
    }
    const host = ctx.req.headers.get('host')?.trim();
    if (host) {
      return `${parsed.protocol}//${host}`;
    }
    return parsed.origin;
  } catch {
    return '';
  }
};

export const csrf = (options: CsrfOptions = {}): Middleware => {
  const ignore = options.ignoreMethods ? new Set(options.ignoreMethods.map((m) => m.toUpperCase())) : DEFAULT_IGNORE;
  const allowed = options.allowedOrigins ? new Set(options.allowedOrigins) : null;
  const cookieName = options.cookieName || 'csrf_token';
  const headerName = (options.headerName || 'x-csrf-token').toLowerCase();
  const requireToken = options.requireToken === true;
  const allowMissingOrigin = options.allowMissingOrigin === true;

  return (ctx: Context, next: Next) => {
    const method = ctx.req.method.toUpperCase();
    if (ignore.has(method)) return next?.();

    const secFetchSite = ctx.req.headers.get('sec-fetch-site');
    const origin = ctx.req.headers.get('origin');
    const referer = ctx.req.headers.get('referer');

    // 1. Sec-Fetch-Site check (modern browsers)
    if (secFetchSite === 'cross-site') {
      if (!allowed || !origin || !allowed.has(origin)) {
        return Response.json(
          { status: 'error', code: 'CSRF_FORBIDDEN', message: 'Cross-site request blocked' },
          { status: 403 }
        );
      }
    }

    // 2. Origin / Referer check
    let sourceOrigin = origin;
    if (!sourceOrigin && referer) {
      try {
        sourceOrigin = new URL(referer).origin;
      } catch {
        return Response.json(
          { status: 'error', code: 'CSRF_FORBIDDEN', message: 'Invalid Referer header' },
          { status: 403 }
        );
      }
    }

    if (sourceOrigin) {
      const reqOrigin = resolveRequestOrigin(ctx);
      const isAllowed = (reqOrigin !== '' && sourceOrigin === reqOrigin) || (allowed !== null && allowed.has(sourceOrigin));
      if (!isAllowed) {
        return Response.json(
          { status: 'error', code: 'CSRF_FORBIDDEN', message: 'Origin mismatch' },
          { status: 403 }
        );
      }
    } else if (!allowMissingOrigin && secFetchSite !== 'same-origin') {
      return Response.json(
        { status: 'error', code: 'CSRF_FORBIDDEN', message: 'Missing Origin or Referer header' },
        { status: 403 }
      );
    }

    // 3. Optional double-submit token check
    if (requireToken) {
      const cookieToken = ctx.cookies[cookieName];
      const headerToken = ctx.req.headers.get(headerName);
      let tokensMatch = false;
      if (cookieToken && headerToken) {
        const a = Buffer.from(cookieToken);
        const b = Buffer.from(headerToken);
        tokensMatch = a.length === b.length && timingSafeEqual(a, b);
      }
      if (!tokensMatch) {
        return Response.json(
          { status: 'error', code: 'CSRF_TOKEN_INVALID', message: 'Invalid or missing CSRF token' },
          { status: 403 }
        );
      }
    }

    return next();
  };
};
