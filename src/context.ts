
// src/context.ts
export interface WSHandlers {
  open?: (ws: any) => void;
  message?: (ws: any, message: string | Buffer) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}

export type Next = () => any;
export type Middleware = (ctx: Context, next: Next) => any;
export type Handler = (ctx: Context, next: Next) => any;

export interface Context {
  req: Request;
  res?: Response;
  params: Record<string, string>;
  body?: any;
  [key: string]: any;
  json: (data: any) => void;
  status: (code: number) => this;
  setResHeader: (key: string, value: string) => void;
}

export class BareContext {
  public res?: Response;
  public params: Record<string, string> = {};
  public body: any;
  public _status = 200;
  public _headers: Record<string, string> = {};
  
  constructor(public req: Request) {}
  
  json(data: any) {
    this._headers["Content-Type"] = "application/json";
    this.res = new Response(JSON.stringify(data), {
      status: this._status,
      headers: this._headers,
    });
  }
  
  status(code: number) {
    this._status = code;
    return this;
  }
  
  setResHeader(k: string, v: string) {
    this._headers[k] = v;
  }
  
  _finalize() {
    return this.res || new Response(null, { status: this._status, headers: this._headers });
  }
}
