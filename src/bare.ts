export interface Context {
  req: Request;
  params: Record<string, string>;
  json: (data: any) => Response;
  body?: any;
  [key: string]: any;
}

export type Next = () => Promise<any> | any;
export type Middleware = (ctx: Context, next: Next) => any;
export type Handler = (ctx: Context) => any;

export interface BarePlugin {
  name: string;
  version: string;
  install: (app: BareJS) => void;
}

export class BareJS {
  private routes: { method: string; path: string; handlers: (Middleware | Handler)[] }[] = [];
  private globalMiddlewares: Middleware[] = [];
  private compiledFetch?: (req: Request) => Promise<Response> | Response;
  private staticMap: Record<string, any> = {};

  // --- Routing Methods ---
  public get = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
  public post = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "POST", path, handlers: h }); return this; };
  public put = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "PUT", path, handlers: h }); return this; };
  public patch = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "PATCH", path, handlers: h }); return this; };
  public delete = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "DELETE", path, handlers: h }); return this; };

  // --- Plugin & Middleware System ---
  public use = (arg: Middleware | BarePlugin) => {
    if (typeof arg === 'object' && 'install' in arg) {
      arg.install(this);
    } else {
      this.globalMiddlewares.push(arg as Middleware);
    }
    return this;
  };

  // --- Core Engine ---
  public fetch = (req: Request): Promise<Response> | Response => {
    if (!this.compiledFetch) this.compile();
    return this.compiledFetch!(req);
  };

  private compile() {
    this.routes.forEach((route) => {
      // Middleware Onion Runner
      const chain = async (ctx: Context) => {
        let idx = 0;
        const middlewares = [...this.globalMiddlewares, ...route.handlers];
        const next = async (): Promise<any> => {
          const handler = middlewares[idx++];
          if (!handler) return;
          // Support both async and sync handlers
          return await (handler.length > 1 
            ? (handler as Middleware)(ctx, next) 
            : (handler as Handler)(ctx));
        };
        return await next();
      };
      this.staticMap[`${route.method}:${route.path}`] = chain;
    });

    // JIT Optimized Fetch Function
    const fnBody = `
      const staticMap = this.staticMap;
      const EMPTY_PARAMS = Object.freeze({});
      const jsonHeader = { "content-type": "application/json" };
      
      return async (req) => {
        const url = req.url;
        const pathStart = url.indexOf('/', 8);
        const path = pathStart === -1 ? '/' : url.substring(pathStart);
        const key = req.method + ":" + path;
        
        const runner = staticMap[key];
        if (runner) {
          const ctx = { 
            req, 
            params: EMPTY_PARAMS, 
            json: (d) => new Response(JSON.stringify(d), { headers: jsonHeader }) 
          };
          return await runner(ctx);
        }
        return new Response('404 Not Found', { status: 404 });
      };`;

    this.compiledFetch = new Function(fnBody).bind(this)();
  }

  public listen(ip: string = '0.0.0.0', port: number = 3000) {
    this.compile();
    console.log(`🚀 BareJS running at http://${ip}:${port}`);
    return Bun.serve({
      hostname: ip,
      port,
      fetch: (req) => this.fetch(req),
    });
  }
}