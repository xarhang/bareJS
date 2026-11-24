import type { WebSocketRouteHandler } from '../core/ws-match';

export interface ServeOptions {
  port: number;
  hostname: string;
  reusePort: boolean;
  maxRequestBodySize: number;
  fetch: (req: Request, peerIp?: string) => Response | Promise<Response>;
  ws?: {
    routes: Map<string, WebSocketRouteHandler>;
    adapter: {
      open(ws: any): void;
      message(ws: any, msg: any): void;
      close(ws: any, code: any, reason: any): void;
      drain(ws: any): void;
    };
  };
}

export interface ServerHandle {
  stop(closeActiveConnections?: boolean): void | Promise<void>;
  port: number;
  /** Underlying runtime server instance (e.g. Bun Server or node:http Server) */
  raw: any;
}

export interface RuntimeFileHandle {
  readonly type: string;
  full(): any;
  slice(start: number, endExclusive: number): any;
}

export interface RuntimePasswordConfig {
  algorithm: 'argon2id' | 'bcrypt';
  memoryCost: number;
  timeCost: number;
}

export interface RuntimeDriver {
  readonly name: 'bun' | 'node';
  serve(opts: ServeOptions): ServerHandle;
  gzip(data: Uint8Array, level: number): Uint8Array;
  zstd?: (data: Uint8Array) => Uint8Array;
  openFile(path: string): RuntimeFileHandle;
  password: {
    hash(data: string, cfg: RuntimePasswordConfig): Promise<string>;
    verify(data: string, hash: string): Promise<boolean>;
  };
}
