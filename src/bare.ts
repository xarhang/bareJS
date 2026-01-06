
// import { Context, type Middleware, type Handler, type WSHandlers } from './context';
// export * from './context';
// export * from './validators';
// import type { Server, ServerWebSocket } from "bun";
// export interface BarePlugin {
//   install: (app: BareJS) => void;
// }
// export class BareJS {
//   private routes: Array<{ method: string; path: string; handlers: any[] }> = [];
//   private globalMiddlewares: Array<Middleware> = [];
//   private _server: Server<any> | null = null;

//   private _reusePort: boolean = true;
//   public get server(): Server<any> | null { return this._server; }
//   public set server(value: Server<any> | null) { this._server = value; }
//   private wsHandler: { path: string; handlers: WSHandlers } | null = null;

//   private router: Record<string, Record<string, Function>> = {
//     GET: {}, POST: {}, PUT: {}, PATCH: {}, DELETE: {}
//   };

//   private dynamicRoutes: Array<{ m: string, r: RegExp, p: string[], c: Function }> = [];
//   private poolIdx = 0;
//   private pool: Context[] = Array.from({ length: 1024 }, () => new Context());

  
//  public use(arg: Middleware | { install: (app: BareJS) => void }) {
//     if (arg && typeof arg === 'object' && 'install' in arg) {
//       arg.install(this);
//     } else {
//       this.globalMiddlewares.push(arg as Middleware);
//     }
//     return this;
//   }

//   public get = (path: string, ...h: any[]) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
//   public post = (path: string, ...h: any[]) => { this.routes.push({ method: "POST", path, handlers: h }); return this; };
//   public put = (path: string, ...h: any[]) => { this.routes.push({ method: "PUT", path, handlers: h }); return this; };
//   public patch = (path: string, ...h: any[]) => { this.routes.push({ method: "PATCH", path, handlers: h }); return this; };
//   public delete = (path: string, ...h: any[]) => { this.routes.push({ method: "DELETE", path, handlers: h }); return this; };
//   public ws = (path: string, handlers: WSHandlers) => {
//     this.wsHandler = { path, handlers };
//     return this;
//   }

//   public fetch = (req: Request, server?: Server<any>): any => {
//     const url = req.url;
//     const pathStart = url.indexOf('/', 8);
//     const path = pathStart === -1 ? '/' : url.slice(pathStart);
//     const method = req.method;

//     // 1. Static Lookup (FASTEST)
//     const handler = this.router[method]?.[path];
//     if (handler) {
//       return handler(this.pool[this.poolIdx++ & 1023]!.reset(req, {}));
//     }

//     // 2. Dynamic Lookup (Fixing this part)
//     for (let i = 0; i < this.dynamicRoutes.length; i++) {
//       const d = this.dynamicRoutes[i]!;
//       if (d.m === method && d.r.test(path)) {
//         const match = d.r.exec(path)!;
//         const params = Object.create(null);

//         // Extract params
//         for (let k = 0; k < d.p.length; k++) {
//           params[d.p[k]!] = match[k + 1];
//         }

       
//         const ctx = this.pool[this.poolIdx++ & 1023]!.reset(req, params);
//         return d.c(ctx); 
//       }
//     }

//     return new Response('404 Not Found', { status: 404 });
//   };
// private compileHandler(handler: Handler, middlewares: Middleware[]) {
//     // This is the core JIT function. It wraps everything into one fast call.
//     return (ctx: Context) => {
//       let index = -1;
//       const runner = async (idx: number): Promise<any> => {
//         if (idx <= index) throw new Error('next() called multiple times');
//         index = idx;
        
//         const fn = idx === middlewares.length ? handler : middlewares[idx];
        
//         if (!fn) return;

//         // Support both (ctx, next) and (req, params, next)
//         return (fn as any).length > 2 
//           ? (fn as any)(ctx.req, ctx.params, () => runner(idx + 1))
//           : (fn as any)(ctx, () => runner(idx + 1));
//       };

//       return runner(0).then((result) => {
//         // If the handler returned a raw object, wrap it with the status from Context
//         if (result && result.constructor === Object) {
//           return Response.json(result, { status: ctx._status });
//         }
//         return result;
//       });
//     };
//   }

//   public compile() {
//     for (const route of this.routes) {
//       const pipeline = [...this.globalMiddlewares, ...route.handlers];
//       const pLen = pipeline.length;

//       const build = (idx: number): any => {
//         if (idx === pLen) return () => new Response(null, { status: 404 });
//         const h = pipeline[idx];
//         const next = build(idx + 1);

