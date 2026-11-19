import type { Context, Middleware, Next } from '../core/context';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';

export type CompressionEncoding = 'zstd' | 'br' | 'gzip';

export interface CompressOptions {
  /** Minimum response size in bytes before compression is applied (default: 1024) */
  minSize?: number;
  /** Gzip compression level 0-9 (default: 6) */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** Preferred compression encodings in priority order (default: ['zstd', 'br', 'gzip']) */
  encodings?: CompressionEncoding[];
}

/**
 * Zero-dependency response compression middleware supporting zstd, brotli (br), and gzip.
 * Negotiates encoding from Accept-Encoding, and skips streaming SSE, 204/304, already-encoded, and small payloads.
 */
export const compress = (options: CompressOptions = {}): Middleware => {
  const minSize = options.minSize ?? 1024;
  const level = options.level ?? 6;
  const encodings: CompressionEncoding[] = options.encodings ?? ['zstd', 'br', 'gzip'];
  const hasZstd = typeof (Bun as any).zstdCompressSync === 'function';

  const isAccepted = (lower: string, enc: CompressionEncoding): boolean => {
    const idx = lower.indexOf(enc);
    if (idx === -1) return false;
    const comma = lower.indexOf(',', idx);
    const segment = comma === -1 ? lower.slice(idx) : lower.slice(idx, comma);
    const qIdx = segment.indexOf(';q=');
    if (qIdx !== -1) {
      const qVal = parseFloat(segment.slice(qIdx + 3));
      if (Number.isFinite(qVal) && qVal <= 0) return false;
    }
    return true;
  };

  const negotiate = (accept: string): CompressionEncoding | null => {
    const lower = accept.toLowerCase();
    for (let i = 0; i < encodings.length; i++) {
      const enc = encodings[i]!;
      if (enc === 'zstd' && !hasZstd) continue;
      if (isAccepted(lower, enc)) return enc;
    }
    return null;
  };

  const applyCompress = async (ctx: Context, res: any) => {
    if (ctx.req.method === 'HEAD') return res;
    const accept = ctx.req.headers.get('accept-encoding');
    if (!accept) return res;
    const chosen = negotiate(accept);
    if (!chosen) return res;
    if (!(res instanceof Response)) return res;
    if (res.status === 204 || res.status === 304) return res;
    if (res.headers.has('content-encoding')) return res;

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) return res;

    const buf = await res.arrayBuffer();
    if (buf.byteLength < minSize) {
      return new Response(buf, { status: res.status, headers: res.headers });
    }

    const raw = new Uint8Array(buf);
    let compressed: Uint8Array;
    if (chosen === 'zstd') {
      compressed = (Bun as any).zstdCompressSync(raw);
    } else if (chosen === 'br') {
      compressed = brotliCompressSync(raw, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: Math.min(11, Math.max(1, level)) }
      });
    } else {
      compressed = Bun.gzipSync(raw, { level });
    }

    const headers = new Headers(res.headers);
    headers.set('Content-Encoding', chosen);
    headers.set('Vary', 'Accept-Encoding');
    headers.delete('Content-Length');

    return new Response(compressed, { status: res.status, headers });
  };

  const mw: Middleware = async (ctx: Context, next?: Next) => {
    const res = await (next ? next() : undefined);
    return applyCompress(ctx, res);
  };
  (mw as any).__compress = applyCompress;
  return mw;
};
