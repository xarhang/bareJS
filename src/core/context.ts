import { createHmac, timingSafeEqual } from 'node:crypto';

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
  public _trustProxy: boolean = false;
  public _detached: boolean = false;
  constructor(trustProxy: boolean = false) {
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

  public getQuery(key: string): string | undefined {
    const q = this.query;
    return Object.hasOwn(q, key) ? q[key] : undefined;
  }

  public get cookies(): Record<string, string> {
    if (this._cookies !== undefined) return this._cookies;
    const result: Record<string, string> = {};
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
    let finalVal = value;
    if (options.secret) {
      const sig = createHmac('sha256', options.secret).update(value).digest('base64url');
      finalVal = `${value}.${sig}`;
    }
    let cookieStr = `${name}=${encodeURIComponent(finalVal)}`;
    cookieStr += `; Path=${path}`;
    if (options.domain) cookieStr += `; Domain=${options.domain}`;
    if (options.maxAge !== undefined) cookieStr += `; Max-Age=${Math.floor(options.maxAge)}`;
    if (options.expires) cookieStr += `; Expires=${options.expires.toUTCString()}`;
    if (options.httpOnly !== false) cookieStr += '; HttpOnly';
    if (options.secure) cookieStr += '; Secure';
    cookieStr += `; SameSite=${options.sameSite ?? 'Lax'}`;

    if (!this._setCookies) this._setCookies = [];
    this._setCookies.push(cookieStr);
    return this;
  }

  public getSignedCookie(name: string, secret: string): string | null {
    const raw = this.cookies[name];
    if (!raw) return null;
    const dotIdx = raw.lastIndexOf('.');
    if (dotIdx <= 0) return null;
    const value = raw.slice(0, dotIdx);
    const sigB64 = raw.slice(dotIdx + 1);
    const expected = createHmac('sha256', secret).update(value).digest();
    const actual = Buffer.from(sigB64, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null;
    }
    return value;
  }

  public deleteCookie(name: string, options: Pick<CookieOptions, 'path' | 'domain'> = {}): this {
    return this.setCookie(name, '', {
      ...options,
      maxAge: 0,
      expires: new Date(0)
    });
  }

  public async jsonBody(maxBytes: number = 1048576): Promise<any> {
    if (this.body !== undefined) return this.body;

    const contentType = this.req.headers.get("content-type");
    if (contentType && contentType.toLowerCase().includes("application/json")) {
      const lenHeader = this.req.headers.get("content-length");
      if (lenHeader !== null) {
        const trimmed = lenHeader.trim();
        const lenNum = trimmed.length > 0 ? Number(trimmed) : NaN;
        if (Number.isInteger(lenNum) && lenNum > maxBytes) {
          const err: any = new Error("Payload Too Large");
          err.status = 413;
          throw err;
        }
      }
      try {
        const text = await this.req.text();
        if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
          const err: any = new Error("Payload Too Large");
          err.status = 413;
          throw err;
        }
        return this.body = JSON.parse(text);
      } catch (e: any) {
        if (e?.status === 413) throw e;
        return this.body = null;
      }
    }
    return this.body = null;
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
    this._peerIp = undefined;
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
      let headers = this._headers;
      if (headers["content-type"] === undefined) {
        if (Object.isFrozen(headers)) {
          headers = { ...headers };
          this._headers = headers;
        }
        headers["content-type"] = "application/json";
      }
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
    this._headers[name.toLowerCase()] = value;
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
      'content-type': 'text/html; charset=utf-8',
      ...(this._headers || {})
    };
    return this._applyCookies(new Response(content, { status: status ?? this._status, headers }));
  }

  public text(content: string, status?: number): Response {
    const headers: Record<string, string> = {
      'content-type': 'text/plain; charset=utf-8',
      ...(this._headers || {})
    };
    return this._applyCookies(new Response(content, { status: status ?? this._status, headers }));
  }

  public redirect(url: string, status: number = 302): Response {
    const headers: Record<string, string> = {
      'location': url,
      ...(this._headers || {})
    };
    return this._applyCookies(new Response(null, { status, headers }));
  }

  public sse(
    source:
      | AsyncIterable<string | { event?: string; data: any; id?: string; retry?: number }>
      | ((send: (data: any, event?: string, id?: string) => void, close: () => void) => Promise<void> | void)
  ): Response {
    const encoder = new TextEncoder();
    const formatChunk = (chunk: string | { event?: string; data: any; id?: string; retry?: number }): Uint8Array => {
      if (typeof chunk === 'string') {
        return encoder.encode(`data: ${chunk}\n\n`);
      }
      let out = '';
      if (chunk.id !== undefined) out += `id: ${chunk.id}\n`;
      if (chunk.event !== undefined) out += `event: ${chunk.event}\n`;
      if (chunk.retry !== undefined) out += `retry: ${chunk.retry}\n`;
      const payload = typeof chunk.data === 'string' ? chunk.data : JSON.stringify(chunk.data);
      out += `data: ${payload}\n\n`;
      return encoder.encode(out);
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          if (typeof source === 'function') {
            let closed = false;
            const send = (data: any, event?: string, id?: string) => {
              if (!closed) controller.enqueue(formatChunk({ data, event, id }));
            };
            const close = () => {
              if (!closed) {
                closed = true;
                controller.close();
              }
            };
            await source(send, close);
            close();
          } else {
            for await (const item of source) {
              controller.enqueue(formatChunk(item));
            }
            controller.close();
          }
        } catch (err) {
          controller.error(err);
        }
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
    const hdr = this.req?.headers?.get('x-request-id');
    this._requestId = hdr && hdr.length > 0 && hdr.length <= 128 ? hdr : crypto.randomUUID();
    return this._requestId;
  }

  public get ip(): string {
    if (this._trustProxy) {
      const xff = this.req?.headers?.get('x-forwarded-for');
      if (xff) return xff.split(',')[0]!.trim();
      const forwarded =
        this.req?.headers?.get('x-real-ip') ||
        this.req?.headers?.get('cf-connecting-ip');
      if (forwarded) return forwarded;
    }
    return this._peerIp || '127.0.0.1';
  }

  public async upload(options: UploadOptions = {}): Promise<UploadResult> {
    const maxFileSize = options.maxFileSize ?? 5 * 1024 * 1024;
    const maxFiles = options.maxFiles ?? 10;
    const allowed = options.allowedTypes ? new Set(options.allowedTypes) : null;

    const ct = (this.req?.headers?.get('content-type') || '').toLowerCase();
    if (!ct.includes('multipart/form-data')) {
      throw Object.assign(new Error('Expected multipart/form-data'), { status: 400 });
    }

    const maxTotalBytes = maxFileSize * maxFiles;
    const contentLen = Number(this.req?.headers?.get('content-length') || 0);
    if (Number.isFinite(contentLen) && contentLen > maxTotalBytes + 65536) {
      throw Object.assign(new Error('Payload Too Large'), { status: 413 });
    }

    const form = await this.req.formData();
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    let totalBytes = 0;

    for (const [fieldName, value] of form.entries()) {
      if (typeof value === 'string') {
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
}