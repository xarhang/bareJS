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

  public useLog(enabled: boolean = true): this {
    this._useLog = enabled;
    return this;
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
        const results = (await Promise.all(payload.map((item) => execCall(item, ctx)))).filter(Boolean);
        return results.length > 0 ? results : new Response(null, { status: 204 });
      }
      const res = await execCall(payload, ctx);
      return res === null ? new Response(null, { status: 204 }) : res;
    });

    return this;
  }


  // inherited use() from BareRouter handles router merging now

  private compileHandler(pipeline: any[], isLog: boolean): Function {
    const len = pipeline.length;

    // Static ResponseInit for 200 OK (Zero Allocation)
    const json200 = { status: 200, headers: { "content-type": "application/json" } };
    const text200 = { status: 200, headers: { "content-type": "text/plain" } };

    const logResCode = isLog ? 'doLog(res.status);' : '';
    const logStatusCode = isLog ? 'doLog(finalStatus);' : '';

    // Inline Finalizer
    const finalizeCode = `
      if (res instanceof Response) {
        ${logResCode}
        return res;
      }
      
      const finalStatus = ctx._status || 200;
      ${logStatusCode}

      if (typeof res === 'string') {
        if (finalStatus === 200 && !ctx._headers) return new Response(res, text200);
        const h = ctx._headers;
        if (h && !h["content-type"]) h["content-type"] = "text/plain";
        return new Response(res, {
          status: finalStatus,
          headers: h || text200.headers
        });
      }
      
      if (finalStatus === 200 && !ctx._headers) return Response.json(res ?? null, json200);
      const h = ctx._headers;
      if (h && !h["content-type"]) h["content-type"] = "application/json";
      return Response.json(res ?? null, {
        status: finalStatus,
        headers: h || json200.headers
      });
    `;

    const argSig = isLog ? 'ctx, doLog' : 'ctx';

    if (len === 1) {
      const fn0 = pipeline[0];
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
        const res = fn${len - 1}(ctx);
        if (res && res.then) return res.then(v => { const res = v; ${finalizeCode} });
        ${finalizeCode}
      `;
    }

    const noop = () => { };
    const fnHeader = isAsync
      ? `return async function(${argSig})`
      : `return function(${argSig})`;

    return new Function(...fnNames, 'noop', 'json200', 'text200', `${fnHeader} { ${code} }`)(...pipeline, noop, json200, text200);
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

    const releaseCode = `
      if (ctx.store.size > 0) ctx.store.clear();
      ctx.req = undefined;
      ctx.body = undefined;
      ctx._query = undefined;
      ctx._headers = undefined;
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

    const args = ['pool', 'maxPool', 'Context', 'hNotFound', 'hError', 'EMPTY_PARAMS', ...(hasGlobalMw ? ['hOptions'] : []), ...hNames];
    const values = [pool, maxPool, Context, hNotFound, hError, EMPTY_PARAMS, ...(hasGlobalMw ? [hOptions] : []), ...hoistedHandlers];

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
      ctx._status = 200;
      ctx._headers = undefined;
      if (ctx.store.size > 0) ctx.store.clear();
      ctx.params = EMPTY_PARAMS;
      ctx.body = undefined;
      ctx._query = undefined;

      ${routerCode}

      ${optionsFallback}

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
          websocket: {
            open(ws) { ws.data?.open?.(ws); },
            message(ws, msg) { ws.data?.message?.(ws, msg); },
            close(ws, code, reason) { ws.data?.close?.(ws, code, reason); },
            drain(ws) { ws.data?.drain?.(ws); }
          }
        })
      : Bun.serve({
          port: finalPort,
          hostname,
          reusePort,
          fetch: baseFetch
        });

    const shutdown = () => {
      const isProd = process.env.NODE_ENV === 'production';
      const serverName = this.name;
      const supportsEmoji = process.stdout.isTTY;

      if (isProd) {
        console.log(`[${serverName}] INFO: Stopping server...`);
      } else {

        const stopIcon = supportsEmoji ? "🛑" : "!";
        const checkIcon = supportsEmoji ? "✅" : "v";


        process.stdout.write(`\n\x1b[31m${stopIcon} Stopping ${serverName}...\x1b[0m\n`);
        server.stop();
        process.stdout.write(`\x1b[32m${checkIcon} ${serverName} has been stopped.\x1b[0m\n`);
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return server;
  }
}

export { Context, typebox, t };
