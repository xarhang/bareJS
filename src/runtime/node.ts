import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { RuntimeDriver, RuntimeFileHandle, RuntimePasswordConfig, ServeOptions, ServerHandle } from './types';
import { matchWsRoute } from '../core/ws-match';

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.csv': 'text/csv; charset=utf-8',
};

function toWebRequest(req: IncomingMessage, maxBodySize: number): { request?: Request; errorStatus?: number } {
  const host = req.headers.host || 'localhost';
  const url = `http://${host}${req.url || '/'}`;
  const method = req.method || 'GET';

  const clRaw = req.headers['content-length'];
  if (clRaw !== undefined) {
    const cl = Number(Array.isArray(clRaw) ? clRaw[0] : clRaw);
    if (Number.isFinite(cl) && cl > maxBodySize) {
      return { errorStatus: 413 };
    }
  }

  const headers = new Headers();
  const raw = req.rawHeaders;
  if (raw && raw.length > 0) {
    for (let i = 0; i < raw.length; i += 2) {
      headers.append(raw[i]!, raw[i + 1]!);
    }
  } else {
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) {
        for (const item of v) headers.append(k, item);
      } else {
        headers.set(k, v);
      }
    }
  }

  const hasBody = method !== 'GET' && method !== 'HEAD';
  let body: ReadableStream<Uint8Array> | undefined;
  if (hasBody) {
    let total = 0;
    const nodeStream = req;
    body = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > maxBodySize) {
            const err: any = new Error('Payload Too Large');
            err.status = 413;
            controller.error(err);
            nodeStream.destroy();
            return;
          }
          controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        });
        nodeStream.on('end', () => {
          try { controller.close(); } catch {}
        });
        nodeStream.on('error', (err) => {
          try { controller.error(err); } catch {}
        });
      },
      cancel() {
        nodeStream.destroy();
      }
    });
  }

  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (body) {
    init.body = body;
    init.duplex = 'half';
  }
  return { request: new Request(url, init) };
}

