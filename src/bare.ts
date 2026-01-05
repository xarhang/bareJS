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

  public get = (path: string, ...h: (Middleware | Handler)[]) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
  public use = (m: Middleware) => { this.globalMiddlewares.push(m); return this; };

  private compile() {
    let fnBody = "const gMW = this.globalMiddlewares; const allRoutes = this.routes; const EMPTY_PARAMS = Object.freeze({}); return async (req) => { const url = req.url; const pathStart = url.indexOf('/', 8); const path = pathStart === -1 ? '/' : url.substring(pathStart); const method = req.method;";
    // (Logic การ Compile เหมือนที่คุยกันไว้)
    fnBody += "return new Response('404', { status: 404 }); };";
    this.compiledFetch = new Function(fnBody).bind(this)();
  }

  listen(port = 3000) {
    this.compile();
    return Bun.serve({ port, fetch: (req) => this.compiledFetch!(req) });
  }
}
