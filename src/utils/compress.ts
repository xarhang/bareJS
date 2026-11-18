import type { Context, Middleware, Next } from '../core/context';

export interface CompressOptions {
  /** Minimum response size in bytes before gzip compression is applied (default: 1024) */
  minSize?: number;
  /** Gzip compression level 0-9 (default: 6) */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

/**
 * Zero-dependency Gzip compression middleware powered by Bun.gzipSync (native C/Zig).
 * Skips streaming SSE responses, already-encoded responses, and payloads below minSize.
 */
export const compress = (options: CompressOptions = {}): Middleware => {
  const minSize = options.minSize ?? 1024;
  const level = options.level ?? 6;

  const applyCompress = async (ctx: Context, res: any) => {
    if (ctx.req.method === 'HEAD') return res;
    const accept = ctx.req.headers.get('accept-encoding');
    if (!accept || !accept.includes('gzip')) return res;
    if (!(res instanceof Response)) return res;
    if (res.status === 204 || res.status === 304) return res;
    if (res.headers.has('content-encoding')) return res;

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) return res;

    const buf = await res.arrayBuffer();
    if (buf.byteLength < minSize) {
      return new Response(buf, { status: res.status, headers: res.headers });
    }

    const gz = Bun.gzipSync(new Uint8Array(buf), { level });
    const headers = new Headers(res.headers);
    headers.set('Content-Encoding', 'gzip');
    headers.set('Vary', 'Accept-Encoding');
    headers.delete('Content-Length');

    return new Response(gz, { status: res.status, headers });
  };

  const mw: Middleware = async (ctx: Context, next?: Next) => {
    const res = await (next ? next() : undefined);
    return applyCompress(ctx, res);
  };
  (mw as any).__compress = applyCompress;
  return mw;
};
