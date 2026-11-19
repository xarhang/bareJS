import {
  type Middleware,
  type Handler,
  type GroupCallback
} from '../core/context';
import { schemaValidator, type RouteSchemas } from '../security/validators';

import type { RouteSchema } from '../client/index';

type HandlersChain = (Middleware | Handler | RouteSchemas)[];

export type InferSchema<S> =
  S extends { static: infer T } ? T
  : S extends { _output: infer T } ? T
  : any;

export class BareRouter<Routes extends RouteSchema = {}> {
  declare readonly __routes: Routes;
  public routes: any[] = [];

  constructor(
    public prefix: string = "",
    public groupMiddleware: any[] = []
  ) { }

  protected _add(method: string, path: string, handlers: HandlersChain) {
    let fullPath = (this.prefix + "/" + path)
        .replace(/\/+/g, "/");

    if (fullPath.endsWith("/")) fullPath = fullPath.slice(0, -1);

    const resolvedHandlers: any[] = [];
    for (let i = 0; i < handlers.length; i++) {
      const h = handlers[i];
      if (typeof h === 'function') {
        resolvedHandlers.push(h);
      } else if (h && typeof h === 'object') {
        resolvedHandlers.push(schemaValidator(h as RouteSchemas));
      }
    }

    this.routes.push({
      method: method.toUpperCase(),
      path: fullPath || "", 
      handlers: [...this.groupMiddleware, ...resolvedHandlers]
    });
    return this;
}

  public get: (path: string, ...h: any[]) => any = (path: string, ...h: HandlersChain) => this._add("GET", path, h);
  public post: (path: string, ...h: any[]) => any = (path: string, ...h: HandlersChain) => this._add("POST", path, h);
  public put: (path: string, ...h: any[]) => any = (path: string, ...h: HandlersChain) => this._add("PUT", path, h);
  public patch: (path: string, ...h: any[]) => any = (path: string, ...h: HandlersChain) => this._add("PATCH", path, h);
  public delete: (path: string, ...h: any[]) => any = (path: string, ...h: HandlersChain) => this._add("DELETE", path, h);
  public options: (path: string, ...h: any[]) => any = (path: string, ...h: HandlersChain) => this._add("OPTIONS", path, h);
  public head: (path: string, ...h: any[]) => any = (path: string, ...h: HandlersChain) => this._add("HEAD", path, h);
  public all: (path: string, ...h: any[]) => any = (path: string, ...h: HandlersChain) => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      this._add(m, path, h);
    }
    return this;
  };

  public group = (path: string, ...args: any[]) => {
    const callback = args.pop();
    const middleware = args;

    const newPrefix = (this.prefix + "/" + path).replace(/\/+/g, "/");
    const subRouter = new BareRouter(newPrefix, [...this.groupMiddleware, ...middleware]);

    callback(subRouter);
    this.routes.push(...subRouter.routes);
    return this;
  };

  private _mountRouter(prefix: string, router: BareRouter<any>) {
    const base = (this.prefix + "/" + prefix).replace(/\/+/g, "/").replace(/\/$/, "");
    for (const r of router.routes) {
      let fullPath = (base + "/" + r.path).replace(/\/+/g, "/");
      if (fullPath.endsWith("/")) fullPath = fullPath.slice(0, -1);
      this.routes.push({
        method: r.method,
        path: fullPath || "",
        handlers: [...this.groupMiddleware, ...r.handlers]
      });
    }
  }

  public route<P extends string, R2 extends RouteSchema = {}>(
    prefix: P,
    router: BareRouter<R2>
  ): BareRouter<Routes & R2> {
    this._mountRouter(prefix, router);
    return this as any;
  }

  public use<R2 extends RouteSchema = {}>(mw: BareRouter<R2>): BareRouter<Routes & R2>;
  public use<P extends string, R2 extends RouteSchema = {}>(prefix: P, mw: BareRouter<R2>): BareRouter<Routes & R2>;
  public use(mw: any): BareRouter<Routes>;
  public use(prefixOrMw: any, maybeMw?: any): any {
    if (typeof prefixOrMw === 'string' && (maybeMw instanceof BareRouter || (maybeMw && maybeMw.routes))) {
      this._mountRouter(prefixOrMw, maybeMw);
    } else if (prefixOrMw instanceof BareRouter || (prefixOrMw && prefixOrMw.routes)) {
      this._mountRouter("", prefixOrMw);
    } else if (prefixOrMw && typeof prefixOrMw.install === 'function') {
      prefixOrMw.install(this);
    } else {
      this.groupMiddleware.push(prefixOrMw);
    }
    return this;
  }
}
