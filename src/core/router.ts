import {
  type Middleware,
  type Handler,
  type GroupCallback
} from '../core/context';

type HandlersChain = (Middleware | Handler)[];

export class BareRouter {
  public routes: any[] = [];

  constructor(
    public prefix: string = "",
    public groupMiddleware: any[] = []
  ) { }

  private _add(method: string, path: string, handlers: HandlersChain) {
    let fullPath = (this.prefix + "/" + path)
        .replace(/\/+/g, "/")



    if (fullPath.endsWith("/")) fullPath = fullPath.slice(0, -1);

    this.routes.push({
      method: method.toUpperCase(),
      path: fullPath || "", 
      handlers: [...this.groupMiddleware, ...handlers]
    });
    return this;
}

  public get = (path: string, ...h: HandlersChain) => this._add("GET", path, h);
  public post = (path: string, ...h: HandlersChain) => this._add("POST", path, h);
  public put = (path: string, ...h: HandlersChain) => this._add("PUT", path, h);
  public patch = (path: string, ...h: HandlersChain) => this._add("PATCH", path, h);
  public delete = (path: string, ...h: HandlersChain) => this._add("DELETE", path, h);

  public group = (path: string, ...args: any[]) => {
    const callback = args.pop();
    const middleware = args;


    const newPrefix = (this.prefix + "/" + path).replace(/\/+/g, "/");
    const subRouter = new BareRouter(newPrefix, [...this.groupMiddleware, ...middleware]);

    callback(subRouter);
    this.routes.push(...subRouter.routes);
    return this;
};

  public use(mw: any) {
    if (mw instanceof BareRouter || (mw && mw.routes)) {
      this.routes.push(...mw.routes);
    } else {
      this.groupMiddleware.push(mw);
    }
    return this;
  }
}
