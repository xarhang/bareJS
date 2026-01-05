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

export class BareJS {
  private routes: { method: string; path: string; handlers: (Middleware | Handler)[] }[] = [];
  private globalMiddlewares: Middleware[] = [];
  private compiledFetch?: (req: Request) => Promise<Response>;
  private staticMap: Record<string, any> = {};

  public post = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "POST", path, handlers: h }); return this; };
  public put = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "PUT", path, handlers: h }); return this; };
  public patch = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "PATCH", path, handlers: h }); return this; };
  public delete = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "DELETE", path, handlers: h }); return this; };
  public get = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
  public use = (...m: Middleware[]) => { this.globalMiddlewares.push(...m); return this; };

  public fetch = (req: Request): Promise<Response> | Response => {
    if (!this.compiledFetch) this.compile();
    return this.compiledFetch!(req);
  }

  private compile() {
    this.routes.forEach((route) => {
      const chain = (ctx: Context) => {
        let idx = 0;
        const middlewares = [...this.globalMiddlewares, ...route.handlers];
        const next = (): any => {
          const handler = middlewares[idx++];
          if (!handler) return;
          return handler(ctx, next);
        };
        return next();
      };
      this.staticMap[`${route.method}:${route.path}`] = chain;
    });

    const fnBody = `
      const staticMap = this.staticMap;
      const EMPTY_PARAMS = Object.freeze({});
      const jsonHeader = { "content-type": "application/json" };
      return (req) => {
        const url = req.url;
        const pathStart = url.indexOf('/', 8);
        const path = pathStart === -1 ? '/' : url.substring(pathStart);
        const key = req.method + ":" + path;
        const runner = staticMap[key];
        if (runner) {
          const ctx = { req, params: EMPTY_PARAMS, json: (d) => new Response(JSON.stringify(d), { headers: jsonHeader }) };
          return runner(ctx);
        }
        return new Response('404 Not Found', { status: 404 });
      };`;
    this.compiledFetch = new Function(fnBody).bind(this)();
  }

  listen(ip: string = '0.0.0.0', port: number = 3000) {
    this.compile();
    console.log(`🚀 BareJS running at http://${ip}:${port}`);
    return Bun.serve({
      hostname: ip,
      port,
      fetch: (req) => this.compiledFetch!(req),
    });
  }
}