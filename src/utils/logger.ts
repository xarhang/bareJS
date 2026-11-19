import type { Context, Middleware } from '../core/context';

export interface LogEntry {
  timestamp: string;
  method: string;
  path: string;
  requestId?: string;
  ip?: string;
}

export interface LoggerOptions {
  /** Output format: 'pretty' (default) or 'json' */
  format?: 'pretty' | 'json';
  /** Attach X-Request-Id response header from ctx.requestId (default: true) */
  requestId?: boolean;
  /** Skip logging for matching requests */
  skip?: (ctx: Context, path: string) => boolean;
  /** Custom log sink (defaults to console.log) */
  onLog?: (entry: LogEntry) => void;
}

const getPath = (rawUrl: string): string => {
  const s = rawUrl.indexOf('/', 8);
  if (s === -1) return '/';
  const q = rawUrl.indexOf('?', s);
  return q === -1 ? rawUrl.slice(s) : rawUrl.slice(s, q);
};

/**
 * Lightweight structured/pretty request logger & X-Request-Id middleware.
 */
export const logger = (options: LoggerOptions = {}): Middleware => {
  const format = options.format ?? 'pretty';
  const attachId = options.requestId ?? true;
  const skip = options.skip;
  const sink = options.onLog;

  return (ctx: Context, next) => {
    const path = getPath(ctx.req.url);
    if (skip?.(ctx, path)) return next?.();

    const reqId = attachId ? ctx.requestId : undefined;
    if (reqId) {
      ctx.setHeader('x-request-id', reqId);
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      method: ctx.req.method,
      path,
      ...(reqId ? { requestId: reqId } : {}),
      ip: ctx.ip
    };

    if (sink) {
      sink(entry);
    } else if (format === 'json') {
      console.log(JSON.stringify(entry));
    } else {
      const idPart = reqId ? ` [${reqId.slice(0, 8)}]` : '';
      console.log(`[${entry.timestamp}] ${entry.method} ${entry.path}${idPart}`);
    }

    return next?.();
  };
};
