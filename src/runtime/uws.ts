import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { ServeOptions, ServerHandle } from './types';

export interface UwsRouteEntry {
  method: string;
  path: string;
  paramNames: string[];
  rawHandler: Function;
  isPureStaticString: boolean;
  isTrulyZeroArg: boolean;
}

const HTTP_STATUS_TEXT: Record<number, string> = {
  200: '200 OK',
  201: '201 Created',
  202: '202 Accepted',
  204: '204 No Content',
  206: '206 Partial Content',
  301: '301 Moved Permanently',
  302: '302 Found',
  304: '304 Not Modified',
  400: '400 Bad Request',
  401: '401 Unauthorized',
  403: '403 Forbidden',
  404: '404 Not Found',
  405: '405 Method Not Allowed',
  409: '409 Conflict',
  413: '413 Payload Too Large',
  415: '415 Unsupported Media Type',
  422: '422 Unprocessable Entity',
  429: '429 Too Many Requests',
  500: '500 Internal Server Error',
  502: '502 Bad Gateway',
  503: '503 Service Unavailable'
};

function statusLine(code: number): string {
  return HTTP_STATUS_TEXT[code] || `${code}`;
}

export function tryLoadUws(): any | null {
  if (typeof (globalThis as any).Bun !== 'undefined' || typeof (globalThis as any).Deno !== 'undefined') {
    return null;
  }
  try {
    return createRequire(join(process.cwd(), 'package.json'))('uWebSockets.js');
  } catch {
    try {
      return createRequire(import.meta.url)('uWebSockets.js');
    } catch {
      return null;
    }
  }
}

class UwsContext {
  public res: any = null;
  public params: Record<string, string> = {};
  public store: Map<string, any> = new Map();
  public _status: number = 200;
  public _headers: Record<string, string> | undefined = undefined;
  public _setCookies: string[] | undefined = undefined;
  public _queryStr: string = '';
  public _query: Record<string, any> | undefined = undefined;
  public _url: string = '/';
  public _method: string = 'GET';
  public _reqHeaders: Record<string, string> | undefined = undefined;
  public _req: Request | undefined = undefined;
  public _peerIp: string | undefined = undefined;
  public _responded: boolean = false;
  public _inSync: boolean = false;
  public _aborted: boolean = false;

  public reset(): void {
    this.res = null;
    this.params = {};
    if (this.store.size > 0) this.store.clear();
    this._status = 200;
    this._headers = undefined;
    this._setCookies = undefined;
    this._queryStr = '';
    this._query = undefined;
    this._url = '/';
    this._method = 'GET';
    this._reqHeaders = undefined;
    this._req = undefined;
    this._peerIp = undefined;
    this._responded = false;
    this._inSync = false;
    this._aborted = false;
  }

  get req(): Request {
    if (!this._req) {
      const qs = this._queryStr ? `?${this._queryStr}` : '';
      const host = this._reqHeaders?.host || 'localhost';
      this._req = new Request(`http://${host}${this._url}${qs}`, {
        method: this._method,
        headers: this._reqHeaders
      });
    }
    return this._req;
  }

  get query(): Record<string, any> {
    if (!this._query) {
      const q: Record<string, any> = {};
      if (this._queryStr) {
        const sp = new URLSearchParams(this._queryStr);
        for (const [k, v] of sp) {
          if (k in q) {
            if (Array.isArray(q[k])) q[k].push(v);
            else q[k] = [q[k], v];
          } else {
            q[k] = v;
          }
        }
      }
      this._query = q;
    }
    return this._query;
  }

  get ip(): string {
    const xff = this._reqHeaders?.['x-forwarded-for'];
    if (xff) {
      const comma = xff.indexOf(',');
      return (comma === -1 ? xff : xff.slice(0, comma)).trim();
    }
    return this._reqHeaders?.['x-real-ip'] || this._reqHeaders?.['cf-connecting-ip'] || this._peerIp || '127.0.0.1';
  }

  public status(code: number): this {
    this._status = code;
    return this;
  }