async function writeWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  if (res.writableEnded || res.destroyed) return;

  const headersObj: Record<string, string | string[]> = {};
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    headersObj[key] = value;
  });
  const cookies = typeof (webRes.headers as any).getSetCookie === 'function'
    ? (webRes.headers as any).getSetCookie()
    : [];
  if (cookies.length > 0) {
    headersObj['set-cookie'] = cookies;
  }

  res.writeHead(webRes.status, headersObj);
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  if (!webRes.body) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed || res.writableEnded) {
        await reader.cancel().catch(() => {});
        break;
      }
      if (value && value.byteLength > 0) {
        const ok = res.write(value);
        if (!ok) {
          await new Promise<void>((resolve) => {
            const onDrain = () => { res.off('close', onClose); resolve(); };
            const onClose = () => { res.off('drain', onDrain); resolve(); };
            res.once('drain', onDrain);
            res.once('close', onClose);
          });
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
}

export const nodeDriver: RuntimeDriver = {
  name: 'node',

  serve(opts: ServeOptions): ServerHandle {
    const server = createServer(async (req, res) => {
      const parsed = toWebRequest(req, opts.maxRequestBodySize);
      if (parsed.errorStatus === 413 || !parsed.request) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Payload Too Large' }));
        req.resume();
        return;
      }

      const peerIp = req.socket?.remoteAddress;
      try {
        const webRes = await opts.fetch(parsed.request, peerIp);
        await writeWebResponse(webRes, res);
      } catch (err: any) {
        if (!res.headersSent) {
          const status = err?.status === 413 ? 413 : 500;
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: err?.message || 'Internal Server Error' }));
        } else if (!res.writableEnded) {
          res.end();
        }
      }
    });

    if (opts.ws) {
      const wsCfg = opts.ws;
      let wssPromise: Promise<any> | null = null;
      const getWss = () => {
        if (!wssPromise) {
          const wsPkg = 'ws';
          wssPromise = import(wsPkg).then(
            (m: any) => new m.WebSocketServer({ noServer: true }),
            () => {
              throw new Error(
                '[BareJS] WebSocket on Node.js requires the optional peer dependency "ws". Install it with: npm install ws'
              );
            }
          );
        }
        return wssPromise;
      };

      server.on('upgrade', async (req, socket, head) => {
        const matched = matchWsRoute(wsCfg.routes, req.url || '/');
        if (!matched) {
          socket.destroy();
          return;
        }
        try {
          const wss = await getWss();
          wss.handleUpgrade(req, socket, head, (rawWs: any) => {
            const data = matched.params ? { ...matched.handler, params: matched.params } : matched.handler;
            rawWs.data = data;
            wsCfg.adapter.open(rawWs);
            rawWs.on('message', (msg: any, isBinary: boolean) => {
              const payload = isBinary ? (Buffer.isBuffer(msg) ? msg : Buffer.from(msg)) : msg.toString();
              wsCfg.adapter.message(rawWs, payload);
            });
            rawWs.on('close', (code: number, reason: Buffer) => {
              wsCfg.adapter.close(rawWs, code, reason?.toString?.() ?? '');
            });
          });
        } catch (err) {
          console.error(err);
          socket.destroy();
        }
      });
    }

    const listenOpts: any = { port: opts.port, host: opts.hostname };
    if (opts.reusePort) {
      // Node >= 22.12 supports reusePort; older Node ignores or throws EINVAL on unsupported platforms
      const parts = process.versions?.node?.split('.').map(Number) || [];
      if ((parts[0] ?? 0) > 22 || ((parts[0] ?? 0) === 22 && (parts[1] ?? 0) >= 12)) {
        listenOpts.reusePort = true;
      }
    }
    server.listen(listenOpts);

    const addr = server.address();
    const boundPort = typeof addr === 'object' && addr ? addr.port : opts.port;

    return {
      stop(closeActiveConnections = false) {
        return new Promise<void>((resolve) => {
          if (closeActiveConnections && typeof (server as any).closeAllConnections === 'function') {
            (server as any).closeAllConnections();
          }
          server.close(() => resolve());
        });
      },
      port: boundPort,
      raw: server
    };
  },

  gzip(data: Uint8Array, level: number): Uint8Array {
    return new Uint8Array(gzipSync(data, { level }));
  },

  openFile(path: string): RuntimeFileHandle {
    const ext = extname(path).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    return {
      type: mime,
      full() {
        return Readable.toWeb(createReadStream(path));
      },
      slice(start: number, endExclusive: number) {
        const endInclusive = Math.max(start, endExclusive - 1);
        return Readable.toWeb(createReadStream(path, { start, end: endInclusive }));
      }
    };
  },

  password: {
    async hash(data: string, cfg: RuntimePasswordConfig): Promise<string> {
      if (cfg.algorithm === 'bcrypt') {
        let bcrypt: any;
        try {
          const pkg = 'bcryptjs';
          bcrypt = await import(pkg);
        } catch {
          throw new Error(
            '[BareJS] bcrypt hashing on Node.js requires optional peer dependency "bcryptjs". Install it with: npm install bcryptjs'
          );
        }
        const cost = Math.max(4, Math.min(31, cfg.timeCost));
        return bcrypt.default ? bcrypt.default.hash(data, cost) : bcrypt.hash(data, cost);
      }
      let argon2: any;
      try {
        const pkg = '@node-rs/argon2';
        argon2 = await import(pkg);
      } catch {
        throw new Error(
          '[BareJS] Argon2id hashing on Node.js requires optional peer dependency "@node-rs/argon2". Install it with: npm install @node-rs/argon2'
        );
      }
      const fn = argon2.hash ?? argon2.default?.hash;
      return fn(data, {
        algorithm: argon2.Algorithm?.Argon2id ?? 2,
        memoryCost: cfg.memoryCost,
        timeCost: cfg.timeCost
      });
    },

    async verify(data: string, hash: string): Promise<boolean> {
      if (!hash || typeof hash !== 'string') return false;
      if (/^\$2[aby]\$/.test(hash)) {
        let bcrypt: any;
        try {
          const pkg = 'bcryptjs';
          bcrypt = await import(pkg);
        } catch {
          throw new Error(
            '[BareJS] bcrypt verification on Node.js requires optional peer dependency "bcryptjs".'
          );
        }
        return bcrypt.default ? bcrypt.default.compare(data, hash) : bcrypt.compare(data, hash);
      }
      let argon2: any;
      try {
        const pkg = '@node-rs/argon2';
        argon2 = await import(pkg);
      } catch {
        throw new Error(
          '[BareJS] Argon2id verification on Node.js requires optional peer dependency "@node-rs/argon2".'
        );
      }
      const fn = argon2.verify ?? argon2.default?.verify;
      return fn(hash, data);
    }
  }
};
