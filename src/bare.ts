// All comments in English
export * from './context';   
export * from './validators';

import { BareContext } from './context';
import type { Context, Middleware, Handler, WSHandlers } from './context';
import type { Server } from "bun";

/**
 * BarePlugin Interface for modular extensions
 */
export interface BarePlugin {
  name: string;
  version: string;
  install: (app: BareJS) => void;
}

/**
 * BareJS Core Class
 * Optimized for Bun with JIT-like route compilation
 */
export class BareJS {
  private routes: Array<{ method: string; path: string; handlers: Array<Middleware | Handler> }> = [];
  private globalMiddlewares: Array<Middleware> = [];
  private compiledFetch?: Function;

  // Internal Configuration
  private _reusePort: boolean = true;
  private _server: Server<any> | null = null;
  
  // Route Mapping
  private staticMap: Map<string, Function> = new Map();
  private dynamicRoutes: Array<{
    m: string;
    r: RegExp;
    p: string[];
    c: Function;
  }> = [];

  private wsHandler: { path: string; handlers: WSHandlers } | null = null;

  /** * Getter/Setter for Server with correct Generic Type 
   */
  public get server(): Server<any> | null {
    return this._server;
  }
  public set server(value: Server<any> | null) {
    this._server = value;
  }

  /** * HTTP Route Definitions 
   * Standard fluent API supporting multiple handlers
   */
  public get = (path: string, ...h: Array<Middleware | Handler>) => { this.routes.push({ method: "GET", path, handlers: h }); return this; };
  public post = (path: string, ...h: Array<Middleware | Handler>) => { this.routes.push({ method: "POST", path, handlers: h }); return this; };
  public put = (path: string, ...h: Array<Middleware | Handler>) => { this.routes.push({ method: "PUT", path, handlers: h }); return this; };
  public patch = (path: string, ...h: Array<Middleware | Handler>) => { this.routes.push({ method: "PATCH", path, handlers: h }); return this; };
  public delete = (path: string, ...h: Array<Middleware | Handler>) => { this.routes.push({ method: "DELETE", path, handlers: h }); return this; };

  /** WebSocket handler registration */
  public ws = (path: string, handlers: WSHandlers) => {
    this.wsHandler = { path, handlers };
    return this;
  };

  /** Configuration: Toggle SO_REUSEPORT (Default: true) */
  public reusePort = (enabled: boolean) => {
    this._reusePort = enabled;
    return this;
  };

  /** Middleware & Plugin installer */
  public use = (arg: Middleware | BarePlugin) => {
    if (typeof arg === 'object' && 'install' in arg) {
      arg.install(this);
    } else {
      this.globalMiddlewares.push(arg as Middleware);
    }
    return this;
  };

  /**
   * Compiles routes into optimized functions
   * Handles Async Middleware Chain correctly
   */
  private compile() {
    this.staticMap.clear();
    this.dynamicRoutes.length = 0;

    const gLen = this.globalMiddlewares.length;
    const rLen = this.routes.length;

    for (let i = 0; i < rLen; i++) {
      const route = this.routes[i]!;
      const handlers = route.handlers;
      const hLen = handlers.length;
      const hasDynamic = route.path.indexOf(':') !== -1;

      const total = gLen + hLen;
      let composed: Function;

      // Build the async middleware pipeline
      const pipeline = [...this.globalMiddlewares, ...handlers];

      composed = async (ctx: BareContext) => {
        let idx = 0;
        const exec = async (): Promise<any> => {
          if (idx >= total) return ctx._finalize();
          const fn = pipeline[idx++]!;

          // CRITICAL: Await for async middlewares (e.g. body parsing/validators)
          const r = await fn(ctx, exec);

          if (r instanceof Response) return r;
          return ctx.res || (idx >= total ? ctx._finalize() : await exec());
        };
        return await exec();
      };

      // Register compiled route
      if (hasDynamic) {
        const pNames: string[] = [];
        const regexPath = route.path.replace(/:([^/]+)/g, (_, n) => {
          pNames.push(n);
          return "([^/]+)";
        });
        this.dynamicRoutes.push({
          m: route.method,
          r: new RegExp(`^${regexPath}$`),
          p: pNames,
          c: composed
        });
      } else {
        this.staticMap.set(route.method + route.path, composed);
      }
    }

    // FETCH ENGINE: Optimized for high throughput
    this.compiledFetch = async (req: Request) => {
      const url = req.url;
      let i = url.indexOf('/', 8);
      if (i === -1) i = url.length;

      const path = i === url.length ? '/' : url.substring(i);
      const key = req.method + path;

      // 1. Try static O(1) lookup
      const runner = this.staticMap.get(key);
      if (runner) {
        return await runner(new BareContext(req));
      }

      // 2. Try dynamic regex lookup
      const method = req.method;
      for (let j = 0; j < this.dynamicRoutes.length; j++) {
        const d = this.dynamicRoutes[j]!;
        if (d.m === method) {
          const m = d.r.exec(path);
          if (m) {
            const ctx = new BareContext(req);
            for (let k = 0; k < d.p.length; k++) {
              ctx.params[d.p[k]!] = m[k + 1]!;
            }
            return await d.c(ctx);
          }
        }
      }
      return new Response('404 Not Found', { status: 404 });
    };
  }