  public setHeader(key: string, val: string): this {
    if (!this._headers) this._headers = {};
    this._headers[key.toLowerCase()] = val;
    return this;
  }

  public getHeader(key: string): string | undefined {
    return this._reqHeaders?.[key.toLowerCase()];
  }

  public header(key: string): string | undefined {
    return this.getHeader(key);
  }

  public set(key: string, val: any): this {
    this.store.set(key, val);
    return this;
  }

  public get<T = any>(key: string): T | undefined {
    return this.store.get(key);
  }

  private _flushJson(res: any, payload: string): void {
    if (this._status !== 200) res.writeStatus(statusLine(this._status));
    res.writeHeader('content-type', 'application/json');
    if (this._headers) {
      for (const k in this._headers) {
        if (k !== 'content-type') res.writeHeader(k, this._headers[k]);
      }
    }
    if (this._setCookies) {
      for (let i = 0; i < this._setCookies.length; i++) {
        res.writeHeader('set-cookie', this._setCookies[i]);
      }
    }
    res.end(payload);
  }

  public json(data: any): undefined {
    const res = this.res;
    if (!res || this._responded || this._aborted) return undefined;
    this._responded = true;
    const payload = JSON.stringify(data);
    if (this._inSync) {
      this._flushJson(res, payload);
    } else {
      res.cork(() => this._flushJson(res, payload));
    }
    return undefined;
  }

  private _flushText(res: any, data: string, code: number): void {
    if (code !== 200) res.writeStatus(statusLine(code));
    if (this._headers) {
      for (const k in this._headers) res.writeHeader(k, this._headers[k]);
    }
    if (this._setCookies) {
      for (let i = 0; i < this._setCookies.length; i++) {
        res.writeHeader('set-cookie', this._setCookies[i]);
      }
    }
    res.end(data);
  }

  public text(data: string, status?: number): undefined {
    const res = this.res;
    if (!res || this._responded || this._aborted) return undefined;
    this._responded = true;
    const code = status ?? this._status;
    if (this._inSync) {
      this._flushText(res, data, code);
    } else {
      res.cork(() => this._flushText(res, data, code));
    }
    return undefined;
  }

  public html(data: string, status?: number): undefined {
    this.setHeader('content-type', 'text/html; charset=utf-8');
    return this.text(data, status);
  }

  public redirect(url: string, status: number = 302): undefined {
    this.setHeader('location', url);
    return this.text('', status);
  }
}

function writeWebResponseToUws(res: any, webRes: Response): void {
  const status = webRes.status;
  if (status !== 200) res.writeStatus(statusLine(status));
  webRes.headers.forEach((value, key) => {
    res.writeHeader(key, value);
  });
  const anyHeaders = webRes.headers as any;
  if (typeof anyHeaders.getSetCookie === 'function') {
    const cookies: string[] = anyHeaders.getSetCookie();
    for (let i = 0; i < cookies.length; i++) {
      res.writeHeader('set-cookie', cookies[i]);
    }
  }
  if (!webRes.body) {
    res.end();
    return;
  }
  webRes.arrayBuffer().then(
    (buf) => {
      res.cork(() => {
        res.end(Buffer.from(buf));
      });
    },
    () => {
      try { res.close(); } catch {}
    }
  );
}

function writeOutToUws(res: any, ctx: UwsContext | null, out: any): void {
  if (ctx?._responded) return;
  if (out instanceof Response) {
    writeWebResponseToUws(res, out);
    return;
  }
  if (typeof out === 'string') {
    if (ctx) {
      ctx.text(out);
    } else {
      res.end(out);
    }
    return;
  }
  if (ctx) {
    ctx.json(out ?? null);
  } else {
    res.writeHeader('content-type', 'application/json');
    res.end(JSON.stringify(out ?? null));
  }
}

function writeUwsError(res: any, err: any): void {
  const code = err?.status >= 400 && err?.status < 500 ? err.status : 500;
  res.writeStatus(statusLine(code));
  res.writeHeader('content-type', 'application/json');
  const msg =
    code === 500
      ? (process.env.NODE_ENV === 'development' ? (err?.message || 'Internal Server Error') : 'Internal Server Error')
      : (err?.message || 'Bad Request');
  res.end(JSON.stringify({ status: code, message: msg }));
}

