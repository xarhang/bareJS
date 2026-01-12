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
  public _headers?: Record<string, string> | undefined = undefined;
  public store = new Map<string, any>();
  public body: any = undefined; 

  constructor() { }


  public async jsonBody(): Promise<any> {

    if (this.body !== undefined) return this.body;


    const contentType = this.req.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      try {
        
        return this.body = await this.req.json();
      } catch {
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

  public setHeader(name: string, value: string): this {
    if (!this._headers) this._headers = {};
    this._headers[name.toLowerCase()] = value;
    return this;
  }
}