//         return (ctx: Context) => {
//           const res = h.length > 2
//             ? h(ctx.req, ctx.params, () => next(ctx))
//             : h(ctx, () => next(ctx));

//           if (res && res.constructor === Object) return Response.json(res, { status: ctx._status });
//           return res;
//         };
//       };

//       if (route.path.includes(':')) {
//         const pNames: string[] = [];
//         const regexPath = route.path.replace(/:([^/]+)/g, (_, n) => { pNames.push(n); return "([^/]+)"; });
//         this.dynamicRoutes.push({ m: route.method, r: new RegExp(`^${regexPath}$`), p: pNames, c: build(0) });
//       } else {
//         this.router[route.method]![route.path] = build(0);
//       }
//     }
//   }

//   public async listen(arg1?: number | string, arg2?: number | string) {
//     this.compile();
//     let port = 3000, host = '0.0.0.0';

//     if (typeof arg1 === 'number') {
//       port = arg1;
//       if (typeof arg2 === 'string') host = arg2;
//     } else if (typeof arg1 === 'string') {
//       if (!isNaN(Number(arg1))) port = Number(arg1);
//       else host = arg1;
//       if (typeof arg2 === 'number') port = arg2;
//     }

//     // ✅ Cast the configuration to 'any' or explicitly use the correct Bun Options type
//     const serveOptions: any = {
//       hostname: host,
//       port: port,
//       reusePort: this._reusePort,
//       // fetch: (req: Request, server: Server<any>) => this.fetch(req, server),
//       fetch: this.fetch,
//     };

//     if (this.wsHandler) {
//       serveOptions.websocket = {
//         open: (ws: ServerWebSocket<any>) => this.wsHandler?.handlers.open?.(ws),
//         message: (ws: ServerWebSocket<any>, msg: string | Buffer) => this.wsHandler?.handlers.message?.(ws, msg),
//         close: (ws: ServerWebSocket<any>, code: number, res: string) => this.wsHandler?.handlers.close?.(ws, code, res),
//         drain: (ws: ServerWebSocket<any>) => this.wsHandler?.handlers.drain?.(ws),
//       };
//     }

//     this.server = Bun.serve(serveOptions);
//     console.log(`[BAREJS] 🚀 Server started at http://${host}:${port}`);

//     const shutdown = () => {
//       if (this.server) {
//         this.server.stop();
//         process.exit(0);
//       }
//     };

//     process.on('SIGINT', shutdown);
//     process.on('SIGTERM', shutdown);

//     return this.server;
//   }
// }


// All comments in English
import { Context, type Middleware, type Handler, type WSHandlers, type Next } from './context';
import { typebox, zod, native } from './validators';

// Exporting Types and Context
export * from './context';
export * from './validators';

// Re-exporting core types specifically for convenience
export type { Middleware, Handler, WSHandlers, Next };

import type { Server, ServerWebSocket } from "bun";

export interface BarePlugin {
  install: (app: BareJS) => void;
}

export class BareJS {
  private routes: Array<{ method: string; path: string; handlers: any[] }> = [];
  private globalMiddlewares: Array<Middleware> = [];
  private _server: Server<any> | null = null;
  private _reusePort: boolean = true;
  private wsHandler: { path: string; handlers: WSHandlers } | null = null;

  private router: Record<string, Record<string, Function>> = {
    GET: {}, POST: {}, PUT: {}, PATCH: {}, DELETE: {}
  };

  private dynamicRoutes: Array<{ m: string, r: RegExp, p: string[], c: Function }> = [];
  
  // High-Performance Object Pooling State
  private poolIdx = 0;
  private pool: Context[];
  private poolMask: number;

  constructor(options?: { poolSize?: number }) {
    // Priority: Code Option > Environment Variable > Default (1024)
    let size = options?.poolSize || Number(process.env.BARE_POOL_SIZE) || 1024;

    // Ensure size is a Power of 2 for Bitwise Optimization (e.g., 1024, 2048, 4096)
    if ((size & (size - 1)) !== 0) {
      size = Math.pow(2, Math.ceil(Math.log2(size)));
    }

    this.poolMask = size - 1;
    this.pool = Array.from({ length: size }, () => new Context());
    
    // console.log(`[BAREJS] 🏊 Pool initialized (Size: ${size}, Mask: ${this.poolMask})`);
  }

  public get server(): Server<any> | null { return this._server; }
  public set server(value: Server<any> | null) { this._server = value; }

  public use(arg: Middleware | { install: (app: BareJS) => void }) {
    if (arg && typeof arg === 'object' && 'install' in arg) {
      arg.install(this);
    } else {
      this.globalMiddlewares.push(arg as Middleware);
    }
    return this;
  }

