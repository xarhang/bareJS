import type { Middleware } from '../core/context';

export interface SecurityHeadersOptions {
  contentSecurityPolicy?: string | false;
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  hsts?: string | false;
  referrerPolicy?: string | false;
  noSniff?: boolean;
}

export const securityHeaders = (options: SecurityHeadersOptions = {}): Middleware => {
  const headersToSet: [string, string][] = [];

  if (options.noSniff !== false) {
    headersToSet.push(['X-Content-Type-Options', 'nosniff']);
  }
  if (options.frameOptions !== false) {
    headersToSet.push(['X-Frame-Options', options.frameOptions ?? 'DENY']);
  }
  if (options.referrerPolicy !== false) {
    headersToSet.push(['Referrer-Policy', options.referrerPolicy ?? 'strict-origin-when-cross-origin']);
  }
  if (options.hsts !== false) {
    headersToSet.push(['Strict-Transport-Security', options.hsts ?? 'max-age=31536000; includeSubDomains']);
  }
  if (options.contentSecurityPolicy) {
    headersToSet.push(['Content-Security-Policy', options.contentSecurityPolicy]);
  }
  headersToSet.push(['X-XSS-Protection', '0']);

  const len = headersToSet.length;

  return (ctx, next) => {
    for (let i = 0; i < len; i++) {
      const pair = headersToSet[i]!;
      ctx.setHeader(pair[0], pair[1]);
    }

    const res = next?.();
    if (res && typeof (res as any).then === 'function') {
      return (res as Promise<any>).then((r) => {
        if (r instanceof Response) {
          for (let i = 0; i < len; i++) {
            const pair = headersToSet[i]!;
            if (!r.headers.has(pair[0])) r.headers.set(pair[0], pair[1]);
          }
        }
        return r;
      });
    }
    if (res instanceof Response) {
      for (let i = 0; i < len; i++) {
        const pair = headersToSet[i]!;
        if (!res.headers.has(pair[0])) res.headers.set(pair[0], pair[1]);
      }
    }
    return res;
  };
};