const UWS_METHOD_MAP: Record<string, string> = {
  GET: 'get',
  HEAD: 'head',
  DELETE: 'del',
  OPTIONS: 'options'
};

export function serveUws(
  opts: ServeOptions & { uwsRoutes?: UwsRouteEntry[] },
  uwsMod: any
): ServerHandle {
  const app = uwsMod.App();
  const isProd = process.env.NODE_ENV === 'production';
  const pool: UwsContext[] = [];
  const maxPool = 4096;

  // Tier 1: Direct uWS fast-path for bodyless methods (GET, HEAD, DELETE, OPTIONS)
  if (opts.uwsRoutes) {
    for (const r of opts.uwsRoutes) {
      const uwsMethod = UWS_METHOD_MAP[r.method];
      if (!uwsMethod) continue;

      if (isProd && r.isPureStaticString) {
        const buf = Buffer.from(r.rawHandler());
        app[uwsMethod](r.path, (res: any) => {
          res.end(buf);
        });
        continue;
      }

      if (isProd && r.isTrulyZeroArg) {
        const fn = r.rawHandler;
        app[uwsMethod](r.path, (res: any) => {
          try {
            const out = fn();
            if (out && typeof out.then === 'function') {
              let aborted = false;
              res.onAborted(() => { aborted = true; });
              out.then(
                (v: any) => {
                  if (!aborted) res.cork(() => writeOutToUws(res, null, v));
                },
                (e: any) => {
                  if (!aborted) res.cork(() => writeUwsError(res, e));
                }
              );
              return;
            }
            writeOutToUws(res, null, out);
          } catch (e) {
            writeUwsError(res, e);
          }
        });
        continue;
      }

      const fn = r.rawHandler;
      const paramNames = r.paramNames;
      const pLen = paramNames.length;
      const fnSrc = fn.toString();
      const needsHeaders = /\b(?:getHeader|header|ip|req)\b/.test(fnSrc);
      const needsQuery = /\b(?:query|req)\b/.test(fnSrc);

      app[uwsMethod](r.path, (res: any, req: any) => {
        const ctx = pool.length > 0 ? pool.pop()! : new UwsContext();
        ctx.res = res;
        if (pLen > 0) {
          const p: Record<string, string> = {};
          for (let i = 0; i < pLen; i++) {
            p[paramNames[i]] = req.getParameter(i);
          }
          ctx.params = p;
        }
        if (needsQuery) {
          ctx._queryStr = req.getQuery();
          ctx._url = req.getUrl();
          ctx._method = r.method;
        }
        if (needsHeaders) {
          const h: Record<string, string> = {};
          req.forEach((k: string, v: string) => {
            h[k] = v;
          });
          ctx._reqHeaders = h;
          ctx._url = req.getUrl();
          ctx._method = r.method;
        }

        ctx._inSync = true;
        try {
          const out = fn(ctx);
          ctx._inSync = false;
          if (out && typeof out.then === 'function') {
            res.onAborted(() => { ctx._aborted = true; });
            out.then(
              (v: any) => {
                if (!ctx._aborted && !ctx._responded) {
                  res.cork(() => writeOutToUws(res, ctx, v));
                }
                ctx.reset();
                if (pool.length < maxPool) pool.push(ctx);
              },
              (e: any) => {
                if (!ctx._aborted && !ctx._responded) {
                  res.cork(() => writeUwsError(res, e));
                }
                ctx.reset();
                if (pool.length < maxPool) pool.push(ctx);
              }
            );
            return;
          }
          if (!ctx._responded) writeOutToUws(res, ctx, out);
          ctx.reset();
          if (pool.length < maxPool) pool.push(ctx);
        } catch (e) {
          ctx._inSync = false;
          if (!ctx._responded) writeUwsError(res, e);
          ctx.reset();
          if (pool.length < maxPool) pool.push(ctx);
        }
      });
    }
  }

  // Tier 2: Full Web-Standard Request/Response fallback for POST/PUT/PATCH, middlewares, 404, etc.
  app.any('/*', (res: any, req: any) => {
    let aborted = false;
    res.onAborted(() => { aborted = true; });

    const method = req.getMethod().toUpperCase();
    const urlPath = req.getUrl();
    const queryStr = req.getQuery();
    const headers = new Headers();
    let host = 'localhost';
    req.forEach((k: string, v: string) => {
      if (k === 'host') host = v;
      headers.append(k, v);
    });
    const fullUrl = `http://${host}${urlPath}${queryStr ? `?${queryStr}` : ''}`;
    let peerIp = '127.0.0.1';
    try {
      peerIp = Buffer.from(res.getRemoteAddressAsText()).toString() || '127.0.0.1';
    } catch {}

    const dispatchFetch = (bodyBuf?: Buffer) => {
      if (aborted) return;
      const webReq = new Request(fullUrl, {
        method,
        headers,
        body: bodyBuf && bodyBuf.length > 0 ? (bodyBuf as any) : undefined
      });
      Promise.resolve(opts.fetch(webReq, peerIp)).then(
        (webRes) => {
          if (aborted) return;
          if (!webRes.body) {
            res.cork(() => {
              writeWebResponseToUws(res, webRes);
            });
            return;
          }
          webRes.arrayBuffer().then(
            (buf) => {
              if (aborted) return;
              res.cork(() => {
                const status = webRes.status;
                if (status !== 200) res.writeStatus(statusLine(status));
                webRes.headers.forEach((value, key) => {
                  res.writeHeader(key, value);
                });
                const anyHeaders = webRes.headers as any;
                if (typeof anyHeaders.getSetCookie === 'function') {
                  const cookies: string[] = anyHeaders.getSetCookie();
                  for (let i = 0; i < cookies.length; i++) {
                    res.writeHeader('set-cookie', cookies[i]);
                  }
                }
                res.end(Buffer.from(buf));
              });
            },
            () => {
              if (!aborted) try { res.close(); } catch {}
            }
          );
        },
        (e) => {
          if (!aborted) res.cork(() => writeUwsError(res, e));
        }
      );
    };

    if (method === 'GET' || method === 'HEAD') {
      dispatchFetch();
      return;
    }

    const chunks: Buffer[] = [];
    let totalLen = 0;
    const maxBody = opts.maxRequestBodySize || 10 * 1024 * 1024;
    let rejected = false;

    res.onData((ab: ArrayBuffer, isLast: boolean) => {
      if (aborted || rejected) return;
      const chunk = Buffer.from(ab);
      totalLen += chunk.length;
      if (totalLen > maxBody) {
        rejected = true;
        res.cork(() => {
          res.writeStatus('413 Payload Too Large');
          res.writeHeader('content-type', 'application/json');
          res.end(JSON.stringify({ status: 413, message: 'Payload Too Large' }));
        });
        return;
      }
      if (chunk.length > 0) chunks.push(chunk);
      if (isLast) {
        dispatchFetch(chunks.length === 0 ? undefined : chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
      }
    });
  });

  let listenSocket: any = null;
  let boundPort = opts.port;

  const ready = new Promise<void>((resolve, reject) => {
    app.listen(opts.hostname, opts.port, (token: any) => {
      if (!token) {
        reject(new Error(`[BareJS] uWebSockets.js failed to listen on ${opts.hostname}:${opts.port}`));
        return;
      }
      listenSocket = token;
      try {
        boundPort = uwsMod.us_socket_local_port(token) || opts.port;
      } catch {
        boundPort = opts.port;
      }
      resolve();
    });
  });

  const stopFn = () => {
    if (listenSocket) {
      try {
        uwsMod.us_listen_socket_close(listenSocket);
      } catch {}
      listenSocket = null;
    }
  };

  Object.defineProperty(app, 'port', {
    get: () => boundPort,
    configurable: true
  });
  app.stop = stopFn;
  app.ready = ready;

  return {
    get port() {
      return boundPort;
    },
    stop: stopFn,
    raw: app,
    ready
  } as ServerHandle & { ready: Promise<void> };
}
