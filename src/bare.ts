// src/bare.ts
import { BareContext } from './context';
import type { Context, Middleware, Handler, WSHandlers } from './context';

export interface BarePlugin {
  name: string;
  version: string;
  install: (app: BareJS) => void;
}

export class BareJS {
  private routes: Array<{ method: string; path: string; handlers: Array<Middleware | Handler> }> = [];
  private globalMiddlewares: Array<Middleware> = [];
  private compiledFetch?: Function;
  
  private staticMap: Map<string, Function> = new Map();
  private dynamicRoutes: Array<{
    m: string;
    r: RegExp;
    p: string[];
    c: Function;
  }> = [];
  
  private wsHandler: { path: string; handlers: WSHandlers } | null = null;
  
  public get = (path: string, ...h: Array<Middleware | Handler>) => { 
    this.routes.push({ method: "GET", path, handlers: h }); 
    return this; 
  };
  
  public post = (path: string, ...h: Array<Middleware | Handler>) => { 
    this.routes.push({ method: "POST", path, handlers: h }); 
    return this; 
  };
  
  public put = (path: string, ...h: Array<Middleware | Handler>) => { 
    this.routes.push({ method: "PUT", path, handlers: h }); 
    return this; 
  };
  
  public patch = (path: string, ...h: Array<Middleware | Handler>) => { 
    this.routes.push({ method: "PATCH", path, handlers: h }); 
    return this; 
  };
  
  public delete = (path: string, ...h: Array<Middleware | Handler>) => { 
    this.routes.push({ method: "DELETE", path, handlers: h }); 
    return this; 
  };
  
  public ws = (path: string, handlers: WSHandlers) => {
    this.wsHandler = { path, handlers };
    return this;
  };
  
  public use = (arg: Middleware | BarePlugin) => {
    if (typeof arg === 'object' && 'install' in arg) {
      arg.install(this);
    } else {
      this.globalMiddlewares.push(arg as Middleware);
    }
    return this;
  };
  
  private compile() {
    this.staticMap.clear();
    this.dynamicRoutes.length = 0;
    
    const gLen = this.globalMiddlewares.length;
    const hasGlobal = gLen > 0;
    const rLen = this.routes.length;
    
    for (let i = 0; i < rLen; i++) {
      const route = this.routes[i]!;
      const handlers = route.handlers;
      const hLen = handlers.length;
      const hasDynamic = route.path.indexOf(':') !== -1;
      
      // ULTRA FAST PATH: No middleware, single handler, no params
      if (!hasGlobal && hLen === 1 && !hasDynamic) {
        const h = handlers[0]!;
        this.staticMap.set(route.method + route.path, (ctx: BareContext) => {
          const r = h(ctx, () => ctx._finalize());
          return r instanceof Response ? r : ctx._finalize();
        });
        continue;
      }
      
      // FAST PATH: Single handler with params OR multiple handlers
      const total = gLen + hLen;
      let composed: Function;
      
      if (total === 1) {
        const h = handlers[0] || this.globalMiddlewares[0];
        composed = (ctx: BareContext) => {
          const r = h!(ctx, () => ctx._finalize());
          return r instanceof Response ? r : ctx._finalize();
        };
      } else {
        const pipeline = Array(total);
        for (let j = 0; j < gLen; j++) pipeline[j] = this.globalMiddlewares[j];
        for (let j = 0; j < hLen; j++) pipeline[gLen + j] = handlers[j];
        
        composed = (ctx: BareContext) => {
          let idx = 0;
          const exec = (): any => {
            if (idx >= total) return ctx._finalize();
            const fn = pipeline[idx++]!;
            const r = fn(ctx, exec);
            if (r instanceof Response) ctx.res = r;
            return ctx.res || (idx >= total ? ctx._finalize() : exec());
          };
          return exec();
        };
      }
      
      if (hasDynamic) {
        const pNames: string[] = [];
        const regexPath = route.path.replace(/:([^/]+)/g, (_, n) => {
          pNames.push(n);
          return "([^/]+)";
        });
        this.dynamicRoutes.push({
          m: route.method,
          r: new RegExp(`^${regexPath}$`),
          p: pNames,
          c: composed
        });
      } else {
        this.staticMap.set(route.method + route.path, composed);
      }
    }
    
    // MAXIMUM JIT: Inline everything, minimal allocations
    const sMap = this.staticMap;
    const dRoutes = this.dynamicRoutes;
    const dLen = dRoutes.length;
    
    this.compiledFetch = (req: Request) => {
      const url = req.url;
      let i = url.indexOf('/', 8);
      if (i === -1) i = url.length;
      
      const path = i === url.length ? '/' : url.substring(i);
      const key = req.method + path;
      
      const runner = sMap.get(key);
      if (runner) {
        const ctx = new BareContext(req);
        return runner(ctx);
      }
      
      const method = req.method;
      for (let j = 0; j < dLen; j++) {
        const d = dRoutes[j]!;
        if (d.m === method) {
          const m = d.r.exec(path);
          if (m) {
            const ctx = new BareContext(req);
            const pLen = d.p.length;
            for (let k = 0; k < pLen; k++) {
              ctx.params[d.p[k]!] = m[k + 1]!;
            }
            return d.c(ctx);
          }
        }
      }
      
      return new Response('404', { status: 404 });
    };
  }
  
  public fetch = (req: Request) => {
    if (!this.compiledFetch) this.compile();
    return this.compiledFetch!(req);
  };
  
  public listen(ip = '0.0.0.0', port = 3000) {
    this.compile();
    console.log(`\x1b[32m⚡ BareJS MAX at http://${ip}:${port}\x1b[0m`);
    
    return Bun.serve({
      hostname: ip,
      port,
      reusePort: true,
      fetch: this.fetch.bind(this),
      websocket: {
        open: (ws) => this.wsHandler?.handlers.open?.(ws),
        message: (ws, msg) => this.wsHandler?.handlers.message?.(ws, msg),
        close: (ws, code, res) => this.wsHandler?.handlers.close?.(ws, code, res),
      }
    });
  }
}
