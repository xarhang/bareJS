import { BareContext } from './context';
import type { Context, Middleware, Handler, WSHandlers } from './context';

export interface BarePlugin {
  name: string;
  version: string;
  install: (app: BareJS) => void;
}

export class BareJS {
  private routes: { method: string; path: string; handlers: (Middleware | Handler)[] }[] = [];
  private globalMiddlewares: Middleware[] = [];
  private compiledFetch?: (req: Request, server: any) => Promise<Response> | Response;

  private staticMap: Record<string, (ctx: BareContext) => Promise<Response>> = {};

  private dynamicRoutes: { 
    method: string; 
    regex: RegExp; 
    paramNames: string[]; 
    chain: (ctx: BareContext) => Promise<Response> 
  }[] = [];
  
  private wsHandler: { path: string; handlers: WSHandlers } | null = null;
  private ContextClass = BareContext;

  private errorHandler: (err: any, ctx: Context) => Response = (err) => 
    new Response(JSON.stringify({ error: err.message }), { status: 500 });

  // --- HTTP Methods ---
  public get = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
  public post = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "POST", path, handlers: h }); return this; };
  public put = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "PUT", path, handlers: h }); return this; };
  public patch = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "PATCH", path, handlers: h }); return this; };
  public delete = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "DELETE", path, handlers: h }); return this; };

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

  
  private async handleDynamic(req: Request, method: string, path: string): Promise<Response> {
    const dr = this.dynamicRoutes;
    const len = dr.length;
    
    for (let i = 0; i < len; i++) {
      const route = dr[i];
      if (route && route.method === method) {
        const match = path.match(route.regex);
        if (match) {
          const ctx = new this.ContextClass(req);
          const pNames = route.paramNames;
          
         
          for (let j = 0; j < pNames.length; j++) {
            const name = pNames[j];
            const value = match[j + 1];
            
            
            if (name && value) {
              ctx.params[name] = value;
            }
          }
          return await route.chain(ctx);
        }
      }
    }
    return new Response('404 Not Found', { status: 404 });
  }

  private compile() {
    this.staticMap = {};
    this.dynamicRoutes = [];

    for (const route of this.routes) {
      const pipeline = [...this.globalMiddlewares, ...route.handlers];
      
      // เทคนิค Compose: มัด Middleware จากหลังมาหน้า
      // เพื่อให้ตัวแรกสุดกลายเป็นฟังก์ชันเดียวที่เรียกตัวถัดไปได้ทันที
      let composed = async (ctx: BareContext): Promise<Response> => ctx._finalize();

      for (let i = pipeline.length - 1; i >= 0; i--) {
        const current = pipeline[i];
        const nextFn = composed;
        composed = async (ctx: BareContext) => {
          const res = await (current as any)(ctx, () => nextFn(ctx));
          if (res instanceof Response) ctx.res = res;
          return ctx.res || ctx._finalize();
        };
      }

      if (route.path.includes(':')) {
        const paramNames: string[] = [];
        const regexPath = route.path.replace(/:([^\/]+)/g, (_, name) => {
          paramNames.push(name);
          return "([^/]+)";
        });
        this.dynamicRoutes.push({
          method: route.method,
          regex: new RegExp(`^${regexPath}$`),
          paramNames,
          chain: composed
        });
      } else {
        this.staticMap[`${route.method}:${route.path}`] = composed;
      }
    }

    // JIT: ใช้พารามิเตอร์แบบกระจายเพื่อลด Overhead ของ Scope
    this.compiledFetch = new Function(
      'staticMap', 'hd', 'Ctx',
      `return async (req, server) => {
        const url = req.url;
        const start = url.indexOf('/', 8);
        const path = start === -1 ? '/' : url.substring(start);
        const method = req.method;

        const runner = staticMap[method + ":" + path];
        if (runner) return await runner(new Ctx(req));

        return await hd(req, method, path);
      }`
    )(this.staticMap, this.handleDynamic.bind(this), this.ContextClass);
  }

  public fetch = (req: Request, server: any = {} as any): Promise<Response> | Response => {
    if (!this.compiledFetch) this.compile();
    return this.compiledFetch!(req, server);
  };

  public listen(ip: string = '0.0.0.0', port: number = 3000) {
    this.compile();
    console.log(`\x1b[32m⚡ BareJS Extreme (2x Optimized) running at http://${ip}:${port}\x1b[0m`);
    return Bun.serve({
      hostname: ip,
      port,
      reusePort: true, 
      fetch: (req, server) => this.fetch(req, server),
      websocket: {
        open: (ws) => this.wsHandler?.handlers.open?.(ws),
        message: (ws, msg) => this.wsHandler?.handlers.message?.(ws, msg),
        close: (ws, code, res) => this.wsHandler?.handlers.close?.(ws, code, res),
      }
    });
  }
}