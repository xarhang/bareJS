import { createHmac, timingSafeEqual } from 'node:crypto';

const _peek: ((p: any) => any) | undefined = (globalThis as any).Bun?.peek;

let _userStreamsCreated = 0;
const _userStreams = new WeakSet<ReadableStream>();
if (typeof globalThis.ReadableStream === 'function' && !(globalThis.ReadableStream as any).__bareTracked) {
  const OrigRS = globalThis.ReadableStream;
  const ProxiedRS = new Proxy(OrigRS, {
    construct(target, args, newTarget) {
      const inst = Reflect.construct(target, args, newTarget);
      if (args[0] && typeof args[0].pull === 'function') {
        _userStreamsCreated++;
        _userStreams.add(inst);
      }
      return inst;
    }
  });
  (ProxiedRS as any).__bareTracked = true;
  globalThis.ReadableStream = ProxiedRS;
}
const _sharedTextDecoder = new TextDecoder();


export type Params = Record<string, string>;
export type Next = () => Promise<any> | any;
export type Middleware = (ctx: Context, next: Next) => Promise<any> | any;
export type Handler = (ctx: Context) => Promise<any> | any;
export type GroupCallback = (router: any) => void;
export type AuthUser = Record<string, any>;

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  secret?: string;
}

export interface UploadOptions {
  /** Max size per file in bytes (default: 5MB) */
  maxFileSize?: number;
  /** Max number of uploaded files (default: 10) */
  maxFiles?: number;
  /** Allowed MIME types (e.g. ['image/png', 'image/jpeg', 'application/pdf']) */
  allowedTypes?: string[];
}

export interface UploadedFile {
  fieldName: string;
  filename: string;
  safeName: string;
  type: string;
  size: number;
  file: File;
}

export interface UploadResult {
  fields: Record<string, string>;
  files: UploadedFile[];
}

export interface UploadStreamOptions {
  /** Max size per file in bytes (default: 100MB) */
  maxFileSize?: number;
  /** Max number of uploaded files (default: 10) */
  maxFiles?: number;
  /** Max size per text field in bytes (default: 1MB) */
  maxFieldSize?: number;
  /** Allowed MIME types (e.g. ['image/png', 'application/octet-stream']) */
  allowedTypes?: string[];
}

export interface UploadStreamPart {
  type: 'file' | 'field';
  fieldName: string;
  filename?: string;
  safeName?: string;
  contentType?: string;
  stream?: ReadableStream<Uint8Array>;
  value?: string;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const v = Number(parts[i]);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

export function isTrustedProxyIp(peerIp: string | undefined, trustProxy: boolean | string[]): boolean {
  if (trustProxy === true) return true;
  if (!trustProxy || !Array.isArray(trustProxy) || trustProxy.length === 0 || !peerIp) return false;
  const normalized = peerIp.startsWith('::ffff:') ? peerIp.slice(7) : peerIp;
  const peerInt = ipv4ToInt(normalized);
  for (let i = 0; i < trustProxy.length; i++) {
    const rule = trustProxy[i]!;
    if (rule === normalized || rule === peerIp) return true;
    const slash = rule.indexOf('/');
    if (slash !== -1 && peerInt !== null) {
      const baseInt = ipv4ToInt(rule.slice(0, slash));
      const bits = Number(rule.slice(slash + 1));
      if (baseInt !== null && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
        const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        if ((peerInt & mask) === (baseInt & mask)) return true;
      }
    }
  }
  return false;
}

export class Context {
  public req!: Request;
  public params: Params = {};
  public _status = 200;
  public _headers?: Record<string, string> | undefined = undefined;
  public store = new Map<string, any>();
  public body: any = undefined;
  public _query: Record<string, string> | undefined = undefined;
  public _cookies: Record<string, string> | undefined = undefined;
  public _setCookies: string[] | undefined = undefined;
  public _requestId: string | undefined = undefined;
  public _peerIp: string | undefined = undefined;
  public _trustProxy: boolean | string[] = false;
  public _detached: boolean = false;
  constructor(trustProxy: boolean | string[] = false) {
    this._trustProxy = trustProxy;
  }

