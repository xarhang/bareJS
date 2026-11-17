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
  public _query: Record<string, string> | undefined = undefined;
  constructor() { }

  public get query(): Record<string, string> {
    if (this._query !== undefined) return this._query;
    const result: Record<string, string> = {};
    const url = this.req?.url;
    if (url) {
      const qIdx = url.indexOf('?');
      if (qIdx !== -1) {
        let start = qIdx + 1;
        const len = url.length;
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
            try {
              k = decodeURIComponent(k.replace(/\+/g, ' '));
              v = decodeURIComponent(v.replace(/\+/g, ' '));
            } catch { /* keep raw on malformed URI */ }
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
    return this.query[key];
  }

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
    this._query = undefined;
    this.body = undefined;
    return this;
  }

  public status(code: number): this {
    this._status = code;
    return this;
  }

  // public json(data: any): Response {
  //   if (this._headers !== undefined) {
  //     if (this._headers["content-type"] === undefined) {
  //       this._headers["content-type"] = "application/json";
  //     }
  //     return Response.json(data, {
  //       status: this._status,
  //       headers: this._headers
  //     });
  //   }
  //   if (this._status === 200) {
  //     return Response.json(data);
  //   }
  //   return Response.json(data, { status: this._status });
  // }
  public json(data: any): Response {
    const status = this._status || 200;

    // No custom headers
    if (!this._headers) {
      return Response.json(data, { status });
    }

    // Ensure Content-Type is set to application/json
    if (this._headers["content-type"] === undefined) {
      this._headers["content-type"] = "application/json";
    }

    return Response.json(data, {
      status,
      headers: this._headers as any // ⚠️ FIX TS18046: Cast to 'any' to allow assignment to 'unknown' headers
    });
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
  

  public send(message: string, extra: Record<string, any> = {}): Response {
    const isError = this._status >= 400;
    
    return this.json({
      status: isError ? "error" : "success",
      msg: message,
      ...extra
    });
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
    return new Response(stream, { status: this._status || 200, headers });
  }
}