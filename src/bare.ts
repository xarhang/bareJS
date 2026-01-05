export interface Context {
  req: Request;
  params: Record<string, string>;
  json: (data: any) => Response;
  [key: string]: any;
}
export type Handler = (ctx: Context) => any;
export type Middleware = (ctx: Context, next: () => Promise<any> | any) => any;

export class BareJS {
  private routes: { method: string; path: string; handlers: (Middleware | Handler)[] }[] = [];
  private globalMiddlewares: Middleware[] = [];
  private compiledFetch?: (req: Request) => Promise<Response>;

  public post = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "POST", path, handlers: h }); return this; };
  public put = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "PUT", path, handlers: h }); return this; };
  public patch = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "PATCH", path, handlers: h }); return this; };
  public delete = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "DELETE", path, handlers: h }); return this; };
  public get = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
  public use = (...m: Middleware[]) => { this.globalMiddlewares.push(...m); return this; }
  public fetch = (req: Request): Promise<Response> | Response => {
    if (!this.compiledFetch) this.compile();
    return this.compiledFetch!(req);
  }
  // private compile() {
  //   let fnBody = "const gMW = this.globalMiddlewares; const allRoutes = this.routes; const EMPTY_PARAMS = Object.freeze({}); return async (req) => { const url = req.url; const pathStart = url.indexOf('/', 8); const path = pathStart === -1 ? '/' : url.substring(pathStart); const method = req.method;";
  //   // (Logic การ Compile เหมือนที่คุยกันไว้)
  //   fnBody += "return new Response('404', { status: 404 }); };";
  //   this.compiledFetch = new Function(fnBody).bind(this)();
  // }

 private compile() {
    // 1. แยก Static Routes ออกมาทำ Map เพื่อความเร็วสูงสุด O(1)
    const staticMap: Record<string, any> = {};
    
    this.routes.forEach((route, index) => {
        // สร้าง Chain สำหรับ Middleware + Handler
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
        
        staticMap[`${route.method}:${route.path}`] = chain;
    });

    // 2. สร้าง Function Body
    let fnBody = `
      const staticMap = this.staticMap;
      const EMPTY_PARAMS = Object.freeze({});
      const jsonHeader = { "content-type": "application/json" };

      return (req) => {
        const url = req.url;
        const pathStart = url.indexOf('/', 8);
        const path = pathStart === -1 ? '/' : url.substring(pathStart);
        const key = req.method + ":" + path;
        
        // Lookup Route ใน O(1)
        const runner = staticMap[key];
        if (runner) {
          const ctx = { 
            req, 
            params: EMPTY_PARAMS, 
            json: (d) => new Response(JSON.stringify(d), { headers: jsonHeader }) 
          };
          return runner(ctx);
        }

        return new Response('404 Not Found', { status: 404 });
      };
    `;

    
    (this as any).staticMap = staticMap;
    this.compiledFetch = new Function(fnBody).bind(this)();
}

  listen(port = 3000) {
    this.compile();
    return Bun.serve({ port, fetch: (req) => this.compiledFetch!(req) });
  }
}