  private compileHandler(handler: Handler, middlewares: Middleware[]) {
    const pipeline = [...middlewares, handler];

    return (ctx: Context) => {
      let index = -1;
      
      const runner = (idx: number): any => {
        if (idx <= index) throw new Error('next() called multiple times');
        index = idx;

        const fn = pipeline[idx];
        if (!fn) return;

        // Optimized call signature check
        return (fn as any).length > 2
          ? (fn as any)(ctx.req, ctx.params, () => runner(idx + 1))
          : (fn as any)(ctx, () => runner(idx + 1));
      };

      const result = runner(0);

      // Fast-path: Synchronous Result (Zero Microtask overhead)
      if (!(result instanceof Promise)) {
        if (result && result.constructor === Object) {
          return Response.json(result, { status: ctx._status });
        }
        return result;
      }

      // Slow-path: Asynchronous Result (Awaitable)
      return result.then((res) => {
        if (res && res.constructor === Object) {
          return Response.json(res, { status: ctx._status });
        }
        return res;
      });
    };
  }

  public get = (path: string, ...h: any[]) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
  public post = (path: string, ...h: any[]) => { this.routes.push({ method: "POST", path, handlers: h }); return this; };
  public put = (path: string, ...h: any[]) => { this.routes.push({ method: "PUT", path, handlers: h }); return this; };
  public patch = (path: string, ...h: any[]) => { this.routes.push({ method: "PATCH", path, handlers: h }); return this; };
  public delete = (path: string, ...h: any[]) => { this.routes.push({ method: "DELETE", path, handlers: h }); return this; };
  
  public ws = (path: string, handlers: WSHandlers) => {
    this.wsHandler = { path, handlers };
    return this;
  }

  public fetch = (req: Request, server?: Server<any>): any => {
    const url = req.url;
    const pathStart = url.indexOf('/', 8);
    const path = pathStart === -1 ? '/' : url.slice(pathStart);
    const method = req.method;

    // 🏎️ Static O(1) Lookup with Bitwise Masking
    const handler = this.router[method]?.[path];
    if (handler) {
      return handler(this.pool[this.poolIdx++ & this.poolMask]!.reset(req, {}));
    }

    // 🔍 Dynamic RegExp Lookup
    for (let i = 0, l = this.dynamicRoutes.length; i < l; i++) {
      const d = this.dynamicRoutes[i]!;
      if (d.m === method && d.r.test(path)) {
        const match = d.r.exec(path)!;
        const params = Object.create(null);
        for (let k = 0; k < d.p.length; k++) {
          params[d.p[k]!] = match[k + 1];
        }
        return d.c(this.pool[this.poolIdx++ & this.poolMask]!.reset(req, params)); 
      }
    }

    return new Response('404 Not Found', { status: 404 });
  };

  public compile() {
    for (const route of this.routes) {
      const pipeline = [...this.globalMiddlewares, ...route.handlers];
      const handler = pipeline.pop(); 
      const middlewares = pipeline as Middleware[];
      const compiled = this.compileHandler(handler, middlewares);

      if (route.path.includes(':')) {
        const pNames: string[] = [];
        const regexPath = route.path.replace(/:([^/]+)/g, (_, n) => { pNames.push(n); return "([^/]+)"; });
        this.dynamicRoutes.push({ m: route.method, r: new RegExp(`^${regexPath}$`), p: pNames, c: compiled });
      } else {
        this.router[route.method]![route.path] = compiled;
      }
    }
  }

  public async listen(arg1?: number | string, arg2?: number | string) {
    this.compile();
    let port = Number(process.env.PORT) || 3000;
    let host = process.env.HOST || '0.0.0.0';

    if (typeof arg1 === 'number') port = arg1;
    if (typeof arg1 === 'string') host = arg1;
    if (typeof arg2 === 'number') port = arg2;

    const serveOptions: any = {
      hostname: host,
      port: port,
      reusePort: this._reusePort,
      fetch: (req: Request, server: Server<any>) => this.fetch(req, server),
    };

    if (this.wsHandler) {
      serveOptions.websocket = {
        open: (ws: any) => this.wsHandler?.handlers.open?.(ws),
        message: (ws: any, msg: any) => this.wsHandler?.handlers.message?.(ws, msg),
        close: (ws: any, code: number, res: string) => this.wsHandler?.handlers.close?.(ws, code, res),
        drain: (ws: any) => this.wsHandler?.handlers.drain?.(ws),
      };
    }

    this._server = Bun.serve(serveOptions);
    console.log(`[BAREJS] 🚀 Server running at http://${host}:${port}`);
    return this._server;
  }
}