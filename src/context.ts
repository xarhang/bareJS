// context.ts

export type Params = Record<string, string>;
export type Next = () => Promise<any> | any;

/**
 * 🎯 Hybrid Middleware Signature
 * Supports Context-only (379ns path), Standard Middleware, and Legacy Style.
 */
export type Middleware =
  | ((ctx: Context) => Promise<any> | any)
  | ((ctx: Context, next: Next) => Promise<any> | any)
  | ((req: Request, params: Params, next: Next) => Promise<any> | any);

// export type Handler = (ctx: Context) => Promise<any> | any;
export type ContextHandler = (ctx: Context) => Promise<any> | any;
export type NativeHandler = (req: Request, params: Params) => Promise<any> | any;

// 2. The Final Handler: This allows either (ctx) OR (req, params)
export type Handler = ContextHandler | NativeHandler;
export class Context {
  public req!: Request;
  public params!: Params;
  public _status: number = 200;

  // Clean prototype-less store for middleware data
  public store: any = Object.create(null);

  // Holds parsed JSON or form data from Validators
  public body: any = null;

  // Internal tracking for response construction
  public _headers: Record<string, string> = {};

  // Lazy-loaded caches
  private _searchParams: URLSearchParams | null = null;
  private _cookies: Map<string, string> | null = null;

  /**
   * 🏎️ Object Pool Reset
   * Memory-stable wipe to prevent GC spikes and keep nanosecond performance.
   */
  public reset(req: Request, params: Params): this {
    this.req = req;
    this.params = params;
    this._status = 200;
    this.body = null;
    this._headers = {};
    this._searchParams = null;
    this._cookies = null;

    // Wipe store without re-allocating object
    for (const key in this.store) {
      delete this.store[key];
    }

    return this;
  }

  // --- REQUEST HELPERS ---

  public header(key: string): string | null {
    
    return this.req.headers.get(key);
  }

  public query(key: string): string | null {
    if (!this._searchParams) {
      this._searchParams = new URL(this.req.url).searchParams;
    }
    return this._searchParams.get(key);
  }

  public cookie(name: string): string | undefined {
    if (!this._cookies) {
      this._cookies = new Map();
      const header = this.req.headers.get("cookie");
      if (header) {
        const matches = header.matchAll(/([^=\s]+)=([^;]+)/g);
        for (const match of matches) {
          if (match[1] && match[2]) this._cookies.set(match[1], match[2]);
        }
      }
    }
    return this._cookies.get(name);
  }

  public get ip(): string | null {
    return this.req.headers.get("x-forwarded-for") || null;
  }

  // --- RESPONSE HELPERS ---

  public status(code: number): this {
    this._status = code;
    return this;
  }

  public setHeader(key: string, value: string): this {
    this._headers[key.toLowerCase()] = value;
    return this;
  }

  // Header setter → chainable
  public set(key: string, value: string): this;

  // State setter → non-chainable
  public set(key: string, value: unknown): void;

  public set(key: string, value: unknown): this | void {
    if (typeof value === "string") {
      this._headers[key.toLowerCase()] = value;
      return this;
    }

    this.store[key] = value;
  }

  public get<T = any>(key: string): T {
    return this.store[key];
  }

  public setCookie(name: string, value: string, options: string = ""): this {
    this.setHeader("set-cookie", `${name}=${value}; ${options}`);
    return this;
  }

  // Finalizer hints
  public json(data: any) {
    this._headers['content-type'] = 'application/json';
    return data;
  }

  public text(data: string) {
    this._headers['content-type'] = 'text/plain; charset=utf-8';
    return data;
  }

  public html(data: string) {
    this._headers['content-type'] = 'text/html; charset=utf-8';
    return data;
  }

  public redirect(url: string, code = 302) {
    this._status = code;
    this.setHeader('location', url);
    return null;
  }
}

export interface WSHandlers {
  open?: (ws: any) => void;
  message?: (ws: any, message: string | Buffer) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}