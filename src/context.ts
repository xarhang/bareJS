export type Params = Record<string, string>;
export type Next = () => Promise<any> | any;
export type Middleware = (ctx: Context, next: Next) => Promise<any> | any;
export type Handler = (ctx: Context) => Promise<any> | any;
export type GroupCallback = (router: any) => void;
export type AuthUser = Record<string, any>;

export class Context {
  public req!: Request;
  public params: Params = {};
  public _status = 200;
  public _headers?: Record<string, string>;
  public store = new Map<string, any>();
  public body?: any;

  constructor() { }

  public reset(req: Request): this {
    this.req = req;
    this._status = 200;
    // ⚡ Optimization: Lazy headers (reset to null/undefined instead of new object)
    // We will allocate only when used.
    this._headers = undefined as any;

    // ⚡ Optimization: Check size before clearing Map
    if (this.store.size > 0) this.store.clear();

    // 🧹 SAFETY: Re-allocate params is faster than delete loop for V8/Bun
    this.params = {};

    this.body = undefined;
    return this;
  }

  public status(code: number): this {
    this._status = code;
    return this;
  }

  public json(data: any): Response {
    if (this._headers) {
      if (!this._headers["content-type"]) this._headers["content-type"] = "application/json";
      return Response.json(data, {
        status: this._status,
        headers: this._headers
      });
    }

    // ⚡ Fast Path: No alloc for standard 200 OK or basic status
    if (this._status === 200) {
      return Response.json(data);
    }

    return Response.json(data, { status: this._status });
  }

  public set(key: string, value: any): this {
    this.store.set(key, value);
    return this;
  }

  public get(key: string): any {
    return this.store.get(key);
  }
}