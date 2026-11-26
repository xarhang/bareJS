import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import * as zlib from 'node:zlib';
import type { RuntimeDriver, RuntimeFileHandle, RuntimePasswordConfig, ServeOptions, ServerHandle } from './types';
import { matchWsRoute } from '../core/ws-match';
import { serveUws, tryLoadUws } from './uws';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

async function hashScrypt(data: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(data, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `$scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

async function verifyScrypt(data: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 5 || parts[1] !== 'scrypt') return false;
  const params: Record<string, number> = {};
  for (const kv of parts[2]!.split(',')) {
    const [k, v] = kv.split('=');
    if (k && v) params[k] = Number(v);
  }
  const N = params.N || SCRYPT_N;
  const r = params.r || SCRYPT_R;
  const p = params.p || SCRYPT_P;
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[3]!, 'base64url');
  const expected = Buffer.from(parts[4]!, 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;
  const derived = await scryptAsync(data, salt, expected.length, { N, r, p });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

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
    if (opts.engine !== 'http') {
      const uwsMod = tryLoadUws();
      if (uwsMod) {
        return serveUws(opts, uwsMod);
      }
      if (opts.engine === 'uws') {
        throw new Error("[BareJS] engine: 'uws' was requested, but 'uWebSockets.js' is not installed.");
      }
    }
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
            () => null
          );
        }
        return wssPromise;
      };

      const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
      const MAX_WS_FRAME = 16 * 1024 * 1024;

      const buildWsFrame = (opcode: number, payload: Buffer): Buffer => {
        const len = payload.length;
        let header: Buffer;
        if (len < 126) {
          header = Buffer.allocUnsafe(2);
          header[0] = 0x80 | opcode;
          header[1] = len;
        } else if (len < 65536) {
          header = Buffer.allocUnsafe(4);
          header[0] = 0x80 | opcode;
          header[1] = 126;
          header.writeUInt16BE(len, 2);
        } else {
          header = Buffer.allocUnsafe(10);
          header[0] = 0x80 | opcode;
          header[1] = 127;
          header.writeBigUInt64BE(BigInt(len), 2);
        }
        return Buffer.concat([header, payload]);
      };

      const handleNativeWsUpgrade = (req: IncomingMessage, socket: any, head: Buffer, data: any) => {
        const key = req.headers['sec-websocket-key'];
        if (!key || Array.isArray(key)) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }
        const accept = createHash('sha1').update(key.trim() + WS_GUID).digest('base64');
        socket.write(
          'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
        );

        let closed = false;
        const wsWrapper: any = {
          data,
          send(msg: string | Uint8Array | Buffer) {
            if (closed || socket.destroyed) return;
            if (typeof msg === 'string') {
              socket.write(buildWsFrame(0x1, Buffer.from(msg, 'utf8')));
            } else {
              const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg.buffer, msg.byteOffset, msg.byteLength);
              socket.write(buildWsFrame(0x2, buf));
            }
          },
          close(code = 1000, reason = '') {
            if (closed || socket.destroyed) return;
            closed = true;
            const reasonBuf = Buffer.from(reason, 'utf8');
            const payload = Buffer.allocUnsafe(2 + reasonBuf.length);
            payload.writeUInt16BE(code, 0);
            reasonBuf.copy(payload, 2);
            socket.end(buildWsFrame(0x8, payload));
            wsCfg.adapter.close(wsWrapper, code, reason);
          }
        };

        wsCfg.adapter.open(wsWrapper);

        let buf: Buffer = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
        let fragOpcode = 0;
        let fragChunks: Buffer[] = [];
        let fragTotal = 0;

        const processFrames = () => {
          while (buf.length >= 2) {
            const b0 = buf[0]!;
            const b1 = buf[1]!;
            const fin = (b0 & 0x80) !== 0;
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let payloadLen = b1 & 0x7f;
            let offset = 2;

            if (payloadLen === 126) {
              if (buf.length < 4) return;
              payloadLen = buf.readUInt16BE(2);
              offset = 4;
            } else if (payloadLen === 127) {
              if (buf.length < 10) return;
              const bigLen = buf.readBigUInt64BE(2);
              if (bigLen > BigInt(MAX_WS_FRAME)) {
                wsWrapper.close(1009, 'Message too big');
                socket.destroy();
                return;
              }
              payloadLen = Number(bigLen);
              offset = 10;
            }

            if (payloadLen > MAX_WS_FRAME) {
              wsWrapper.close(1009, 'Message too big');
              socket.destroy();
              return;
            }

            const maskLen = masked ? 4 : 0;
            if (buf.length < offset + maskLen + payloadLen) return;

            let payload = buf.subarray(offset + maskLen, offset + maskLen + payloadLen);
            if (masked) {
              const mask = buf.subarray(offset, offset + 4);
              const unmasked = Buffer.allocUnsafe(payloadLen);
              for (let i = 0; i < payloadLen; i++) {
                unmasked[i] = payload[i]! ^ mask[i & 3]!;
              }
              payload = unmasked;
            } else {
              payload = Buffer.from(payload);
            }

            buf = buf.subarray(offset + maskLen + payloadLen);

            if (opcode === 0x8) {
              const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
              const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
              wsWrapper.close(code, reason);
              return;
            }
            if (opcode === 0x9) {
              if (!closed && !socket.destroyed) socket.write(buildWsFrame(0xA, payload));
              continue;
            }
            if (opcode === 0xA) continue;

            if (opcode !== 0x0) {
              if (fin) {
                wsCfg.adapter.message(wsWrapper, opcode === 0x1 ? payload.toString('utf8') : payload);
              } else {
                fragOpcode = opcode;
                fragChunks = [payload];
                fragTotal = payload.length;
              }
            } else {
              fragTotal += payload.length;
              if (fragTotal > MAX_WS_FRAME) {
                wsWrapper.close(1009, 'Message too big');
                socket.destroy();
                return;
              }
              fragChunks.push(payload);
              if (fin) {
                const full = Buffer.concat(fragChunks);
                fragChunks = [];
                fragTotal = 0;
                wsCfg.adapter.message(wsWrapper, fragOpcode === 0x1 ? full.toString('utf8') : full);
              }
            }
          }
        };

        if (buf.length > 0) processFrames();

        socket.on('data', (chunk: Buffer) => {
          buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
          processFrames();
        });
        socket.on('close', () => {
          if (!closed) {
            closed = true;
            wsCfg.adapter.close(wsWrapper, 1006, '');
          }
        });
        socket.on('error', () => {
          if (!closed) {
            closed = true;
            wsCfg.adapter.close(wsWrapper, 1006, '');
          }
        });
      };

      server.on('upgrade', async (req, socket, head) => {
        const matched = matchWsRoute(wsCfg.routes, req.url || '/');
        if (!matched) {
          socket.destroy();
          return;
        }
        try {
          const wss = await getWss();
          const data = matched.params ? { ...matched.handler, params: matched.params } : matched.handler;
          if (!wss) {
            handleNativeWsUpgrade(req, socket, head, data);
            return;
          }
          wss.handleUpgrade(req, socket, head, (rawWs: any) => {
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

    const ready = new Promise<void>((resolve, reject) => {
      if (server.listening) {
        resolve();
        return;
      }
      const onErr = (err: any) => {
        if (err?.code === 'EADDRINUSE') {
          reject(new Error(`[BareJS] Port ${opts.port} is already in use on ${opts.hostname}. Choose a different port or stop the existing process.`));
        } else {
          reject(err);
        }
      };
      server.once('error', onErr);
      server.once('listening', () => {
        server.removeListener('error', onErr);
        resolve();
      });
    });

    const stopFn = (closeActiveConnections = false) =>
      new Promise<void>((resolve) => {
        if (closeActiveConnections && typeof (server as any).closeAllConnections === 'function') {
          (server as any).closeAllConnections();
        }
        server.close(() => resolve());
      });

    Object.defineProperty(server, 'port', {
      get() {
        const a = server.address();
        return typeof a === 'object' && a ? a.port : opts.port;
      },
      configurable: true
    });
    (server as any).stop = stopFn;
    (server as any).ready = ready;

    return {
      stop: stopFn,
      get port() {
        const a = server.address();
        return typeof a === 'object' && a ? a.port : opts.port;
      },
      raw: server
    };
  },

  gzip(data: Uint8Array, level: number): Uint8Array {
    return new Uint8Array(zlib.gzipSync(data, { level }));
  },

  zstd: typeof (zlib as any).zstdCompressSync === 'function'
    ? (data: Uint8Array): Uint8Array => new Uint8Array((zlib as any).zstdCompressSync(data))
    : undefined,

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
        return hashScrypt(data);
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
      if (hash.startsWith('$scrypt$')) {
        return verifyScrypt(data, hash);
      }
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
