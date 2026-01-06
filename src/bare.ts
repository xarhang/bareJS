// All comments in English
export * from './context';
export * from './validators';

import type { Middleware, WSHandlers } from './context';
import type { Server, ServerWebSocket } from "bun";

export interface BarePlugin {
  name: string;
  version: string;
  install: (app: BareJS) => void;
}

export class BareJS {
  private routes: Array<{ method: string; path: string; handlers: Array<any> }> = [];
  private globalMiddlewares: Array<Middleware> = [];
  private compiledFetch?: Function;

  private _reusePort: boolean = true;
  // ✅ Explicitly provide the generic argument to satisfy strict TS rules
  private _server: Server<any> | null = null; 

  private staticMap: Map<string, Function> = new Map();
  private dynamicRoutes: Array<{
    m: string;
    r: RegExp;
    p: string[];
    c: Function;
  }> = [];

  private wsHandler: { path: string; handlers: WSHandlers } | null = null;

  public get server(): Server<any> | null { return this._server; }
  public set server(value: Server<any> | null) { this._server = value; }

  public get = (path: string, ...h: any[]) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
  public post = (path: string, ...h: any[]) => { this.routes.push({ method: "POST", path, handlers: h }); return this; };
  public put = (path: string, ...h: any[]) => { this.routes.push({ method: "PUT", path, handlers: h }); return this; };
  public patch = (path: string, ...h: any[]) => { this.routes.push({ method: "PATCH", path, handlers: h }); return this; };
  public delete = (path: string, ...h: any[]) => { this.routes.push({ method: "DELETE", path, handlers: h }); return this; };

  public ws = (path: string, handlers: WSHandlers) => {
    this.wsHandler = { path, handlers };
    return this;
  };

  public reusePort = (enabled: boolean) => {
    this._reusePort = enabled;
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

    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i]!;
      const pipeline = [...this.globalMiddlewares, ...route.handlers];
      const pLen = pipeline.length;

      const composed = (req: Request, params: Record<string, string>): any => {
        let idx = 0;
        const next = (): any => {
          if (idx < pLen) {
            const result = pipeline[idx++]!(req, params, next);
            if (result && result.constructor === Object) {
              return new Response(JSON.stringify(result), {
                headers: { 'Content-Type': 'application/json' }
              });
            }
            return result;
          }
          return new Response(null, { status: 404 });
        };
        return next();
      };

      if (route.path.indexOf(':') !== -1) {
        const pNames: string[] = [];
        const regexPath = route.path.replace(/:([^/]+)/g, (_, n) => { pNames.push(n); return "([^/]+)"; });
        this.dynamicRoutes.push({ m: route.method, r: new RegExp(`^${regexPath}$`), p: pNames, c: composed });
      } else {
        this.staticMap.set(route.method + route.path, composed);
      }
    }

    /**
     * ✅ Added <any> to Server type in the fetch signature
     */
    this.compiledFetch = (req: Request, server?: Server<any>): any => {
      if (this.wsHandler && req.headers.get("upgrade") === "websocket") {
        const s = req.url.indexOf('/', 8);
        const path = s === -1 ? '/' : req.url.substring(s);
        if (path === this.wsHandler.path) {
          if (server?.upgrade(req)) return;
        }
      }

      const url = req.url;
      const s = url.indexOf('/', 8);
      const path = s === -1 ? '/' : url.substring(s);
      const method = req.method;

      const runner = this.staticMap.get(method + path);
      if (runner) return runner(req, {});

      const dRoutes = this.dynamicRoutes;
      for (let j = 0; j < dRoutes.length; j++) {
        const d = dRoutes[j]!;
        if (d.m === method) {
          const m = d.r.exec(path);
          if (m) {
            const params: Record<string, string> = {};
            for (let k = 0; k < d.p.length; k++) params[d.p[k]!] = m[k + 1]!;
            return d.c(req, params);
          }
        }
      }
      return new Response('404 Not Found', { status: 404 });
    };
  }

  // ✅ Maintain consistency in the public fetch method
  public fetch = (req: Request, server?: Server<any>) => {
    if (!this.compiledFetch) this.compile();
    return this.compiledFetch!(req, server);
  };

  public async listen(arg1?: number | string, arg2?: number | string) {
    this.compile();
    let port = 3000, host = '0.0.0.0';

    if (typeof arg1 === 'number') {
      port = arg1;
      if (typeof arg2 === 'string') host = arg2;
    } else if (typeof arg1 === 'string') {
      if (!isNaN(Number(arg1))) port = Number(arg1);
      else host = arg1;
      if (typeof arg2 === 'number') port = arg2;
    }

    // ✅ Cast the configuration to 'any' or explicitly use the correct Bun Options type
    const serveOptions: any = {
      hostname: host,
      port: port,
      reusePort: this._reusePort,
      fetch: (req: Request, server: Server<any>) => this.fetch(req, server),
    };

    if (this.wsHandler) {
      serveOptions.websocket = {
        open: (ws: ServerWebSocket<any>) => this.wsHandler?.handlers.open?.(ws),
        message: (ws: ServerWebSocket<any>, msg: string | Buffer) => this.wsHandler?.handlers.message?.(ws, msg),
        close: (ws: ServerWebSocket<any>, code: number, res: string) => this.wsHandler?.handlers.close?.(ws, code, res),
        drain: (ws: ServerWebSocket<any>) => this.wsHandler?.handlers.drain?.(ws),
      };
    }

    this.server = Bun.serve(serveOptions);
    console.log(`[BAREJS] 🚀 Server started at http://${host}:${port}`);

    const shutdown = () => {
      if (this.server) {
        this.server.stop();
        process.exit(0);
      }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return this.server;
  }
}