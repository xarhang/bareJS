import { BareRouter } from './router';
import { RadixNode } from './radix';
import { Context } from './context';
import { Type as typebox, Type as t } from '@sinclair/typebox';
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { bootstrapConfig } from "./loader";
import { generateOpenAPISpec, renderDocsHTML, type OpenAPIOptions } from "../utils/openapi";

export interface WebSocketRouteHandler {
  open?: (ws: any) => void;
  message?: (ws: any, message: string | Buffer) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}

export interface NotFoundResponse {
  status: number;
  message: string;
  [key: string]: any;
}
export class BareJS extends BareRouter {
  private tree = new RadixNode();
  private pool: Context[] = [];
  // private poolIdx = 0;
  private hotFetch?: (req: Request) => any;
  private compiled = false;
  private poolMask: number;
  private _useLog: boolean = false;
  private errorHandler?: (err: any, ctx: Context) => any;
  private wsRoutes = new Map<string, WebSocketRouteHandler>();
  private startHooks: (() => void | Promise<void>)[] = [];
  private stopHooks: (() => void | Promise<void>)[] = [];
  private server?: ReturnType<typeof Bun.serve>;
  private shutdownHandler?: () => Promise<void>;
  private wsAdapter = {
    open(ws: any) { ws.data?.open?.(ws); },
    message(ws: any, msg: any) { ws.data?.message?.(ws, msg); },
    close(ws: any, code: any, reason: any) { ws.data?.close?.(ws, code, reason); },
    drain(ws: any) { ws.data?.drain?.(ws); }
  };

  public useLog(enabled: boolean = true): this {
    this._useLog = enabled;
    return this;
  }

  public onStart(fn: () => void | Promise<void>): this {
    this.startHooks.push(fn);
    return this;
  }

  public onStop(fn: () => void | Promise<void>): this {
    this.stopHooks.push(fn);
    return this;
  }

  public async stop(closeActiveConnections = false): Promise<void> {
    if (this.shutdownHandler) {
      process.off("SIGINT", this.shutdownHandler);
      process.off("SIGTERM", this.shutdownHandler);
      this.shutdownHandler = undefined;
    }
    if (this.server) {
      this.server.stop(closeActiveConnections);
      this.server = undefined;
    }
    for (const hook of this.stopHooks) {
      await hook();
    }
  }
  constructor(poolSize: number = 1024) {
    super();
    bootstrapConfig();
    const size = Math.pow(2, Math.ceil(Math.log2(poolSize)));
    this.poolMask = size - 1;
    for (let i = 0; i < size; i++) {
      this.pool.push(new Context());
    }
    try {
      const pkgPath = join(process.cwd(), "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.name) {
        this.name = pkg.name
          .split(/[-_]/)
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }
    } catch {
      this.name = "App";
    }
  }

  private notFoundHandler: () => NotFoundResponse = () => ({
    status: 404,
    message: "Route not found"
  });
  public setNotFound(handler: () => NotFoundResponse) {
    this.notFoundHandler = handler;
  }

  public onError(handler: (err: any, ctx: Context) => any): this {
    this.errorHandler = handler;
    return this;
  }

  public ws(path: string, handler: WebSocketRouteHandler): this {
    const normalized = ('/' + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    this.wsRoutes.set(normalized, handler);
    return this;
  }

  public docs(path: string = '/docs', options: OpenAPIOptions = {}): this {
    const basePath = ('/' + path).replace(/\/+/g, '/').replace(/\/$/, '') || '/docs';
    const jsonPath = `${basePath}/json`;
    let cachedSpec: string | null = null;
    const html = renderDocsHTML(jsonPath, options.title || `${this.name} API Docs`);

    this.get(jsonPath, () => {
      if (!cachedSpec) {
        cachedSpec = JSON.stringify(generateOpenAPISpec(this.routes, { title: this.name, ...options }));
      }
      return new Response(cachedSpec, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    this.get(basePath, () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    });

    return this;
  }

  public rpc(path: string, procedures: Record<string, (params: any, ctx: Context) => any>): this {
    const execCall = async (reqObj: any, ctx: Context) => {
      if (!reqObj || reqObj.jsonrpc !== '2.0' || typeof reqObj.method !== 'string') {
        return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: reqObj?.id ?? null };
      }
      const fn = Object.hasOwn(procedures, reqObj.method) ? procedures[reqObj.method] : undefined;
      if (!fn) {
        return { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id: reqObj.id ?? null };
      }
      try {
        const result = await fn(reqObj.params, ctx);
        if (reqObj.id === undefined) return null; // Notification
        return { jsonrpc: '2.0', result, id: reqObj.id };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          error: { code: -32603, message: err?.message || 'Internal error' },
          id: reqObj.id ?? null
        };
      }
    };

    this.post(path, async (ctx: Context) => {
      const payload = await ctx.jsonBody();
      if (!payload) {
        return ctx.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      }
      if (Array.isArray(payload)) {
        if (payload.length === 0) {
          return ctx.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: null });
        }
        const results = (await Promise.all(payload.map((item) => execCall(item, ctx)))).filter(Boolean);
        return results.length > 0 ? results : new Response(null, { status: 204 });
      }
      const res = await execCall(payload, ctx);
      return res === null ? new Response(null, { status: 204 }) : res;
    });