  public get query(): Record<string, string> {
    if (this._query !== undefined) return this._query;
    const result: Record<string, string> = {};
    const url = this.req?.url;
    if (url) {
      const qIdx = url.indexOf('?');
      if (qIdx !== -1) {
        let start = qIdx + 1;
        const len = url.length;
        const hasPlus = url.indexOf('+', start) !== -1;
        const hasPct = url.indexOf('%', start) !== -1;
        while (start < len) {
          let amp = url.indexOf('&', start);
          if (amp === -1) amp = len;
          if (amp > start) {
            const eq = url.indexOf('=', start);
            let k: string;
            let v: string;
            if (eq !== -1 && eq < amp) {
              k = url.slice(start, eq);
              v = url.slice(eq + 1, amp);
            } else {
              k = url.slice(start, amp);
              v = '';
            }
            if (hasPlus) {
              if (k.indexOf('+') !== -1) k = k.replaceAll('+', ' ');
              if (v.indexOf('+') !== -1) v = v.replaceAll('+', ' ');
            }
            if (hasPct) {
              if (k.indexOf('%') !== -1) {
                try { k = decodeURIComponent(k); } catch { /* keep raw */ }
              }
              if (v.indexOf('%') !== -1) {
                try { v = decodeURIComponent(v); } catch { /* keep raw */ }
              }
            }
            if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
              result[k] = v;
            }
          }
          start = amp + 1;
        }
      }
    }
    this._query = result;
    return result;
  }

  /** All values for a (possibly repeated) query key, in order. */
  public queryAll(key: string): string[] {
    const url = this.req?.url;
    const qIdx = url ? url.indexOf('?') : -1;
    if (qIdx === -1) return [];
    const out: string[] = [];
    const sp = new URLSearchParams(url!.slice(qIdx + 1));
    for (const [k, v] of sp) if (k === key) out.push(v);
    return out;
  }

  public getQuery(key: string): string | undefined {
    const q = this.query;
    return Object.hasOwn(q, key) ? q[key] : undefined;
  }

  public get cookies(): Record<string, string> {
    if (this._cookies !== undefined) return this._cookies;
    const result: Record<string, string> = Object.create(null);
    const header = this.req?.headers?.get('cookie');
    if (header) {
      let start = 0;
      const len = header.length;
      while (start < len) {
        let semi = header.indexOf(';', start);
        if (semi === -1) semi = len;
        const eq = header.indexOf('=', start);
        if (eq !== -1 && eq < semi) {
          const k = header.slice(start, eq).trim();
          let v = header.slice(eq + 1, semi).trim();
          try {
            v = decodeURIComponent(v);
          } catch { /* keep raw */ }
          if (k && k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
            result[k] = v;
          }
        }
        start = semi + 1;
      }
    }
    this._cookies = result;
    return result;
  }

  public setCookie(name: string, value: string, options: CookieOptions = {}): this {
    if (!name || /[\r\n;= \t]/.test(name)) {
      throw new Error('Invalid cookie name');
    }
    const path = options.path ?? '/';
    if (/[\r\n;]/.test(path)) {
      throw new Error('Invalid cookie path');
    }
    if (options.domain && /[\r\n;]/.test(options.domain)) {
      throw new Error('Invalid cookie domain');
    }
    const sameSite = options.sameSite ?? 'Lax';
    if (sameSite !== 'Strict' && sameSite !== 'Lax' && sameSite !== 'None') {
      throw new Error('Invalid cookie sameSite');
    }
    let finalVal = value;
    if (options.secret) {
      const sig = createHmac('sha256', options.secret).update(value).digest('base64url');
      finalVal = `${value}.${sig}`;
    }
    let cookieStr = `${name}=${encodeURIComponent(finalVal)}`;
    cookieStr += `; Path=${path}`;
    if (options.domain) cookieStr += `; Domain=${options.domain}`;
    if (options.maxAge !== undefined && Number.isFinite(options.maxAge)) {
      cookieStr += `; Max-Age=${Math.floor(options.maxAge)}`;
    }
    if (options.expires && !Number.isNaN(options.expires.getTime())) {
      cookieStr += `; Expires=${options.expires.toUTCString()}`;
    }
    if (options.httpOnly !== false) cookieStr += '; HttpOnly';
    if (options.secure) cookieStr += '; Secure';
    cookieStr += `; SameSite=${sameSite}`;

    if (!this._setCookies) this._setCookies = [];
    this._setCookies.push(cookieStr);
    return this;
  }

