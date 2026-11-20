import { BareRouter, type InferSchema, type PrefixRoutes } from './router';
import { RadixNode } from './radix';
import { Context } from './context';
import { Type as typebox, Type as t } from '@sinclair/typebox';
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { bootstrapConfig } from "./loader";
import { BARE_CONFIG } from "./config";
import { generateOpenAPISpec, renderDocsHTML, type OpenAPIOptions } from "../utils/openapi";
import type { RouteSchemas } from "../security/validators";
import type { RouteSchema } from "../client/index";

export function normalizePoolSize(
  poolSize: number,
  defaultSize = 1024,
  maximumSize = 65_536
): number {
  const requested = Number.isFinite(poolSize) ? Math.floor(poolSize) : defaultSize;
  return Math.min(maximumSize, Math.max(0, requested));
}

export interface CronOptions {
  /** Execute the cron job immediately upon registration (default: false) */
  runOnStart?: boolean;
  /** Optional error handler when the cron callback throws or rejects */
  onError?: (err: any) => void;
}

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

type TypedRouteHandler<Derived, S extends RouteSchemas, Res> = (
  ctx: Context & Derived & {
    body: S extends { body: infer B } ? InferSchema<B> : any;
    query: S extends { query: infer Q } ? InferSchema<Q> : Record<string, string>;
    params: S extends { params: infer Pa } ? InferSchema<Pa> : Record<string, any>;
  }
) => Res | Promise<Res>;

type AddRoute<Derived extends Record<string, any>, Routes extends RouteSchema, M extends string> = {
  <P extends string, S extends RouteSchemas, Res = S extends { response: infer R } ? InferSchema<R> : any>(
    path: P,
    schemas: S,
    handler: TypedRouteHandler<Derived, S, Res>
  ): BareJS<Derived, Routes & Record<`${M} ${P}`, {
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
  ): BareJS<Derived, Routes & Record<`${M} ${P}`, { method: M; path: P; response: Awaited<Res> }>>;
};

export class BareJS<
  Derived extends Record<string, any> = {},
  Routes extends RouteSchema = {}
