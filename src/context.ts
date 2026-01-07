export type Params = Record<string, string>;
export type Next = () => Promise<any> | any;

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
   * Reuses the Context instance. Clears all previous request data.
   */
  public reset(req: Request, params: Params): this {
    this.req = req;
    this.params = params;
    this._status = 200;
    this.body = null;
    this._headers = {};
    this._searchParams = null; 
    this._cookies = null;
    
    // Memory-stable wipe
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

  /**
   * 🍪 Lazy Cookie Parser (Unbreakable & TS-Safe)
   */
  public cookie(name: string): string | undefined {
    let cookies = this._cookies;

    if (!cookies) {
      cookies = new Map();
      const header = this.req.headers.get("cookie");
      if (header) {
        const matches = header.matchAll(/([^=\s]+)=([^;]+)/g);
        for (const match of matches) {
          const key = match[1];
          const value = match[2];
          if (key && value) {
            cookies.set(key, value);
          }
        }
      }
      this._cookies = cookies;
    }
    
    return cookies.get(name);
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

  public setCookie(name: string, value: string, options: string = ""): this {
    this.setHeader("set-cookie", `${name}=${value}; ${options}`);
    return this;
  }

  public json(data: any) {
    this.setHeader('content-type', 'application/json');
    return data;
  }

  public text(data: string) {
    this.setHeader('content-type', 'text/plain; charset=utf-8');
    return data;
  }

  public html(data: string) {
    this.setHeader('content-type', 'text/html; charset=utf-8');
    return data;
  }

  public redirect(url: string, code = 302) {
    this._status = code;
    this.setHeader('location', url);
    return null;
  }

  // --- STATE MANAGEMENT ---
  public set(k: string, v: any): void { this.store[k] = v; }
  public get<T = any>(k: string): T { return this.store[k]; }
}

/**
 * 🎯 Hybrid Middleware Signature
 */
export type Middleware = 
  | ((ctx: Context, next: Next) => Promise<any> | any)             
  | ((req: Request, params: Params, next: Next) => Promise<any> | any);

export type Handler = (ctx: Context) => Promise<any> | any;

export interface WSHandlers {
  open?: (ws: any) => void;
  message?: (ws: any, message: string | Buffer) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}