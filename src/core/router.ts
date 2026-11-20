import {
  type Context,
  type Middleware,
  type Handler
} from '../core/context';
import { schemaValidator, type RouteSchemas } from '../security/validators';

import type { RouteEndpoint, RouteSchema } from '../client/index';

type HandlersChain = (Middleware | Handler | RouteSchemas)[];

export type InferSchema<S> =
  S extends { static: infer T } ? T
  : S extends { _output: infer T } ? T
  : any;

type StripLeadingSlash<S extends string> = S extends `/${infer Rest}` ? StripLeadingSlash<Rest> : S;
type StripTrailingSlash<S extends string> = S extends `${infer Rest}/` ? StripTrailingSlash<Rest> : S;
type NormalizePrefix<P extends string> = StripTrailingSlash<StripLeadingSlash<P>> extends ''
  ? ''
  : `/${StripTrailingSlash<StripLeadingSlash<P>>}`;

type JoinPath<P extends string, Sub extends string> =
  NormalizePrefix<P> extends ''
    ? (Sub extends '' ? '/' : (Sub extends `/${string}` ? Sub : `/${Sub}`))
    : (StripLeadingSlash<Sub> extends ''
        ? NormalizePrefix<P>
        : `${NormalizePrefix<P>}/${StripLeadingSlash<Sub>}`);

export type PrefixRoutes<P extends string, R extends RouteSchema> = {
  [K in keyof R as K extends `${infer M} ${infer Sub}`
    ? `${M} ${JoinPath<P, Sub>}`
    : K]: R[K] extends infer E extends RouteEndpoint
      ? Omit<E, 'path'> & {
          path: E['path'] extends string
            ? JoinPath<P, E['path']>
            : JoinPath<P, K extends `${string} ${infer Sub}` ? Sub : (K & string)>;
        }
      : R[K];
};

type TypedRouterHandler<S extends RouteSchemas, Res> = (
  ctx: Context & {
    body: S extends { body: infer B } ? InferSchema<B> : any;
    query: S extends { query: infer Q } ? InferSchema<Q> : Record<string, string>;
    params: S extends { params: infer Pa } ? InferSchema<Pa> : Record<string, any>;
  }
) => Res | Promise<Res>;

type AddRouterRoute<Routes extends RouteSchema, M extends string> = {
  <P extends string, S extends RouteSchemas, Res = S extends { response: infer R } ? InferSchema<R> : any>(
    path: P,
    schemas: S,
    handler: TypedRouterHandler<S, Res>
  ): BareRouter<Routes & Record<`${M} ${P}`, {
    method: M;
    path: P;
    params: S extends { params: infer Pa } ? InferSchema<Pa> : Record<string, any>;
    query: S extends { query: infer Q } ? InferSchema<Q> : Record<string, any>;
    headers: S extends { headers: infer H } ? InferSchema<H> : Record<string, string>;
    body: S extends { body: infer B } ? InferSchema<B> : any;
    response: S extends { response: infer R } ? InferSchema<R> : Awaited<Res>;
  }>>;
  <P extends string, Res = any>(
    path: P,
    ...handlers: any[]
  ): BareRouter<Routes & Record<`${M} ${P}`, { method: M; path: P; response: Awaited<Res> }>>;
};

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

  public get: AddRouterRoute<Routes, 'GET'> = ((path: string, ...h: HandlersChain) => this._add("GET", path, h)) as any;
  public post: AddRouterRoute<Routes, 'POST'> = ((path: string, ...h: HandlersChain) => this._add("POST", path, h)) as any;
  public put: AddRouterRoute<Routes, 'PUT'> = ((path: string, ...h: HandlersChain) => this._add("PUT", path, h)) as any;
  public patch: AddRouterRoute<Routes, 'PATCH'> = ((path: string, ...h: HandlersChain) => this._add("PATCH", path, h)) as any;
  public delete: AddRouterRoute<Routes, 'DELETE'> = ((path: string, ...h: HandlersChain) => this._add("DELETE", path, h)) as any;
  public options: AddRouterRoute<Routes, 'OPTIONS'> = ((path: string, ...h: HandlersChain) => this._add("OPTIONS", path, h)) as any;
  public head: AddRouterRoute<Routes, 'HEAD'> = ((path: string, ...h: HandlersChain) => this._add("HEAD", path, h)) as any;
  public all: AddRouterRoute<Routes, 'ALL'> = ((path: string, ...h: HandlersChain) => {
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      this._add(m, path, h);
    }
    return this;
  }) as any;

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
  ): BareRouter<Routes & PrefixRoutes<P, R2>> {
    this._mountRouter(prefix, router);
    return this as any;
  }

  public use<R2 extends RouteSchema = {}>(mw: BareRouter<R2>): BareRouter<Routes & R2>;
  public use<P extends string, R2 extends RouteSchema = {}>(prefix: P, mw: BareRouter<R2>): BareRouter<Routes & PrefixRoutes<P, R2>>;
  public use(...mws: any[]): BareRouter<Routes>;
  public use(prefixOrMw: any, ...rest: any[]): any {
    if (typeof prefixOrMw === 'string') {
      const prefixMws: any[] = [];
      const prefixRouters: any[] = [];
      for (let i = 0; i < rest.length; i++) {
        const item = rest[i];
        if (item instanceof BareRouter || (item && item.routes)) {
          prefixRouters.push(item);
        } else if (typeof item === 'function') {
          prefixMws.push(item);
        }
      }
      if (prefixRouters.length === 0) {
        throw new TypeError(`BareRouter.use("${prefixOrMw}", ...) requires a BareRouter instance`);
      }
      for (let i = 0; i < prefixRouters.length; i++) {
        const prevLen = this.routes.length;
        this._mountRouter(prefixOrMw, prefixRouters[i]);
        if (prefixMws.length > 0) {
          for (let j = prevLen; j < this.routes.length; j++) {
            this.routes[j].handlers = [...this.groupMiddleware, ...prefixMws, ...this.routes[j].handlers.slice(this.groupMiddleware.length)];
          }
        }
      }
      return this;
    }

    const all = [prefixOrMw, ...rest];
    for (let i = 0; i < all.length; i++) {
      const item = all[i];
      if (item instanceof BareRouter || (item && item.routes)) {
        this._mountRouter("", item);
      } else if (item && typeof item.install === 'function') {
        item.install(this);
      } else if (typeof item === 'function') {
        this.groupMiddleware.push(item);
      }
    }
    return this;
  }
}