    return this;
  }


  private _hasDerive = false;
  public derive<T extends Record<string, any>>(fn: (ctx: Context) => Promise<T> | T): this {
    this._hasDerive = true;
    this.use(async (ctx: any, next: any) => {
      const derived = await fn(ctx);
      if (derived && typeof derived === 'object') {
        const keys = Object.keys(derived);
        if (!ctx._derivedKeys) ctx._derivedKeys = [];
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i]!;
          if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
            ctx[k] = (derived as any)[k];
            ctx._derivedKeys.push(k);
          }
        }
      }
      return next();
    });
    return this;
  }

  // inherited use() from BareRouter handles router merging now

  private compileHandler(pipeline: any[], isLog: boolean): Function {
    const timeoutMw = pipeline.find((fn) => fn?.__timeout);
    if (timeoutMw) {
      const { ms, status, message } = timeoutMw.__timeout;
      const innerPipeline = pipeline.filter((fn) => !fn?.__timeout);
      const innerCompiled = this.compileHandler(innerPipeline, isLog);
      return async (ctx: Context, doLog?: any) => {
        const res = innerCompiled(ctx, doLog);
        if (!res || !res.then) return res;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeoutPromise = new Promise<Response>((resolve) => {
            timer = setTimeout(() => {
              resolve(Response.json({ status: 'error', code: 'REQUEST_TIMEOUT', message }, { status }));
            }, ms);
          });
          return await Promise.race([res, timeoutPromise]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      };
    }

    const len = pipeline.length;
    const rFilterMw = pipeline.find((fn) => fn?.__responseFilter);
    const rFilter = rFilterMw?.__responseFilter;
    const idemMw = pipeline.find((fn) => fn?.__idempotencyCommit);
    const idemCommit = idemMw?.__idempotencyCommit;

    // Static ResponseInit for 200 OK (Zero Allocation)
    const json200 = { status: 200, headers: { "content-type": "application/json" } };
    const text200 = { status: 200, headers: { "content-type": "text/plain" } };

    const logResCode = isLog ? 'doLog(res.status);' : '';
    const logStatusCode = isLog ? 'doLog(finalStatus);' : '';

    // Inline Finalizer
    const finalizeCode = `
      ${rFilter ? 'res = rFilter(res);' : ''}
      if (res instanceof Response) {
        if (ctx._headers) {
          for (const k in ctx._headers) {
            if (!res.headers.has(k)) res.headers.set(k, ctx._headers[k]);
          }
        }
        if (ctx._setCookies) {
          for (let i = 0; i < ctx._setCookies.length; i++) res.headers.append('Set-Cookie', ctx._setCookies[i]);
        }
        ${logResCode}
        return res;
      }
      
      const finalStatus = ctx._status || 200;
      ${idemCommit ? 'idemCommit(ctx, res, finalStatus);' : ''}
      ${logStatusCode}

      let outRes;
      if (typeof res === 'string') {
        if (finalStatus === 200 && !ctx._headers) {
          outRes = new Response(res, text200);
        } else {
          outRes = new Response(res, {
            status: finalStatus,
            headers: ctx._headers || text200.headers
          });
        }
      } else if (finalStatus === 200 && !ctx._headers) {
        outRes = Response.json(res ?? null, json200);
      } else {
        outRes = Response.json(res ?? null, {
          status: finalStatus,
          headers: ctx._headers || json200.headers
        });
      }

      if (ctx._setCookies) {
        for (let i = 0; i < ctx._setCookies.length; i++) outRes.headers.append('Set-Cookie', ctx._setCookies[i]);
      }
      return outRes;
    `;

    const argSig = isLog ? 'ctx, doLog' : 'ctx';

    if (len === 1) {
      const fn0 = pipeline[0]!;
      if (fn0.constructor.name === 'AsyncFunction') {
        return new Function('fn0', 'json200', 'text200', `return async function(${argSig}) {
          const res = await fn0(ctx);
          ${finalizeCode}
        }`)(fn0, json200, text200);
      }
      return new Function('fn0', 'json200', 'text200', `return function(${argSig}) {
        const res = fn0(ctx);
        if (res && res.then) return res.then(v => { const res = v; ${finalizeCode} });
        ${finalizeCode}
      }`)(fn0, json200, text200);
    }

    // Check async
    const isAsync = pipeline.some(fn => fn.constructor.name === 'AsyncFunction');
    let code = '';

    // Middleware Hoisting: Pass functions as arguments to avoid array lookup
    const fnNames = pipeline.map((_, i) => `fn${i}`);

    if (isAsync) {
      for (let i = 0; i < len - 1; i++) {
        code += `let r${i} = fn${i}(ctx, noop);\n`;
        code += `if (r${i}) {\n`;
        code += `  if (r${i}.then) r${i} = await r${i};\n`;
        code += `  if (r${i} instanceof Response) { ${isLog ? 'doLog(r' + i + '.status);' : ''} return r${i}; }\n`;
        code += `}\n`;
      }
      code += `
        let res = fn${len - 1}(ctx);
        if (res && res.then) res = await res;
        ${finalizeCode}
      `;
    } else {
      for (let i = 0; i < len - 1; i++) {
        code += `const r${i} = fn${i}(ctx, noop);\n`;
        code += `if (r${i} && r${i} instanceof Response) { ${isLog ? 'doLog(r' + i + '.status);' : ''} return r${i}; }\n`;
      }
      code += `
        let res = fn${len - 1}(ctx);
        if (res && res.then) return res.then(v => { let res = v; ${finalizeCode} });
        ${finalizeCode}
      `;
    }

    const noop = () => { };
    const fnHeader = isAsync
      ? `return async function(${argSig})`
      : `return function(${argSig})`;

    return new Function(...fnNames, 'noop', 'json200', 'text200', ...(rFilter ? ['rFilter'] : []), ...(idemCommit ? ['idemCommit'] : []), `${fnHeader} { ${code} }`)(...pipeline, noop, json200, text200, ...(rFilter ? [rFilter] : []), ...(idemCommit ? [idemCommit] : []));
  }

  public compile() {
    const isLog = this._useLog;
    this.tree = new RadixNode();
    for (const route of this.routes) {
      this.tree.insert(route.path, route.method, this.compileHandler(route.handlers, isLog));
    }

    const tree = this.tree;
    const pool = this.pool;
    const maxPool = pool.length;
    const hNotFound = this.notFoundHandler;
    const customError = this.errorHandler;
    const hError = (err: any, ctx: Context) => {
      if (customError) {
        const res = customError(err, ctx);
        if (res instanceof Response) return res;
        const status = ctx._status >= 400 ? ctx._status : 500;
        if (typeof res === 'string') return new Response(res, { status });
        return Response.json(res ?? null, { status });
      }
      if (err?.status >= 400 && err?.status < 500) {
        return Response.json({
          status: err.status,
          message: err.message || 'Bad Request'
        }, { status: err.status });
      }
      return Response.json({
        status: 500,
        message: process.env.NODE_ENV === 'development' ? (err?.message || "Internal Server Error") : "Internal Server Error",
        stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
      }, { status: 500 });
    };

    const hoistedHandlers: Function[] = [];
    const register = (h: Function) => {
      const name = `h${hoistedHandlers.length}`;
      hoistedHandlers.push(h);
      return name;
    };

    const rawRouterCode = tree.jitCompile(register);
    const EMPTY_PARAMS = Object.freeze({});
    const hNames = hoistedHandlers.map((_, i) => `h${i}`);

    const hasIdem = this.routes.some((r: any) => r.handlers.some((h: any) => h?.__idempotencyCommit));
    const deriveCleanup = this._hasDerive
      ? `if (ctx._derivedKeys) { for (let i = 0; i < ctx._derivedKeys.length; i++) delete ctx[ctx._derivedKeys[i]]; ctx._derivedKeys = undefined; }`
      : '';
    const idemCleanup = hasIdem
      ? `if (ctx._idempotencyKey) { ctx._idemInFlight.delete(ctx._idempotencyKey); ctx._idempotencyKey = undefined; ctx._idemInFlight = undefined; }`
      : '';

    const releaseCode = `
      if (ctx.store.size > 0) ctx.store.clear();
      ${deriveCleanup}
      ${idemCleanup}
      ctx.req = undefined;
      ctx._status = 200;
      ctx.body = undefined;
      ctx._query = undefined;
      ctx._cookies = undefined;
      ctx._setCookies = undefined;
      ctx._headers = undefined;
      ctx._requestId = undefined;
      ctx.params = EMPTY_PARAMS;
      if (poolTop < maxPool) pool[poolTop++] = ctx;
    `;

    const callSuffix = isLog ? '(ctx, doLog)' : '(ctx)';
    const routerCode = rawRouterCode.replace(
      /return (h\d+)\(ctx\);/g,
      `out = $1${callSuffix};
      if (out && out.then) return out.then((v) => { ${releaseCode} return v; }, (e) => { const errRes = hError(e, ctx); ${releaseCode} ${isLog ? 'doLog(errRes.status || 500);' : ''} return errRes; });
      ${releaseCode}
      return out;`
    );

    const hasGlobalMw = this.groupMiddleware.length > 0;
    const hOptions = hasGlobalMw ? this.compileHandler(this.groupMiddleware, isLog) : undefined;
    const optionsFallback = hasGlobalMw
      ? `if (method === 'OPTIONS') {
          out = hOptions${callSuffix};
          if (out && out.then) return out.then((v) => { ${releaseCode} return v; }, (e) => { const errRes = hError(e, ctx); ${releaseCode} ${isLog ? 'doLog(errRes.status || 500);' : ''} return errRes; });
          ${releaseCode}
          return out;
        }`
      : '';

    const staticMws = this.groupMiddleware.filter((m: any) => m.__isStatic);
    const hasStaticMw = staticMws.length > 0;
    const runStatic = hasStaticMw
      ? async (ctx: Context) => {
          const noop = () => {};
          for (let i = 0; i < staticMws.length; i++) {
            const r = await staticMws[i](ctx, noop);
            if (r instanceof Response) {
              if (ctx._headers) {
                for (const k in ctx._headers) {
                  const val = ctx._headers[k];
                  if (val !== undefined && !r.headers.has(k)) r.headers.set(k, val);
                }
              }
              return r;
            }
          }
          return undefined;
        }
      : undefined;

    const staticFallback = hasStaticMw
      ? `if (method === 'GET' || method === 'HEAD') {
          out = runStatic(ctx);
          if (out && out.then) {
            return out.then((v) => {
              if (v instanceof Response) { ${isLog ? 'doLog(v.status);' : ''} ${releaseCode} return v; }
              const errorBody = hNotFound();
              const status = errorBody.status || 404;
              ${isLog ? 'doLog(status);' : ''}
              ${releaseCode}
              return Response.json(errorBody, { status });
            }, (e) => {
              const errRes = hError(e, ctx);
              ${releaseCode}
              ${isLog ? 'doLog(errRes.status || 500);' : ''}
              return errRes;
            });
          }
        }`
      : '';

    const args = ['pool', 'maxPool', 'Context', 'hNotFound', 'hError', 'EMPTY_PARAMS', ...(hasGlobalMw ? ['hOptions'] : []), ...(hasStaticMw ? ['runStatic'] : []), ...hNames];
    const values = [pool, maxPool, Context, hNotFound, hError, EMPTY_PARAMS, ...(hasGlobalMw ? [hOptions] : []), ...(hasStaticMw ? [runStatic] : []), ...hoistedHandlers];

    const logInit = isLog ? `
    const start = performance.now();
    const doLog = (status) => {
      const duration = (performance.now() - start).toFixed(3);
      console.log(
        \` \\x1b[90m\${new Date().toLocaleTimeString()}\\x1b[0m \` +
        \`\\x1b[1m\\x1b[38;5;117m\${method.padEnd(7)}\\x1b[0m \` +
        \`\\x1b[38;5;250m\${url.substring(url.indexOf('/', 8))}\\x1b[0m \` +
        \`\${status >= 400 ? '\\x1b[33m' : '\\x1b[32m'}\${status}\\x1b[0m \` +
        \`\\x1b[90m(\${duration}ms)\\x1b[0m\`
      );
    };` : '';

    const fnBody = `
  let poolTop = maxPool;
  return function(req) {
    const url = req.url;
    let s = url.indexOf('/', 8);
    const q = s === -1 ? -1 : url.indexOf('?', s);
    const urlLen = q === -1 ? url.length : q;
    if (s !== -1) s++;
    else s = urlLen;

    const method = req.method;
    const ctx = poolTop > 0 ? pool[--poolTop] : new Context();
    let out;
    ${logInit}

    try {
      ctx.req = req;

      ${routerCode}

      ${optionsFallback}

      ${staticFallback}

      const errorBody = hNotFound();
      const status = errorBody.status || 404;
      ${isLog ? 'doLog(status);' : ''}
      ${releaseCode}
      return Response.json(errorBody, { status });

    } catch (e) {
      const errRes = hError(e, ctx);
      ${isLog ? 'doLog(errRes.status || 500);' : ''}
      ${releaseCode}
      return errRes;
    }
  }
`;

    this.hotFetch = new Function(...args, fnBody)(...values);
    this.compiled = true;
    this.fetch = this.hotFetch!;
  }

  public fetch = (req: Request): any => {
    if (!this.compiled) {
      this.compile();
      return this.hotFetch!(req);
    }
    return this.hotFetch!(req);
  };
  public name: string = "App";

  public listen(port?: number, hostname: string = '0.0.0.0', reusePort: boolean = true) {
    if (!this.compiled) this.compile();


    const { BARE_CONFIG } = require("./config");

 
    const finalPort = port || BARE_CONFIG.port || 3000;
    const isProd = process.env.NODE_ENV === 'production';

    if (!isProd) {
      console.log(`
  \x1b[33m  ____                    _ _____ \x1b[0m
  \x1b[33m | __ )  __ _ _ __ ___     | | ____|\x1b[0m
  \x1b[33m |  _ \\ / _\` | '__/ _ \\ _  | |  _|  \x1b[0m
  \x1b[33m | |_) | (_| | | |  __/| |_| | |___ \x1b[0m
  \x1b[33m |____/ \\__,_|_|  \\___| \\___/|_____|\x1b[0m
                                         
   \x1b[32m🚀 ${this.name} is running in development mode\x1b[0m
   \x1b[90m⚙️  Pool Size: ${this.pool.length} | JIT: Enabled | Port: ${finalPort}\x1b[0m
   \x1b[36m🛡️  Hash: ${BARE_CONFIG.hash.algorithm} (${BARE_CONFIG.hash.memoryCost / 1024}MB) | Iterations: ${BARE_CONFIG.hash.timeCost}\x1b[0m
      `);
    }

    const wsRoutes = this.wsRoutes;
    const baseFetch = this.fetch;
    const hasWs = wsRoutes.size > 0;

    const server = hasWs
      ? Bun.serve<WebSocketRouteHandler>({
          port: finalPort,
          hostname,
          reusePort,
          fetch(req: Request, srv: any) {
            if (req.headers.get('upgrade') === 'websocket') {
              const url = req.url;
              const s = url.indexOf('/', 8);
              const q = s === -1 ? -1 : url.indexOf('?', s);
              const path = s === -1 ? '/' : (q === -1 ? url.slice(s) : url.slice(s, q));
              const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
              const handler = wsRoutes.get(normalized);
              if (handler && srv.upgrade(req, { data: handler })) {
                return undefined as any;
              }
            }
            return baseFetch(req);
          },
          websocket: this.wsAdapter
        })
      : Bun.serve({
          port: finalPort,
          hostname,
          reusePort,
          fetch: baseFetch
        });

    this.server = server;
    for (const hook of this.startHooks) {
      Promise.resolve(hook()).catch((e) => console.error(`[${this.name}] onStart error:`, e));
    }

    const shutdown = async () => {
      const isProd = process.env.NODE_ENV === 'production';
      const serverName = this.name;
      const supportsEmoji = process.stdout.isTTY;

      if (isProd) {
        console.log(`[${serverName}] INFO: Stopping server...`);
        await this.stop(false);
      } else {
        const stopIcon = supportsEmoji ? "🛑" : "!";
        const checkIcon = supportsEmoji ? "✅" : "v";
        process.stdout.write(`\n\x1b[31m${stopIcon} Stopping ${serverName}...\x1b[0m\n`);
        await this.stop(false);
        process.stdout.write(`\x1b[32m${checkIcon} ${serverName} has been stopped.\x1b[0m\n`);
      }
      process.exit(0);
    };

    this.shutdownHandler = shutdown;
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return server;
  }
}

export { Context, typebox, t };
