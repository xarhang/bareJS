import {
  type Middleware,
  type Handler
} from './context';

export type GroupCallback = (router: BareRouter) => void;

type HandlersChain = (Middleware | Handler)[];

export class BareRouter {
  public routes: { method: string; path: string; handlers: any[] }[] = [];

  constructor(
    public prefix: string = "",
    public groupMiddleware: any[] = []
  ) { }

  private _add(method: string, path: string, handlers: HandlersChain) {
    const fullPath = (this.prefix + path).replace(/\/+/g, "/") || "/";

    this.routes.push({
      method: method.toUpperCase(),
      path: fullPath,
      handlers: [...this.groupMiddleware, ...handlers]
    });
    return this;
  }

  public get(path: string, handler: Handler): this;
  public get(path: string, middleware: Middleware, handler: Handler): this;
  public get(path: string, ...h: HandlersChain): this;
  public get(path: string, ...h: HandlersChain) { return this._add("GET", path, h); }

  public post(path: string, handler: Handler): this;
  public post(path: string, middleware: Middleware, handler: Handler): this;
  public post(path: string, ...h: HandlersChain): this;
  public post(path: string, ...h: HandlersChain) { return this._add("POST", path, h); }

  public put(path: string, handler: Handler): this;
  public put(path: string, middleware: Middleware, handler: Handler): this;
  public put(path: string, ...h: HandlersChain): this;
  public put(path: string, ...h: HandlersChain) { return this._add("PUT", path, h); }

  public patch(path: string, handler: Handler): this;
  public patch(path: string, middleware: Middleware, handler: Handler): this;
  public patch(path: string, ...h: HandlersChain): this;
  public patch(path: string, ...h: HandlersChain) { return this._add("PATCH", path, h); }

  public delete(path: string, handler: Handler): this;
  public delete(path: string, middleware: Middleware, handler: Handler): this;
  public delete(path: string, ...h: HandlersChain): this;
  public delete(path: string, ...h: HandlersChain) { return this._add("DELETE", path, h); }

  public group(path: string, callback: GroupCallback): this;
  public group(path: string, middleware: Middleware, callback: GroupCallback): this;
  public group(path: string, ...args: any[]): this;
  public group(path: string, ...args: any[]): this {
    const callback = args.pop() as GroupCallback;
    const middleware = args;

    const subRouter = new BareRouter(
      (this.prefix + path).replace(/\/+/g, "/"),
      [...this.groupMiddleware, ...middleware]
    );

    callback(subRouter);
    this.routes.push(...subRouter.routes);
    return this;
  }

  /**
   * 🔗 Use: Mounts a router or middleware
   * Supports nested routers with automatic path prefixing
   */
  public use(mw: any) {
    if (mw && mw.routes && Array.isArray(mw.routes)) {
      // Merge routes from the sub-router
      const mergedRoutes = mw.routes.map((r: any) => ({
        ...r,
        // Prepend current router's prefix to the sub-router's path
        // e.g. v1 (/v1) using auth (/auth/login) -> /v1/auth/login
        path: (this.prefix + r.path).replace(/\/+/g, "/") || "/",
        handlers: [...this.groupMiddleware, ...r.handlers]
      }));
      this.routes.push(...mergedRoutes);
    } else {
      this.groupMiddleware.push(mw);
    }
    return this;
  }
}