  public getSignedCookie(name: string, secret: string): string | null {
    const cookies = this.cookies;
    if (!Object.hasOwn(cookies, name)) return null;
    const raw = cookies[name];
    if (typeof raw !== 'string' || !raw) return null;
    const dotIdx = raw.lastIndexOf('.');
    if (dotIdx < 0) return null;
    const value = raw.slice(0, dotIdx);
    const sigB64 = raw.slice(dotIdx + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(sigB64)) return null;
    const expected = createHmac('sha256', secret).update(value).digest();
    const actual = Buffer.from(sigB64, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null;
    }
    return value;
  }

  public deleteCookie(name: string, options: Pick<CookieOptions, 'path' | 'domain' | 'secure' | 'sameSite'> = {}): this {
    return this.setCookie(name, '', {
      ...options,
      maxAge: 0,
      expires: new Date(0)
    });
  }

  private async readBodyWithLimit(maxBytes: number): Promise<Uint8Array> {
    const reader = this.req.body!.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw Object.assign(new Error("Payload Too Large"), { status: 413 });
        }
        chunks.push(value);
      }
    }
    const combined = new Uint8Array(received);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      combined.set(chunks[i]!, offset);
      offset += chunks[i]!.byteLength;
    }
    return combined;
  }

  private _parseAndSanitizeJson(text: string, maxBytes: number): any {
    if (text.length > maxBytes || (text.length * 3 > maxBytes && Buffer.byteLength(text, 'utf-8') > maxBytes)) {
      const err: any = new Error("Payload Too Large");
      err.status = 413;
      throw err;
    }
    const parsed = JSON.parse(text);
    if (
      text.indexOf('__proto__') !== -1 ||
      text.indexOf('constructor') !== -1 ||
      text.indexOf('prototype') !== -1 ||
      text.indexOf('\\u') !== -1
    ) {
      const stack: any[] = [parsed];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          for (let i = 0; i < cur.length; i++) stack.push(cur[i]);
        } else {
          if (Object.hasOwn(cur, '__proto__')) delete cur['__proto__'];
          if (Object.hasOwn(cur, 'constructor')) delete cur['constructor'];
          if (Object.hasOwn(cur, 'prototype')) delete cur['prototype'];
          const keys = Object.keys(cur);
          for (let i = 0; i < keys.length; i++) stack.push(cur[keys[i]!]);
        }
      }
    }
    return this.body = parsed;
  }

  public jsonBodySyncOrAsync(maxBytes: number = 1048576): any {
    if (this.body !== undefined) return this.body;

    const headers = this.req.headers;
    const contentType = headers.get("content-type");
    if (
      contentType &&
      (contentType === "application/json" ||
        contentType.startsWith("application/json;") ||
        contentType.toLowerCase().includes("application/json"))
    ) {
      const lenHeader = headers.get("content-length");
      if (lenHeader !== null) {
        const trimmed = lenHeader.trim();
        const lenNum = trimmed.length > 0 ? Number(trimmed) : NaN;
        if (Number.isInteger(lenNum) && lenNum > maxBytes) {
          const err: any = new Error("Payload Too Large");
          err.status = 413;
          throw err;
        }
      }
      if (
        (lenHeader === null && headers.get("transfer-encoding") !== null) ||
        (_userStreamsCreated > 0 && this.req.body && _userStreams.has(this.req.body))
      ) {
        return this.readBodyWithLimit(maxBytes).then(
          (bytes) => {
            try {
              return this._parseAndSanitizeJson(_sharedTextDecoder.decode(bytes), maxBytes);
            } catch (e: any) {
              if (e?.status === 413) throw e;
              return (this.body = null);
            }
          },
          (e: any) => {
            if (e?.status === 413) throw e;
            return (this.body = null);
          }
        );
      }
      const tp = this.req.text();
      const peeked = _peek !== undefined ? _peek(tp) : tp;
      if (typeof peeked === "string") {
        try {
          return this._parseAndSanitizeJson(peeked, maxBytes);
        } catch (e: any) {
          if (e?.status === 413) throw e;
          return (this.body = null);
        }
      }
      return tp.then(
        (text) => {
          try {
            return this._parseAndSanitizeJson(text, maxBytes);
          } catch (e: any) {
            if (e?.status === 413) throw e;
            return (this.body = null);
          }
        },
        (e: any) => {
          if (e?.status === 413) throw e;
          return (this.body = null);
        }
      );
    }
    return (this.body = null);
  }

  public async jsonBody(maxBytes: number = 1048576): Promise<any> {
    return this.jsonBodySyncOrAsync(maxBytes);
  }

  public reset(req: Request): this {
    this.req = req;
    this._status = 200;
    this._headers = undefined;
    if (this.store.size > 0) this.store.clear();
    this.params = {};
    this._query = undefined;
    this._cookies = undefined;
    this._setCookies = undefined;
    this.body = undefined;
    this._requestId = undefined;
    this._peerIp = undefined;
    this._detached = false;
    return this;
  }

  public status(code: number): this {
    this._status = code;
    return this;
  }

  private _applyCookies(res: Response): Response {
    if (this._setCookies) {
      for (let i = 0; i < this._setCookies.length; i++) {
        res.headers.append('Set-Cookie', this._setCookies[i]!);
      }
      this._setCookies = undefined;
    }
    return res;
  }

  public json(data: any): Response {
    const status = this._status || 200;
    let res: Response;

    if (!this._headers) {
      res = status === 200
        ? Response.json(data)
        : Response.json(data, { status });
    } else {
      const headers = this._headers["content-type"] === undefined
        ? { ...this._headers, "content-type": "application/json" }
        : this._headers;
      res = Response.json(data, {
        status,
        headers: headers as any
      });
    }

    return this._applyCookies(res);
  }

  public set(key: string, value: any): this {
    this.store.set(key, value);
    return this;
  }

  public get(key: string): any {
    return this.store.get(key);
  }

  public setHeader(name: string, value: string): this {
    if (!this._headers) this._headers = {};
    else if (Object.isFrozen(this._headers)) this._headers = { ...this._headers };
    const lower = name.toLowerCase();
    if (lower === 'vary' && this._headers['vary']) {
      const existing = this._headers['vary'];
      const parts = existing.toLowerCase().split(',').map((s) => s.trim());
      const toAdd = value.split(',').map((s) => s.trim()).filter((s) => s && !parts.includes(s.toLowerCase()));
      this._headers['vary'] = toAdd.length > 0 ? `${existing}, ${toAdd.join(', ')}` : existing;
    } else {
      this._headers[lower] = value;
    }
    return this;
  }

  public get user(): AuthUser | undefined {
    return this.store.get('user');
  }
  

  public send(message: string, extra: Record<string, any> = {}): Response {
    const isError = this._status >= 400;
    
    return this.json({
      status: isError ? "error" : "success",
      msg: message,
      ...extra
    });
  }

  public html(content: string, status?: number): Response {
    const headers: Record<string, string> = {
      ...(this._headers || {}),
      'content-type': 'text/html; charset=utf-8'
    };
    return this._applyCookies(new Response(content, { status: status ?? this._status, headers }));
  }

  public text(content: string, status?: number): Response {
    const headers: Record<string, string> = {
      ...(this._headers || {}),
      'content-type': 'text/plain; charset=utf-8'
    };
    return this._applyCookies(new Response(content, { status: status ?? this._status, headers }));
  }

  public redirect(url: string, status: number = 302): Response {
    if (/[\r\n]/.test(url)) {
      throw new Error('Invalid redirect URL');
    }
    const headers: Record<string, string> = {
      ...(this._headers || {}),
      'location': url
    };
    return this._applyCookies(new Response(null, { status, headers }));
  }

  public sse(
    source:
      | AsyncIterable<string | { event?: string; data: any; id?: string; retry?: number }>
      | ((send: (data: any, event?: string, id?: string) => void, close: () => void) => Promise<void> | void)
  ): Response {
    const encoder = new TextEncoder();
    const formatDataLines = (raw: string): string =>
      raw.split(/\r\n|\r|\n/).map((line) => `data: ${line}`).join('\n') + '\n\n';
    const formatChunk = (chunk: string | { event?: string; data: any; id?: string; retry?: number }): Uint8Array => {
      if (typeof chunk === 'string') {
        return encoder.encode(formatDataLines(chunk));
      }
      let out = '';
      if (chunk.id !== undefined) out += `id: ${String(chunk.id).replace(/[\r\n]/g, '')}\n`;
      if (chunk.event !== undefined) out += `event: ${String(chunk.event).replace(/[\r\n]/g, '')}\n`;
      if (chunk.retry !== undefined && Number.isFinite(chunk.retry)) out += `retry: ${Math.max(0, Math.floor(chunk.retry))}\n`;
      const payload = chunk.data === undefined
        ? ''
        : (typeof chunk.data === 'string' ? chunk.data : JSON.stringify(chunk.data));
      out += formatDataLines(payload);
      return encoder.encode(out);
    };

    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const safeClose = () => {
          if (!closed) {
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          }
        };
        try {
          if (typeof source === 'function') {
            const send = (data: any, event?: string, id?: string) => {
              if (!closed) {
                try { controller.enqueue(formatChunk({ data, event, id })); } catch { closed = true; }
              }
            };
            const maybePromise = source(send, safeClose);
            if (maybePromise && typeof (maybePromise as any).then === 'function') {
              await maybePromise;
              safeClose();
            }
          } else {
            for await (const item of source) {
              if (closed) break;
              try { controller.enqueue(formatChunk(item)); } catch { closed = true; break; }
            }
            safeClose();
          }
        } catch (err) {
          if (!closed) {
            closed = true;
            try { controller.error(err); } catch { /* already closed */ }
          }
        }
      },
      cancel() {
        closed = true;
      }
    });

    const headers: Record<string, string> = {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      ...(this._headers || {})
    };
    return this._applyCookies(new Response(stream, { status: this._status || 200, headers }));
  }

  public get requestId(): string {
    if (this._requestId !== undefined) return this._requestId;
    const raw = this.req?.headers?.get('x-request-id');
    const hdr = raw ? raw.replace(/[\x00-\x1f\x7f]/g, '') : '';
    this._requestId = hdr.length > 0 && hdr.length <= 128 ? hdr : crypto.randomUUID();
    return this._requestId;
  }

  public get ip(): string {
    if (isTrustedProxyIp(this._peerIp, this._trustProxy)) {
      const xff = this.req?.headers?.get('x-forwarded-for');
      if (xff) {
        const first = xff.split(',')[0]?.trim();
        if (first) return first;
      }
      const forwarded =
        this.req?.headers?.get('x-real-ip')?.trim() ||
        this.req?.headers?.get('cf-connecting-ip')?.trim();
      if (forwarded) return forwarded;
    }
    return this._peerIp || '127.0.0.1';
  }

  public async upload(options: UploadOptions = {}): Promise<UploadResult> {
    const maxFileSize = options.maxFileSize ?? 5 * 1024 * 1024;
    const maxFiles = options.maxFiles ?? 10;
    const allowed = options.allowedTypes
      ? new Set(options.allowedTypes.map((t) => t.trim().toLowerCase()))
      : null;

    const ct = (this.req?.headers?.get('content-type') || '').toLowerCase();
    if (!ct.includes('multipart/form-data')) {
      throw Object.assign(new Error('Expected multipart/form-data'), { status: 400 });
    }

    const maxTotalBytes = maxFileSize * maxFiles;
    const maxRawBytes = maxTotalBytes + 65536;
    const contentLen = Number(this.req?.headers?.get('content-length') || 0);
    if (Number.isFinite(contentLen) && contentLen > maxRawBytes) {
      throw Object.assign(new Error('Payload Too Large'), { status: 413 });
    }

    let form: Awaited<ReturnType<Request['formData']>>;
    try {
      if (this.req.body) {
        const combined = await this.readBodyWithLimit(maxRawBytes);
        form = await new Response(combined, { headers: this.req.headers }).formData();
      } else {
        form = await this.req.formData();
      }
    } catch (e: any) {
      if (e?.status === 413) throw e;
      throw Object.assign(new Error('Malformed multipart/form-data payload'), { status: 400 });
    }
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    let totalBytes = 0;

    for (const [fieldName, value] of form.entries()) {
      if (typeof value === 'string') {
        totalBytes += Buffer.byteLength(value, 'utf-8');
        if (totalBytes > maxTotalBytes) {
          throw Object.assign(new Error(`Total upload size exceeds ${maxTotalBytes} bytes`), { status: 413 });
        }
        if (fieldName !== '__proto__' && fieldName !== 'constructor' && fieldName !== 'prototype') {
          fields[fieldName] = value;
        }
        continue;
      }

      const fileObj = value as unknown as File;
      if (files.length >= maxFiles) {
        throw Object.assign(new Error(`Too many files (max ${maxFiles})`), { status: 413 });
      }
      if (fileObj.size > maxFileSize) {
        throw Object.assign(new Error(`File exceeds max size of ${maxFileSize} bytes`), { status: 413 });
      }
      totalBytes += fileObj.size;
      if (totalBytes > maxTotalBytes) {
        throw Object.assign(new Error(`Total upload size exceeds ${maxTotalBytes} bytes`), { status: 413 });
      }
      const mime = (fileObj.type || '').split(';')[0]!.trim().toLowerCase();
      if (allowed && !allowed.has(mime)) {
        throw Object.assign(new Error(`Unsupported file type: ${fileObj.type || 'unknown'}`), { status: 415 });
      }

      const rawName = fileObj.name || 'file';
      const baseName = rawName.split(/[\\/]/).pop() || 'file';
      const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'file';

      files.push({
        fieldName,
        filename: rawName,
        safeName,
        type: fileObj.type,
        size: fileObj.size,
        file: fileObj
      });
    }

    return { fields, files };
  }

  /**
   * True streaming multipart/form-data parser.
   * Streams file parts chunk-by-chunk with backpressure and constant O(chunk) memory usage.
   */
  public async *uploadStream(options: UploadStreamOptions = {}): AsyncGenerator<UploadStreamPart> {
    const maxFileSize = options.maxFileSize ?? 100 * 1024 * 1024;
    const maxFiles = options.maxFiles ?? 10;
    const maxFieldSize = options.maxFieldSize ?? 1024 * 1024;
    const allowed = options.allowedTypes
      ? new Set(options.allowedTypes.map((t) => t.trim().toLowerCase()))
      : null;

    const ct = this.req?.headers?.get('content-type') || '';
    if (!ct.toLowerCase().includes('multipart/form-data')) {
      throw Object.assign(new Error('Expected multipart/form-data'), { status: 400 });
    }
    const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    const boundary = bMatch?.[1] || bMatch?.[2];
    if (!boundary) {
      throw Object.assign(new Error('Missing multipart boundary'), { status: 400 });
    }

    if (!this.req.body) return;

    const encoder = new TextEncoder();
    const firstBoundary = encoder.encode(`--${boundary}`);
    const partBoundary = encoder.encode(`\r\n--${boundary}`);
    const crlfcrlf = encoder.encode('\r\n\r\n');

    const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array, from = 0): number => {
      const nLen = needle.byteLength;
      const limit = haystack.byteLength - nLen;
      const first = needle[0]!;
      let i = from;
      while (i <= limit) {
        const pos = haystack.indexOf(first, i);
        if (pos === -1 || pos > limit) return -1;
        let match = true;
        for (let j = 1; j < nLen; j++) {
          if (haystack[pos + j] !== needle[j]) {
            match = false;
            break;
          }
        }
        if (match) return pos;
        i = pos + 1;
      }
      return -1;
    };

    const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
      if (a.byteLength === 0) return b;
      if (b.byteLength === 0) return a;
      const out = new Uint8Array(a.byteLength + b.byteLength);
      out.set(a, 0);
      out.set(b, a.byteLength);
      return out;
    };

    const reader = this.req.body.getReader();
    let buf: Uint8Array = new Uint8Array(0);
    let eof = false;

    const readMore = async (): Promise<boolean> => {
      if (eof) return false;
      const { done, value } = await reader.read();
      if (done || !value) {
        eof = true;
        return false;
      }
      buf = concatBytes(buf, value);
      return true;
    };

    const ensureBytes = async (minLen: number): Promise<boolean> => {
      while (buf.byteLength < minLen) {
        if (!(await readMore())) return false;
      }
      return true;
    };

    let fileCount = 0;

    try {
      // 1. Find initial boundary
      while (true) {
        const idx = indexOfBytes(buf, firstBoundary);
        if (idx !== -1) {
          buf = buf.subarray(idx + firstBoundary.byteLength);
          break;
        }
        if (buf.byteLength > firstBoundary.byteLength) {
          buf = buf.subarray(buf.byteLength - firstBoundary.byteLength);
        }
        if (!(await readMore())) {
          throw Object.assign(new Error('Malformed multipart/form-data payload'), { status: 400 });
        }
      }

      // Check for immediate closing "--" or "\r\n"
      while (true) {
        if (!(await ensureBytes(2))) {
          throw Object.assign(new Error('Malformed multipart/form-data payload'), { status: 400 });
        }
        if (buf[0] === 0x2d && buf[1] === 0x2d) {
          return; // "--" end of multipart
        }
        if (buf[0] === 0x0d && buf[1] === 0x0a) {
          buf = buf.subarray(2);
        } else if (buf[0] === 0x0a) {
          buf = buf.subarray(1);
        } else {
          throw Object.assign(new Error('Malformed multipart/form-data payload'), { status: 400 });
        }

        // 2. Read part headers up to \r\n\r\n (cap at 16KB)
        let hdrEnd = -1;
        while (true) {
          hdrEnd = indexOfBytes(buf, crlfcrlf);
          if (hdrEnd !== -1) break;
          if (buf.byteLength > 16384) {
            throw Object.assign(new Error('Multipart header too large'), { status: 400 });
          }
          if (!(await readMore())) {
            throw Object.assign(new Error('Malformed multipart/form-data payload'), { status: 400 });
          }
        }

        const headerText = _sharedTextDecoder.decode(buf.subarray(0, hdrEnd));
        buf = buf.subarray(hdrEnd + 4);

        let fieldName = '';
        let filename: string | undefined;
        let partContentType = 'application/octet-stream';

        for (const line of headerText.split('\r\n')) {
          const colon = line.indexOf(':');
          if (colon === -1) continue;
          const k = line.slice(0, colon).trim().toLowerCase();
          const v = line.slice(colon + 1).trim();
          if (k === 'content-disposition') {
            const nameMatch = v.match(/;\s*name="([^"]*)"/i);
            if (nameMatch) fieldName = nameMatch[1]!;
            const fileMatch = v.match(/;\s*filename="([^"]*)"/i);
            if (fileMatch) filename = fileMatch[1]!;
          } else if (k === 'content-type') {
            partContentType = v;
          }
        }

        if (filename === undefined) {
          // 3a. Text field part
          while (true) {
            const bIdx = indexOfBytes(buf, partBoundary);
            if (bIdx !== -1) {
              if (bIdx > maxFieldSize) {
                throw Object.assign(new Error(`Field size exceeds ${maxFieldSize} bytes`), { status: 413 });
              }
              const val = _sharedTextDecoder.decode(buf.subarray(0, bIdx));
              buf = buf.subarray(bIdx + partBoundary.byteLength);
              if (fieldName !== '__proto__' && fieldName !== 'constructor' && fieldName !== 'prototype') {
                yield { type: 'field', fieldName, value: val };
              }
              break;
            }
            if (buf.byteLength - partBoundary.byteLength > maxFieldSize) {
              throw Object.assign(new Error(`Field size exceeds ${maxFieldSize} bytes`), { status: 413 });
            }
            if (!(await readMore())) {
              throw Object.assign(new Error('Malformed multipart/form-data payload'), { status: 400 });
            }
          }
        } else {
          // 3b. File part (streamed with backpressure)
          if (fileCount >= maxFiles) {
            throw Object.assign(new Error(`Too many files (max ${maxFiles})`), { status: 413 });
          }
          fileCount++;

          const mime = (partContentType || '').split(';')[0]!.trim().toLowerCase();
          if (allowed && !allowed.has(mime)) {
            throw Object.assign(new Error(`Unsupported file type: ${partContentType || 'unknown'}`), { status: 415 });
          }

          const baseName = filename.split(/[\\/]/).pop() || 'file';
          const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '') || 'file';

          let fileBytes = 0;
          let streamDone = false;
          let streamErrored: any = null;
          const keepTail = partBoundary.byteLength - 1;

          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              while (true) {
                const bIdx = indexOfBytes(buf, partBoundary);
                if (bIdx !== -1) {
                  const slice = buf.subarray(0, bIdx);
                  fileBytes += slice.byteLength;
                  if (fileBytes > maxFileSize) {
                    streamErrored = Object.assign(new Error(`File exceeds max size of ${maxFileSize} bytes`), { status: 413 });
                    controller.error(streamErrored);
                    return;
                  }
                  if (slice.byteLength > 0) controller.enqueue(slice);
                  buf = buf.subarray(bIdx + partBoundary.byteLength);
                  streamDone = true;
                  controller.close();
                  return;
                }

                const safeLen = buf.byteLength - keepTail;
                if (safeLen > 0) {
                  const slice = buf.subarray(0, safeLen);
                  fileBytes += slice.byteLength;
                  if (fileBytes > maxFileSize) {
                    streamErrored = Object.assign(new Error(`File exceeds max size of ${maxFileSize} bytes`), { status: 413 });
                    controller.error(streamErrored);
                    return;
                  }
                  buf = buf.subarray(safeLen);
                  controller.enqueue(slice);
                  return;
                }

                if (!(await readMore())) {
                  streamErrored = Object.assign(new Error('Malformed multipart/form-data payload'), { status: 400 });
                  controller.error(streamErrored);
                  return;
                }
              }
            },
            cancel() {
              streamDone = true;
            }
          });

          yield {
            type: 'file',
            fieldName,
            filename,
            safeName,
            contentType: partContentType,
            stream
          };

          if (streamErrored) throw streamErrored;

          // If consumer didn't drain the stream, skip remaining bytes up to next boundary
          if (!streamDone) {
            try {
              const sr = stream.getReader();
              while (true) {
                const { done } = await sr.read();
                if (done) break;
              }
              sr.releaseLock();
            } catch (e) {
              if (streamErrored) throw streamErrored;
              throw e;
            }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  }
}