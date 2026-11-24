import type { RuntimeDriver, RuntimeFileHandle, RuntimePasswordConfig, ServeOptions, ServerHandle } from './types';
import { matchWsRoute, type WebSocketRouteHandler } from '../core/ws-match';

const _zstd = typeof (globalThis as any).Bun?.zstdCompressSync === 'function'
  ? (data: Uint8Array): Uint8Array => (globalThis as any).Bun.zstdCompressSync(data)
  : undefined;

export const bunDriver: RuntimeDriver = {
  name: 'bun',

  serve(opts: ServeOptions): ServerHandle {
    const wsCfg = opts.ws;
    const server = wsCfg
      ? Bun.serve<WebSocketRouteHandler>({
          port: opts.port,
          hostname: opts.hostname,
          reusePort: opts.reusePort,
          maxRequestBodySize: opts.maxRequestBodySize,
          fetch(req: Request, srv: any) {
            if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
              const matched = matchWsRoute(wsCfg.routes, req.url);
              if (
                matched &&
                srv.upgrade(req, {
                  data: matched.params ? { ...matched.handler, params: matched.params } : matched.handler
                })
              ) {
                return undefined as any;
              }
            }
            return opts.fetch(req, srv?.requestIP?.(req)?.address);
          },
          websocket: wsCfg.adapter
        })
      : Bun.serve({
          port: opts.port,
          hostname: opts.hostname,
          reusePort: opts.reusePort,
          maxRequestBodySize: opts.maxRequestBodySize,
          fetch(req: Request, srv: any) {
            return opts.fetch(req, srv?.requestIP?.(req)?.address);
          }
        });

    return {
      stop(closeActiveConnections = false) {
        server.stop(closeActiveConnections);
      },
      port: server.port ?? opts.port,
      raw: server
    };
  },

  gzip(data: Uint8Array, level: number): Uint8Array {
    return Bun.gzipSync(data as any, { level: level as any });
  },

  zstd: _zstd,

  openFile(path: string): RuntimeFileHandle {
    const file = Bun.file(path);
    return {
      get type() {
        return file.type;
      },
      full() {
        return file;
      },
      slice(start: number, endExclusive: number) {
        return file.slice(start, endExclusive);
      }
    };
  },

  password: {
    hash(data: string, cfg: RuntimePasswordConfig): Promise<string> {
      if (cfg.algorithm === 'bcrypt') {
        const cost = Math.max(4, Math.min(31, cfg.timeCost));
        return Bun.password.hash(data, { algorithm: 'bcrypt', cost });
      }
      return Bun.password.hash(data, cfg);
    },
    verify(data: string, hash: string): Promise<boolean> {
      return Bun.password.verify(data, hash);
    }
  }
};
