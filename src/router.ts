// src/router.ts
import { 
  Context, 
  type Middleware, 
  type Handler, 
  type GroupCallback 
} from './context';

// Use 'any' here for the tuple definition to prevent the "source not compatible" error, 
// but the runtime will still be protected by your BareJS.compileHandler logic.
type HandlersChain = [...any[], Handler]; 

export class BareRouter {
  public routes: { method: string; path: string; handlers: any[] }[] = [];
  
  constructor(
    public prefix: string = "", 
    public groupMiddleware: Middleware[] = []
  ) {}

  private _add(method: string, path: string, handlers: HandlersChain) {
    const fullPath = (this.prefix + path).replace(/\/+/g, "/") || "/";
    this.routes.push({ 
      method: method.toUpperCase(), 
      path: fullPath, 
      handlers: [...this.groupMiddleware, ...handlers] 
    });
    return this;
  }

  public get = (path: string, ...handlers: HandlersChain) => this._add("GET", path, handlers);
  public post = (path: string, ...handlers: HandlersChain) => this._add("POST", path, handlers);
  public put = (path: string, ...handlers: HandlersChain) => this._add("PUT", path, handlers);
  public patch = (path: string, ...handlers: HandlersChain) => this._add("PATCH", path, handlers);
  public delete = (path: string, ...handlers: HandlersChain) => this._add("DELETE", path, handlers);

  public group = (path: string, ...args: [...any[], GroupCallback]) => {
    const callback = args.pop() as GroupCallback;
    const middleware = args as Middleware[];

    const subRouter = new BareRouter(
      (this.prefix + path).replace(/\/+/g, "/"), 
      [...this.groupMiddleware, ...middleware]
    );

    callback(subRouter);
    this.routes.push(...subRouter.routes);
    return this;
  };
}