  /** Bun fetch handler */
  public fetch = (req: Request) => {
    if (!this.compiledFetch) this.compile();
    return this.compiledFetch!(req);
  };

  /**
   * Flexible Listen Method
   * Purely uses arguments passed to the function.
   * Supports: .listen(), .listen(4000), .listen("localhost", 4000)
   */
  public async listen(arg1?: number | string, arg2?: number | string) {
    this.compile();

    // Default values if no arguments are provided
    let port = 3000;
    let host = '0.0.0.0';

    // Logic to handle arguments without looking at process.env
    if (typeof arg1 === 'number') {
      port = arg1;
      if (typeof arg2 === 'string') host = arg2;
    } else if (typeof arg1 === 'string') {
      if (!isNaN(Number(arg1))) {
        port = Number(arg1);
      } else {
        host = arg1;
      }
      if (typeof arg2 === 'number') port = arg2;
      else if (typeof arg2 === 'string') port = Number(arg2);
    }

    const Mode = process.env.NODE_ENV || 'development';
    const isProd = Mode.toLocaleLowerCase() === 'production';

    if (!isProd) {
      // ELITE MODERN DASHBOARD LOGO
      console.log(`\n\x1b[38;5;196m  ██████╗  █████╗ ██████╗ ███████╗    \x1b[38;5;226m██╗███████╗\x1b[0m`);
      console.log(`\x1b[38;5;196m  ██╔══██╗██╔══██╗██╔══██╗██╔════╝    \x1b[38;5;226m██║██╔════╝\x1b[0m`);
      console.log(`\x1b[38;5;160m  ██████╔╝███████║██████╔╝█████╗      \x1b[38;5;220m██║███████╗\x1b[0m`);
      console.log(`\x1b[38;5;124m  ██╔══██╗██╔══██║██╔══██╗██╔══╝ ██   \x1b[38;5;214m██║╚════██║\x1b[0m`);
      console.log(`\x1b[38;5;88m  ██████╔╝██║  ██║██║  ██║███████╗╚█████╔╝███████║\x1b[0m`);
      console.log(`\x1b[38;5;52m  ╚══════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝ ╚════╝ ╚══════╝\x1b[0m`);
      console.log(`\x1b[90m  ───────────────────────────────────────────────────\x1b[0m`);
      console.log(`  \x1b[1m\x1b[38;5;46m▶\x1b[0m \x1b[38;5;255mHost\x1b[0m       \x1b[38;5;244m»\x1b[0m \x1b[38;5;117mhttp://${host}:${port}\x1b[0m`);
      console.log(`  \x1b[1m\x1b[38;5;46m▶\x1b[0m \x1b[38;5;255mRoutes\x1b[0m     \x1b[38;5;244m»\x1b[0m \x1b[38;5;215m${this.routes.length} paths optimized\x1b[0m`);
      console.log(`  \x1b[1m\x1b[38;5;46m▶\x1b[0m \x1b[38;5;255mMode\x1b[0m       \x1b[38;5;244m»\x1b[0m \x1b[38;5;201m${Mode.toLocaleUpperCase()}\x1b[0m`);
      console.log(`  \x1b[1m\x1b[38;5;46m▶\x1b[0m \x1b[38;5;255mEngine\x1b[0m     \x1b[38;5;244m»\x1b[0m \x1b[38;5;45mBun ${Bun.version} + Bare\x1b[0m`);
      console.log(`\x1b[90m  ───────────────────────────────────────────────────\x1b[0m\n`);

    } else {
      // PRODUCTION: Minimalist logging
      console.log(`[BAREJS] 🚀 Server started at http://${host}:${port} (${Mode.toLocaleUpperCase()} MODE)`);
    }

    this.server = Bun.serve({
      hostname: host,
      port: port,
      reusePort: this._reusePort,
      fetch: (req) => {
        if (!this.compiledFetch) this.compile();
        return this.compiledFetch!(req);
      },
      websocket: {
        open: (ws) => this.wsHandler?.handlers.open?.(ws),
        message: (ws, msg) => this.wsHandler?.handlers.message?.(ws, msg),
        close: (ws, code, res) => this.wsHandler?.handlers.close?.(ws, code, res),
      }
    });

    // Handle Shutdown signals
    const shutdown = () => {
      if (this.server) {
        process.stdout.write(`\r\x1b[K`); 
        console.log(`\x1b[1m\x1b[38;5;208m!\x1b[0m \x1b[1mShutdown\x1b[0m \x1b[90mrequested. Finalizing processes...\x1b[0m`);
        
        this.server.stop(); 
        
        setTimeout(() => {
          console.log(`\x1b[38;5;46m✓\x1b[0m \x1b[1mStopped\x1b[0m  \x1b[90mBareJS has exited cleanly.\x1b[0m\n`);
          process.exit(0);
        }, 350);
      }
    };

    process.on('SIGINT', shutdown);  // Ctrl+C
    process.on('SIGTERM', shutdown); // Kill command

    return this.server;
  }
}