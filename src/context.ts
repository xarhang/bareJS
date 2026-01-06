export type Next = () => any;

export class Context {
  public req!: Request;
  public params!: Record<string, string>;
  public _status: number = 200;
  public store: any = Object.create(null);
  
  // ✅ Added 'body' for TypeBox/Validation support
  public body: any = null;

  public reset(req: Request, params: Record<string, string>) {
    this.req = req;
    this.params = params;
    this._status = 200;
    this.store = Object.create(null);
    this.body = null; // Clean up for the next use in pool
    return this;
  }

  public status(code: number) { 
    this._status = code; 
    return this; 
  }

  // ✅ Added 'json' helper (Zero-cost: just returns the object)
  public json(data: any) {
    return data;
  }

  public set(k: string, v: any) { this.store[k] = v; }
  public get(k: string) { return this.store[k]; }
}

// ✅ Improved Middleware type to support both (ctx) and (req, params) styles
export type Handler = (c: Context, next: Next) => any;
export type Middleware = 
  | ((ctx: Context, next: Next) => any)
  | ((req: Request, params: Record<string, string>, next: Next) => any);

export interface WSHandlers {
  open?: (ws: any) => void;
  message?: (ws: any, message: string | Buffer) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}