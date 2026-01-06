export type Next = () => Promise<any> | any;

export class Context {
  public req!: Request;
  public params!: Record<string, string>;
  public _status: number = 200;
  public store: any = Object.create(null);
  
  // ✅ Added body to ensure TypeBox/Validators can store data
  public body: any = null;

  public reset(req: Request, params: Record<string, string>) {
    this.req = req;
    this.params = params;
    this._status = 200;
    this.store = Object.create(null);
    this.body = null; 
    return this;
  }

  public status(code: number) { 
    this._status = code; 
    return this; 
  }

  public json(data: any) {
    return data;
  }

  public set(k: string, v: any) { this.store[k] = v; }
  public get(k: string) { return this.store[k]; }
}

// export type Handler = (c: Context) => any;

// ✅ Features Kept: Supports both (ctx, next) and (req, params, next)
// export type Middleware = 
//   | ((ctx: Context, next: Next) => any)
//   | ((req: Request, params: Record<string, string>, next: Next) => any)
//   | ((req: Request, next: Next) => any)
//   | ((ctx: Context, next: Next) => Promise<any> | any);
export type Middleware = (
  ctx: any,       // จะเป็น Context หรือ Request ก็ได้
  next: any,      // จะเป็น Next หรือ Params ก็ได้
  third?: Next    // สำหรับแบบ (req, params, next)
) => Promise<any> | any;

export type Handler = (ctx: any) => Promise<any> | any;

export interface WSHandlers {
  open?: (ws: any) => void;
  message?: (ws: any, message: string | Buffer) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}