> extends BareRouter<Routes> {
  declare readonly __routes: Routes;
  private tree = new RadixNode();
  private pool: Array<Context | undefined> = [];
  private _poolState = { top: 0 };
  private readonly maxPool: number;
  // private poolIdx = 0;
  private hotFetch?: (req: Request, peerIp?: string) => any;
  private compiled = false;
  private _useLog: boolean = false;
  private _trustProxyBox = { val: false };

  /** @internal */
  _getPoolStats(): {
    free: number;
    capacity: number;
    backingLength: number;
  } {
    return {
      free: this._poolState.top,
      capacity: this.maxPool,
      backingLength: this.pool.length,
    };
  }

  protected override _onRouteMutate(): void {
    if (this.compiled) {
      this.compiled = false;
      this.fetch = this._lazyFetch;
    }
  }
  private errorHandler?: (err: any, ctx: Context) => any;
  private wsRoutes = new Map<string, WebSocketRouteHandler>();
  private startHooks: (() => void | Promise<void>)[] = [];
  private stopHooks: (() => void | Promise<void>)[] = [];
  private crons: Array<{ name: string; timer: ReturnType<typeof setInterval> }> = [];
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
    this._onRouteMutate();
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

  /**
   * Built-in overlap-safe background interval scheduler.
   * Automatically cleared when app.stop() is called.
   */
  public cron(
    name: string,
    intervalMs: number,
    fn: () => void | Promise<void>,
    options: CronOptions = {}
  ): this {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(`cron("${name}") intervalMs must be a positive finite number`);
    }
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await fn();
      } catch (err) {
        options.onError?.(err);
      } finally {
        running = false;
      }
    };
    const timer = setInterval(tick, intervalMs);
    this.crons.push({ name, timer });
    if (options.runOnStart) {
      void tick();
    }
    return this;
  }

  public async stop(closeActiveConnections = false): Promise<void> {
    for (const c of this.crons) {
      clearInterval(c.timer);
    }
    this.crons.length = 0;

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
      try {
        await hook();
      } catch (e) {
        console.error(`[${this.name}] onStop error:`, e);
      }
    }
  }
  private static readonly DEFAULT_POOL_SIZE = 1024;
  private static readonly MAX_POOL_SIZE = 65_536;

  constructor(poolSize: number = BareJS.DEFAULT_POOL_SIZE) {
    super();
    bootstrapConfig();
    this.maxPool = normalizePoolSize(
      poolSize,
      BareJS.DEFAULT_POOL_SIZE,
      BareJS.MAX_POOL_SIZE
    );
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
    this._onRouteMutate();
  }

  public onError(handler: (err: any, ctx: Context) => any): this {
    this.errorHandler = handler;
    this._onRouteMutate();
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
        cachedSpec = JSON.stringify(generateOpenAPISpec(this.routes, { title: this.name, excludePaths: [basePath, jsonPath], ...options }));
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

  public rpc(
    path: string,
    procedures: Record<string, (params: any, ctx: Context) => any>,
    options: { maxBatchSize?: number } = {}
  ): this {
    const maxBatchSize = options.maxBatchSize ?? 100;
    const isProd = process.env.NODE_ENV === 'production';

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
        const msg = !isProd || err?.expose || (err?.status >= 400 && err?.status < 500)
          ? (err?.message || 'Internal error')
          : 'Internal error';
        return {
          jsonrpc: '2.0',
          error: { code: -32603, message: msg },
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
        if (payload.length === 0 || payload.length > maxBatchSize) {
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


  declare public get: AddRoute<Derived, Routes, 'GET'>;
  declare public post: AddRoute<Derived, Routes, 'POST'>;
  declare public put: AddRoute<Derived, Routes, 'PUT'>;
  declare public patch: AddRoute<Derived, Routes, 'PATCH'>;
  declare public delete: AddRoute<Derived, Routes, 'DELETE'>;
  declare public options: AddRoute<Derived, Routes, 'OPTIONS'>;
  declare public head: AddRoute<Derived, Routes, 'HEAD'>;
  declare public all: AddRoute<Derived, Routes, 'ALL'>;

  declare public route: <P extends string, R2 extends RouteSchema = {}>(
    prefix: P,
    router: BareRouter<R2>
  ) => BareJS<Derived, Routes & PrefixRoutes<P, R2>>;

  declare public use: {
    <R2 extends RouteSchema = {}>(mw: BareRouter<R2>): BareJS<Derived, Routes & R2>;
    <P extends string, R2 extends RouteSchema = {}>(prefix: P, mw: BareRouter<R2>): BareJS<Derived, Routes & PrefixRoutes<P, R2>>;
    (mw: any): BareJS<Derived, Routes>;
  };

  private _hasDerive = false;
  private static readonly DERIVE_RESERVED = new Set([
    '__proto__', 'constructor', 'prototype',
    'req', 'params', 'store', 'body', 'user',
    'query', 'cookies', 'requestId', 'ip',
    'status', 'json', 'html', 'text', 'redirect', 'sse', 'upload', 'reset',
    'set', 'get', 'setHeader', 'setCookie', 'getSignedCookie', 'deleteCookie',
    'jsonBody', 'send', 'getQuery',
    '_status', '_headers', '_query', '_cookies', '_setCookies',
    '_requestId', '_peerIp', '_trustProxy', '_detached',
    '_derivedKeys', '_idempotencyKey', '_idemInFlight'
  ]);
  public derive<T extends Record<string, any>>(fn: (ctx: Context & Derived) => Promise<T> | T): BareJS<Derived & T, Routes> {
    this._hasDerive = true;
    const deriveMw = async (ctx: any, next: any) => {
      const derived = await fn(ctx);
      if (derived && typeof derived === 'object') {
        const keys = Object.keys(derived);
        if (!ctx._derivedKeys) ctx._derivedKeys = [];
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i]!;
          if (k === 'user') {
            ctx.set('user', (derived as any)[k]);
          } else if (!BareJS.DERIVE_RESERVED.has(k)) {
            ctx[k] = (derived as any)[k];
            ctx._derivedKeys.push(k);
          }
        }
      }
      return next();
    };
    (deriveMw as any).__isDerive = true;
    this.use(deriveMw);
    return this as any;
  }

  // inherited use() from BareRouter handles router merging now

  private compileHandler(pipeline: any[], isLog: boolean): Function {
    if (pipeline.length === 0) {
      return () => undefined;
    }

    const applyCtxHeadersToRes = (res: Response, ctx: Context): Response => {
      if (ctx._headers) {
        for (const k in ctx._headers) {
          const val = ctx._headers[k];
          if (val === undefined) continue;
          if (!res.headers.has(k)) {
            try { res.headers.set(k, val); } catch { /* ignore invalid header */ }
          } else if (k.toLowerCase() === 'vary') {
            const existing = res.headers.get('vary') || '';
            const parts = existing.toLowerCase().split(',').map((v) => v.trim());
            const toAdd = val.split(',').map((v) => v.trim()).filter((v) => v && !parts.includes(v.toLowerCase()));
            if (toAdd.length > 0) {
              try { res.headers.set('vary', existing ? `${existing}, ${toAdd.join(', ')}` : toAdd.join(', ')); } catch {}
            }
          }
        }
      }
      if (ctx._setCookies) {
        for (let i = 0; i < ctx._setCookies.length; i++) {
          try { res.headers.append('Set-Cookie', ctx._setCookies[i]!); } catch { /* ignore */ }
        }
        ctx._setCookies = undefined;
      }
      return res;
    };

    const compMw = pipeline.find((fn) => fn?.__compress);
    if (compMw) {
      const applyCompress = compMw.__compress;
      const innerPipeline = pipeline.filter((fn) => !fn?.__compress);
      const innerCompiled = this.compileHandler(innerPipeline, isLog);
      return async (ctx: Context, doLog?: any) => {
        const res = await innerCompiled(ctx, doLog);
        return applyCompress(ctx, res);
      };
    }

    const cbIdx = pipeline.findIndex((fn) => fn?.__circuitBreaker);
    if (cbIdx !== -1) {
      const cbMw = pipeline[cbIdx]!;
      const runWithBreaker = cbMw.__circuitBreaker;
      const rawPre = pipeline.slice(0, cbIdx);
      const prePipeline: any[] = [];
      const hoistedToPost: any[] = [];
      for (let i = 0; i < rawPre.length; i++) {
        const fn = rawPre[i];
        if (fn?.__timeout || fn?.__idempotencyCommit || fn?.__responseFilter) {
          hoistedToPost.push(fn);
        } else {
          prePipeline.push(fn);
        }
      }
      const postPipeline = [...hoistedToPost, ...pipeline.slice(cbIdx + 1)];
      const postCompiled = this.compileHandler(postPipeline, isLog);
      const noopPre = () => {};
      return async (ctx: Context, doLog?: any) => {
        for (let i = 0; i < prePipeline.length; i++) {
          let preRes = prePipeline[i](ctx, noopPre);
          if (preRes && typeof preRes.then === 'function') preRes = await preRes;
          if (preRes instanceof Response) {
            applyCtxHeadersToRes(preRes, ctx);
            if (isLog && doLog && !ctx._detached) doLog(preRes.status);
            return preRes;
          }
        }
        let innerRan = false;
        const out = await runWithBreaker(() => {
          innerRan = true;
          return postCompiled(ctx, doLog);
        });
        if (!innerRan && out instanceof Response) {
          applyCtxHeadersToRes(out, ctx);
          if (isLog && doLog && !ctx._detached) doLog(out.status);
        }
        return out;
      };
    }

    const timeoutMws = pipeline.filter((fn) => fn?.__timeout);
    if (timeoutMws.length > 0) {
      let chosen = timeoutMws[0]!.__timeout;
      for (let i = 1; i < timeoutMws.length; i++) {
        if (timeoutMws[i]!.__timeout.ms < chosen.ms) {
          chosen = timeoutMws[i]!.__timeout;
        }
      }
      const { ms, status, message } = chosen;
      const innerPipeline = pipeline.filter((fn) => !fn?.__timeout);
      const innerCompiled = this.compileHandler(innerPipeline, isLog);
      return async (ctx: Context, doLog?: any) => {
        const res = innerCompiled(ctx, doLog);
        if (!res || !res.then) return res;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeoutPromise = new Promise<Response>((resolve) => {
            timer = setTimeout(() => {
              ctx._detached = true;
              if ((ctx as any)._idempotencyKey && (ctx as any)._idemInFlight) {
                (ctx as any)._idemInFlight.delete((ctx as any)._idempotencyKey);
                (ctx as any)._idempotencyKey = undefined;
                (ctx as any)._idemInFlight = undefined;
              }
              if (typeof res.catch === 'function') res.catch(() => {});
              if (isLog && doLog) doLog(status);
              resolve(applyCtxHeadersToRes(Response.json({ status: 'error', code: 'REQUEST_TIMEOUT', message }, { status }), ctx));
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
    const idemRelease = idemMw?.__idempotencyRelease;

    // Static ResponseInit for 200 OK (Zero Allocation)
    const json200 = { status: 200, headers: { "content-type": "application/json" } };
    const text200 = { status: 200, headers: { "content-type": "text/plain" } };

    const logResCode = isLog ? 'if (!ctx._detached) doLog(res.status);' : '';
    const logStatusCode = isLog ? 'if (!ctx._detached) doLog(finalStatus);' : '';

    const buildResFinalize = `
      if (ctx._headers) {
        for (const k in ctx._headers) {
          const val = ctx._headers[k];
          if (val === undefined) continue;
          if (!res.headers.has(k)) {
            try { res.headers.set(k, val); } catch {}
          } else if (k.toLowerCase() === 'vary') {
            const existing = res.headers.get('vary') || '';
            const parts = existing.toLowerCase().split(',').map((v) => v.trim());
            const toAdd = val.split(',').map((v) => v.trim()).filter((v) => v && !parts.includes(v.toLowerCase()));
            if (toAdd.length > 0) {
              try { res.headers.set('vary', existing ? \`\${existing}, \${toAdd.join(', ')}\` : toAdd.join(', ')); } catch {}
            }
          }
        }
      }
      if (ctx._setCookies) {
        for (let i = 0; i < ctx._setCookies.length; i++) {
          try { res.headers.append('Set-Cookie', ctx._setCookies[i]); } catch {}
        }
      }
      ${logResCode}
      return res;
    `;

    const buildNonResFinalize = `
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
        outRes = Response.json(res ?? null);
      } else if (finalStatus === 200 && ctx._headers === lastHdrs) {
        outRes = Response.json(res ?? null, lastInit200);
      } else {
        const hdrs = ctx._headers || json200.headers;
        const init = { status: finalStatus, headers: hdrs };
        if (finalStatus === 200 && Object.isFrozen(hdrs)) {
          lastHdrs = hdrs;
          lastInit200 = init;
        }
        outRes = Response.json(res ?? null, init);
      }

      if (ctx._setCookies) {
        for (let i = 0; i < ctx._setCookies.length; i++) {
          try { outRes.headers.append('Set-Cookie', ctx._setCookies[i]); } catch {}
        }
      }
      return outRes;
    `;

    // Inline Finalizer
    const finalizeCode = `
      ${rFilter ? 'res = rFilter(res);' : ''}
      if (res instanceof Response) {
        ${idemCommit ? 'const ic = idemCommit(ctx, res, res.status); if (ic && ic.then) return ic.then(() => { ' + buildResFinalize + ' });' : ''}
        ${buildResFinalize}
      }
      
      const finalStatus = ctx._status || 200;
      ${idemCommit ? 'const ic = idemCommit(ctx, res, finalStatus); if (ic && ic.then) return ic.then(() => { ' + buildNonResFinalize + ' });' : ''}
      ${buildNonResFinalize}
    `;

    const argSig = isLog ? 'ctx, doLog' : 'ctx';
    const noop = () => { };

    const extraNames = [
      'applyShortCircuit',
      'noop',
      ...(rFilter ? ['rFilter'] : []),
      ...(idemCommit ? ['idemCommit'] : []),
      ...(idemRelease ? ['idemRelease'] : [])
    ];
    const extraVals = [
      applyCtxHeadersToRes,
      noop,
      ...(rFilter ? [rFilter] : []),
      ...(idemCommit ? [idemCommit] : []),
      ...(idemRelease ? [idemRelease] : [])
    ];

    const wrapIdem = (compiled: Function): Function => {
      if (!idemRelease) return compiled;
      return (ctx: Context, doLog?: any) => {
        try {
          const out = compiled(ctx, doLog);
          if (out && typeof out.then === 'function') {
            return out.then(
              (v: any) => v,
              (err: any) => {
                idemRelease(ctx);
                throw err;
              }
            );
          }
          return out;
        } catch (err) {
          idemRelease(ctx);
          throw err;
        }
      };
    };

    if (len === 1) {
      const fn0 = pipeline[0]!;
      if (fn0.constructor.name === 'AsyncFunction') {
        return wrapIdem(
          new Function('fn0', 'json200', 'text200', ...extraNames, `let lastHdrs = null, lastInit200 = null; return async function(${argSig}) {
            const res = await fn0(ctx, noop);
            ${finalizeCode}
          }`)(fn0, json200, text200, ...extraVals)
        );
      }
      return wrapIdem(
        new Function('fn0', 'json200', 'text200', ...extraNames, `let lastHdrs = null, lastInit200 = null; return function(${argSig}) {
          const res = fn0(ctx, noop);
          if (res && res.then) return res.then(v => { const res = v; ${finalizeCode} });
          ${finalizeCode}
        }`)(fn0, json200, text200, ...extraVals)
      );
    }

    // Check async
    const isAsync = pipeline.some(fn => fn.constructor.name === 'AsyncFunction');
    let code = '';

    // Middleware Hoisting: Pass functions as arguments to avoid array lookup
    const fnNames = pipeline.map((_, i) => `fn${i}`);
    let continueAsyncDef = '';

    if (isAsync) {
      for (let i = 0; i < len - 1; i++) {
        code += `let r${i} = fn${i}(ctx, noop);\n`;
        code += `if (r${i}) {\n`;
        code += `  if (r${i}.then) r${i} = await r${i};\n`;
        code += `  if (r${i} instanceof Response) { applyShortCircuit(r${i}, ctx); ${isLog ? 'if (!ctx._detached) doLog(r' + i + '.status);' : ''} return r${i}; }\n`;
        code += `}\n`;
      }
      code += `
        let res = fn${len - 1}(ctx, noop);
        if (res && res.then) res = await res;
        ${finalizeCode}
      `;
    } else {
      continueAsyncDef = `
        const fns = [${fnNames.join(', ')}];
        const continueAsync = async (${isLog ? 'idx, pending, ctx, doLog' : 'idx, pending, ctx'}) => {
          let r = await pending;
          if (r instanceof Response) { applyShortCircuit(r, ctx); ${isLog ? 'if (!ctx._detached) doLog(r.status);' : ''} return r; }
          for (let i = idx + 1; i < fns.length - 1; i++) {
            r = fns[i](ctx, noop);
            if (r) {
              if (typeof r.then === 'function') r = await r;
              if (r instanceof Response) { applyShortCircuit(r, ctx); ${isLog ? 'if (!ctx._detached) doLog(r.status);' : ''} return r; }
            }
          }
          let res = fns[fns.length - 1](ctx, noop);
          if (res && typeof res.then === 'function') res = await res;
          ${finalizeCode}
        };
      `;
      for (let i = 0; i < len - 1; i++) {
        code += `const r${i} = fn${i}(ctx, noop);\n`;
        code += `if (r${i}) {\n`;
        code += `  if (r${i} instanceof Response) { applyShortCircuit(r${i}, ctx); ${isLog ? 'if (!ctx._detached) doLog(r' + i + '.status);' : ''} return r${i}; }\n`;
        code += `  if (typeof r${i}.then === 'function') return continueAsync(${i}, r${i}, ${argSig});\n`;
        code += `}\n`;
      }
      code += `
        let res = fn${len - 1}(ctx, noop);
        if (res && res.then) return res.then(v => { let res = v; ${finalizeCode} });
        ${finalizeCode}
      `;
    }

    const fnHeader = isAsync
      ? `let lastHdrs = null, lastInit200 = null; return async function(${argSig})`
      : `let lastHdrs = null, lastInit200 = null; ${continueAsyncDef} return function(${argSig})`;

    return wrapIdem(
      new Function(...fnNames, 'json200', 'text200', ...extraNames, `${fnHeader} { ${code} }`)(...pipeline, json200, text200, ...extraVals)
    );
  }

  public compile() {
    const isLog = this._useLog;
    this.tree = new RadixNode();
    const explicitOptionsPaths = new Set<string>();
    for (const route of this.routes) {
      if (route.method === 'OPTIONS') explicitOptionsPaths.add(route.path);
      this.tree.insert(route.path, route.method, this.compileHandler(route.handlers, isLog));
    }
    for (const route of this.routes) {
      if (route.method === 'OPTIONS' || explicitOptionsPaths.has(route.path)) continue;
      let lastCorsIdx = -1;
      for (let i = route.handlers.length - 1; i >= 0; i--) {
        if ((route.handlers[i] as any)?.__isCors && !this.groupMiddleware.includes(route.handlers[i])) {
          lastCorsIdx = i;
          break;
        }
      }
      if (lastCorsIdx !== -1) {
        explicitOptionsPaths.add(route.path);
        const preflightPipeline = [
          ...route.handlers.slice(0, lastCorsIdx + 1).filter((h: any, idx: number) => idx === lastCorsIdx || !h?.__isCors),
          () => new Response(null, { status: 204 })
        ];
        this.tree.insert(route.path, 'OPTIONS', this.compileHandler(preflightPipeline, isLog));
      }
    }

    const tree = this.tree;
    const pool = this.pool;
    const maxPool = this.maxPool;
    const hNotFound = this.notFoundHandler;
    const customError = this.errorHandler;
    const applyCtxHeaders = (res: Response, ctx: Context): Response => {
      if (ctx._headers) {
        for (const k in ctx._headers) {
          const val = ctx._headers[k];
          if (val === undefined) continue;
          if (!res.headers.has(k)) {
            try { res.headers.set(k, val); } catch { /* ignore invalid header values on error path */ }
          } else if (k.toLowerCase() === 'vary') {
            const existing = res.headers.get('vary') || '';
            const parts = existing.toLowerCase().split(',').map((v) => v.trim());
            const toAdd = val.split(',').map((v) => v.trim()).filter((v) => v && !parts.includes(v.toLowerCase()));
            if (toAdd.length > 0) {
              try { res.headers.set('vary', existing ? `${existing}, ${toAdd.join(', ')}` : toAdd.join(', ')); } catch { /* ignore */ }
            }
          }
        }
      }
      if (ctx._setCookies) {
        for (let i = 0; i < ctx._setCookies.length; i++) {
          try { res.headers.append('Set-Cookie', ctx._setCookies[i]!); } catch { /* ignore */ }
        }
      }
      return res;
    };

    const formatCustomError = (res: any, ctx: Context): Response => {
      if (res instanceof Response) return applyCtxHeaders(res, ctx);
      const status = ctx._status >= 400 ? ctx._status : 500;
      if (typeof res === 'string') return applyCtxHeaders(new Response(res, { status }), ctx);
      return applyCtxHeaders(Response.json(res ?? null, { status }), ctx);
    };

    const defaultErrorRes = (err: any, ctx: Context): Response => {
      if (err?.status >= 400 && err?.status < 500) {
        return applyCtxHeaders(Response.json({
          status: err.status,
          message: err.message || 'Bad Request'
        }, { status: err.status }), ctx);
      }
      return applyCtxHeaders(Response.json({
        status: 500,
        message: process.env.NODE_ENV === 'development' ? (err?.message || "Internal Server Error") : "Internal Server Error",
        stack: process.env.NODE_ENV === 'development' ? err?.stack : undefined
      }, { status: 500 }), ctx);
    };

    const hError = (err: any, ctx: Context): Response | Promise<Response> => {
      if (customError) {
        try {
          const res = customError(err, ctx);
          if (res && typeof res.then === 'function') {
            return res.then(
              (resolved: any) => formatCustomError(resolved, ctx),
              (handlerErr: any) => defaultErrorRes(handlerErr, ctx)
            );
          }
          return formatCustomError(res, ctx);
        } catch (handlerErr) {
          return defaultErrorRes(handlerErr, ctx);
        }
      }
      return defaultErrorRes(err, ctx);
    };

    const hoistedHandlers: Function[] = [];
    const register = (h: Function) => {
      const name = `h${hoistedHandlers.length}`;
      hoistedHandlers.push(h);
      return name;
    };

    const EMPTY_PARAMS = Object.freeze({});

    const hasIdem = this.routes.some((r: any) => r.handlers.some((h: any) => h?.__idempotencyCommit)) ||
      this.groupMiddleware.some((m: any) => m?.__idempotencyCommit);
    const hasDerive = this._hasDerive || this.routes.some((r: any) => r.handlers.some((h: any) => h?.__isDerive));
    const deriveCleanup = hasDerive
      ? `if (ctx._derivedKeys) { for (let i = 0; i < ctx._derivedKeys.length; i++) delete ctx[ctx._derivedKeys[i]]; ctx._derivedKeys = undefined; }`
      : '';
    const idemCleanup = hasIdem
      ? `if (ctx._idempotencyKey) { if (ctx._idemInFlight) ctx._idemInFlight.delete(ctx._idempotencyKey); ctx._idempotencyKey = undefined; ctx._idemInFlight = undefined; }`
      : '';

    const releaseCode = `
      if (!ctx._detached) {
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
        ctx._peerIp = undefined;
        ctx.params = EMPTY_PARAMS;
        if (poolState.top < maxPool) pool[poolState.top++] = ctx;
      }
    `;

    const handleErrCode = `const errRes = hError(e, ctx);
      if (errRes && errRes.then) return errRes.then((r) => { ${isLog ? 'doLog(r.status || 500);' : ''} ${releaseCode} return r; });
      ${isLog ? 'doLog(errRes.status || 500);' : ''}
      ${releaseCode}
      return errRes;`;

    const callSuffix = isLog ? '(ctx, doLog)' : '(ctx)';
    const useCompactEmit = this.routes.length > 16;
    const routerCode = tree.jitCompile(register, 0, 'url', 's', [], (hName: string) =>
      useCompactEmit
        ? `out = ${hName}${callSuffix};
       if (out && out.then) return out.then((v) => { _rel(ctx); return v; }, (e) => _onErr(e, ctx${isLog ? ', doLog' : ''}));
       _rel(ctx);
       return out;`
        : `out = ${hName}${callSuffix};
       if (out && out.then) return out.then((v) => { ${releaseCode} return v; }, (e) => { ${handleErrCode} });
       ${releaseCode}
       return out;`
    );

    const hNames = hoistedHandlers.map((_, i) => `h${i}`);

    const hasGlobalMw = this.groupMiddleware.length > 0;
    const runGlobalOptions = hasGlobalMw
      ? async (ctx: Context) => {
          const mws = this.groupMiddleware;
          const dispatch = async (idx: number): Promise<Response | undefined> => {
            if (idx >= mws.length) return undefined;
            let nextCalled = false;
            let downstreamRes: Response | undefined;
            const r = await mws[idx](ctx, () => {
              nextCalled = true;
              return dispatch(idx + 1).then((res) => {
                downstreamRes = res;
                return res;
              });
            });
            if (r instanceof Response) return applyCtxHeaders(r, ctx);
            if (downstreamRes instanceof Response) return downstreamRes;
            if (!nextCalled) return dispatch(idx + 1);
            return undefined;
          };
          return dispatch(0);
        }
      : undefined;
    const optionsFallback = hasGlobalMw
      ? `if (method === 'OPTIONS') {
          out = runGlobalOptions(ctx);
          if (out && out.then) {
            return out.then((v) => {
              if (v instanceof Response) { ${isLog ? 'doLog(v.status);' : ''} ${releaseCode} return v; }
              const errorBody = hNotFound();
              const status = errorBody.status || 404;
              const nfRes = applyCtxHeaders(Response.json(errorBody, { status }), ctx);
              ${isLog ? 'doLog(status);' : ''}
              ${releaseCode}
              return nfRes;
            }, (e) => {
              ${handleErrCode}
            });
          }
        }`
      : '';

    const hasStaticMw = this.groupMiddleware.some((m: any) => m.__isStatic);
    const runStatic = hasStaticMw
      ? async (ctx: Context) => {
          const mws = this.groupMiddleware;
          const dispatch = async (idx: number): Promise<Response | undefined> => {
            if (idx >= mws.length) return undefined;
            let nextCalled = false;
            let downstreamRes: Response | undefined;
            const r = await mws[idx](ctx, () => {
              nextCalled = true;
              return dispatch(idx + 1).then((res) => {
                downstreamRes = res;
                return res;
              });
            });
            if (r instanceof Response) return applyCtxHeaders(r, ctx);
            if (downstreamRes instanceof Response) return downstreamRes;
            if (!nextCalled) return dispatch(idx + 1);
            return undefined;
          };
          return dispatch(0);
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
              const nfRes = applyCtxHeaders(Response.json(errorBody, { status }), ctx);
              ${isLog ? 'doLog(status);' : ''}
              ${releaseCode}
              return nfRes;
            }, (e) => {
              ${handleErrCode}
            });
          }
        }`
      : '';

    const globalCorsMws = this.groupMiddleware.filter((m: any) => m?.__isCors);
    const apply404Cors = globalCorsMws.length > 0
      ? (res: Response, ctx: Context): Response => {
          for (let i = 0; i < globalCorsMws.length; i++) {
            try { globalCorsMws[i](ctx, () => res); } catch {}
          }
          return applyCtxHeaders(res, ctx);
        }
      : undefined;

    const poolState = this._poolState;
    const trustProxyBox = this._trustProxyBox;
    const args = ['pool', 'poolState', 'maxPool', 'Context', 'hNotFound', 'hError', 'applyCtxHeaders', 'EMPTY_PARAMS', 'trustProxyBox', ...(hasGlobalMw ? ['runGlobalOptions'] : []), ...(hasStaticMw ? ['runStatic'] : []), ...(apply404Cors ? ['apply404Cors'] : []), ...hNames];
    const values = [pool, poolState, maxPool, Context, hNotFound, hError, applyCtxHeaders, EMPTY_PARAMS, trustProxyBox, ...(hasGlobalMw ? [runGlobalOptions] : []), ...(hasStaticMw ? [runStatic] : []), ...(apply404Cors ? [apply404Cors] : []), ...hoistedHandlers];

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

    const compactHelpers = useCompactEmit
      ? `
  const _rel = (ctx) => { ${releaseCode} };
  const _onErr = (e, ctx${isLog ? ', doLog' : ''}) => { ${handleErrCode} };`
      : '';
    const fnBody = `${compactHelpers}
  return function(req, peerIp) {
    const url = req.url;
    let s = url.indexOf('/', 8);
    const q = s === -1 ? -1 : url.indexOf('?', s);
    const urlLen = q === -1 ? url.length : q;
    if (s !== -1) s++;
    else s = urlLen;

    const method = req.method;
    let ctx;
    if (poolState.top > 0) {
      const slot = --poolState.top;
      ctx = pool[slot];
      pool[slot] = undefined;
    } else {
      ctx = new Context(trustProxyBox.val);
    }
    let out;
    ${logInit}

    try {
      ctx.req = req;
      ctx._peerIp = peerIp;

      ${routerCode}

      ${optionsFallback}

      ${staticFallback}

      const errorBody = hNotFound();
      const status = errorBody.status || 404;
      const nfRes = ${apply404Cors ? 'apply404Cors(Response.json(errorBody, { status }), ctx)' : 'applyCtxHeaders(Response.json(errorBody, { status }), ctx)'};
      ${isLog ? 'doLog(status);' : ''}
      ${releaseCode}
      return nfRes;

    } catch (e) {
      ${handleErrCode}
    }
  };
`;

    this.hotFetch = new Function(...args, fnBody)(...values);
    this.compiled = true;
    this.fetch = this.hotFetch!;
  }

  private readonly _lazyFetch = (req: Request, peerIp?: string): any => {
    if (!this.compiled) {
      this.compile();
      return this.hotFetch!(req, peerIp);
    }
    return this.hotFetch!(req, peerIp);
  };

  public fetch = this._lazyFetch;

  /**
   * Ergonomic in-memory request helper for testing or internal invocations.
   * Normalizes relative paths to http://localhost and delegates to this.fetch(req).
   */
  public async request(path: string, init?: RequestInit): Promise<Response> {
    let url: string;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      url = path;
    } else {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      url = `http://localhost${normalized}`;
    }
    return this.fetch(new Request(url, init));
  }
  public name: string = "App";

  public trustProxy(enabled: boolean = true): this {
    this._trustProxyBox.val = enabled;
    for (let i = 0; i < this.pool.length; i++) {
      const ctx = this.pool[i];
      if (ctx) ctx._trustProxy = enabled;
    }
    return this;
  }

  public listen(
    port?: number,
    hostname: string = '0.0.0.0',
    reusePort: boolean = true,
    options: { maxRequestBodySize?: number; trustProxy?: boolean } = {}
  ) {
    if (options.trustProxy !== undefined) {
      this.trustProxy(options.trustProxy);
    }
    if (!this.compiled) this.compile();
    const maxRequestBodySize = options.maxRequestBodySize ?? 10 * 1024 * 1024;

    const finalPort = port ?? BARE_CONFIG.port ?? 3000;
    const isProd = process.env.NODE_ENV === 'production';

    if (!isProd) {
      console.log(`
  \x1b[33m  ____                    _ _____ \x1b[0m
  \x1b[33m | __ )  __ _ _ __ ___     | | ____|\x1b[0m
  \x1b[33m |  _ \\ / _\` | '__/ _ \\ _  | |  _|  \x1b[0m
  \x1b[33m | |_) | (_| | | |  __/| |_| | |___ \x1b[0m
  \x1b[33m |____/ \\__,_|_|  \\___| \\___/|_____|\x1b[0m
                                         
   \x1b[32m🚀 ${this.name} is running in development mode\x1b[0m
   \x1b[90m⚙️  Pool Size: ${this.maxPool} | JIT: Enabled | Port: ${finalPort}\x1b[0m
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
          maxRequestBodySize,
          fetch(req: Request, srv: any) {
            if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
              const url = req.url;
              const s = url.indexOf('/', 8);
              const q = s === -1 ? -1 : url.indexOf('?', s);
              const path = s === -1 ? '/' : (q === -1 ? url.slice(s) : url.slice(s, q));
              const collapsed = path.replace(/\/+/g, '/');
              const normalized = collapsed.length > 1 && collapsed.endsWith('/') ? collapsed.slice(0, -1) : collapsed;
              let handler = wsRoutes.get(normalized);
              let params: Record<string, string> | undefined;
              if (!handler) {
                const reqParts = normalized.split('/').filter(Boolean);
                for (const [pattern, h] of wsRoutes) {
                  if (!pattern.includes(':') && !pattern.includes('*')) continue;
                  const patParts = pattern.split('/').filter(Boolean);
                  const matched: Record<string, string> = {};
                  let ok = true;
                  for (let i = 0; i < patParts.length; i++) {
                    const pp = patParts[i]!;
                    if (pp === '*') {
                      matched['*'] = reqParts.slice(i).join('/');
                      break;
                    }
                    if (i >= reqParts.length) { ok = false; break; }
                    if (pp.startsWith(':')) {
                      matched[pp.slice(1)] = reqParts[i]!;
                    } else if (pp !== reqParts[i]) {
                      ok = false; break;
                    }
                  }
                  if (ok && (patParts.includes('*') || patParts.length === reqParts.length)) {
                    handler = h;
                    params = matched;
                    break;
                  }
                }
              }
              if (handler && srv.upgrade(req, { data: params ? { ...handler, params } : handler })) {
                return undefined as any;
              }
            }
            return baseFetch(req, srv?.requestIP?.(req)?.address);
          },
          websocket: this.wsAdapter
        })
      : Bun.serve({
          port: finalPort,
          hostname,
          reusePort,
          maxRequestBodySize,
          fetch(req: Request, srv: any) {
            return baseFetch(req, srv?.requestIP?.(req)?.address);
          }
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
