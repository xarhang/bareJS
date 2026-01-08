import { BareRouter } from './router';
import { RadixNode } from './radix';
import { Context } from './context';
import { Type as typebox, Type as t } from '@sinclair/typebox';

export class BareJS extends BareRouter {
  private tree = new RadixNode();
  private pool: Context[] = [];
  private poolIdx = 0;
  private hotFetch?: (req: Request) => any;
  private compiled = false;

  constructor() {
    super();
    for (let i = 0; i < 1024; i++) {
      this.pool.push(new Context());
    }
  }



  // inherited use() from BareRouter handles router merging now

  private compileHandler(pipeline: any[]): Function {
    const mws = pipeline;
    const len = pipeline.length;

    // ⚡ Static ResponseInit for 200 OK (Zero Allocation)
    const json200 = { status: 200, headers: { "content-type": "application/json" } };

    // Inline Finalizer
    const finalizeCode = `
      if (res instanceof Response) return res;
      // ⚡ Smart Finalizer: Handle String vs Object vs Null
      if (typeof res === 'string') {
         return new Response(res, {
            status: ctx._status,
            headers: ctx._headers || { "content-type": "text/plain" }
         });
      }
      
      // ⚡ FASTEST PATH: 200 OK + No Custom Headers -> Use Cached Init
      if (ctx._status === 200 && !ctx._headers) {
         return Response.json(res ?? null, json200);
      }

      return Response.json(res ?? null, {
        status: ctx._status,
        headers: ctx._headers && ctx._headers["content-type"] ? ctx._headers : { "content-type": "application/json" }
      });
    `;

    if (len === 1) {
      // 🚀 Fast path: no middleware (just the handler)
      const fn0 = pipeline[0];
      return new Function('fn0', 'json200', `return function(ctx) {
        const res = fn0(ctx);
        if (res && res.then) return res.then(v => { const res = v; ${finalizeCode} });
        ${finalizeCode}
      }`)(fn0, json200);
    }

    // Check async
    const isAsync = pipeline.some(fn => fn.constructor.name === 'AsyncFunction');
    let code = '';

    // 🔥 Middleware Hoisting: Pass functions as arguments to avoid array lookup
    const fnNames = pipeline.map((_, i) => `fn${i}`);

    if (isAsync) {
      // ASYNC MODE
      for (let i = 0; i < len - 1; i++) {
        // ⚡ Smart Await: Optimistically assume sync execution
        code += `let r${i} = fn${i}(ctx, noop);\n`;
        code += `if (r${i}) {\n`;
        code += `  if (r${i}.then) r${i} = await r${i};\n`;
        code += `  if (r${i} instanceof Response) return r${i};\n`;
        code += `}\n`;
      }
    } else {
      // SYNC MODE
      for (let i = 0; i < len - 1; i++) {
        code += `const r${i} = fn${i}(ctx, noop);\n`;
        // ⚡ Optim: Truthy check first
        code += `if (r${i} && r${i} instanceof Response) return r${i};\n`;
      }
    }

    // Final handler
    if (isAsync) {
      code += `
         let res = fn${len - 1}(ctx);
         if (res && res.then) res = await res;
         ${finalizeCode}
       `;
    } else {
      code += `
         const res = fn${len - 1}(ctx);
         if (res && res.then) return res.then(v => { const res = v; ${finalizeCode} });
         ${finalizeCode}
       `;
    }

    const noop = () => { };

    const fnHeader = isAsync ? 'return async function(ctx)' : 'return function(ctx)';

    // Construct Function: (...fns, noop, json200) -> return function(ctx) { ... }
    return new Function(...fnNames, 'noop', 'json200', `${fnHeader} { ${code} }`)(...pipeline, noop, json200);
  }

  public compile() {
    this.tree = new RadixNode();
    for (const route of this.routes) {
      this.tree.insert(route.path, route.method, this.compileHandler(route.handlers));
    }

    const tree = this.tree;
    const pool = this.pool;
    let pIdx = 0;

    // 🔥 JIT Compiler: Create all Code instead of tree.lookup
    const hoistedHandlers: Function[] = [];
    const register = (h: Function) => {
      const name = `h${hoistedHandlers.length}`;
      hoistedHandlers.push(h);
      return name;
    };

    const routerCode = tree.jitCompile(register);

    // 🔥 Create seamless Fetcher (JIT Edition)
    // We send nodes into the closure so the code can use them
    const EMPTY_PARAMS = Object.freeze({});
    const hNames = hoistedHandlers.map((_, i) => `h${i}`);

    const args = ['pool', 'pIdx', 'EMPTY_PARAMS', ...hNames];
    const values = [pool, pIdx, EMPTY_PARAMS, ...hoistedHandlers];

    const fnBody = `
      return function(req) {
        const url = req.url;
        // Start searching after "http://" (7) or "https://" (8)
        let s = url.indexOf('/', 8);

        // Handle root path or missing slash
        if (s === -1) {
            s = url.length;
        } else if (url.charCodeAt(s) === 47) {
            // Skip the leading slash to match split() behavior (['users'] not ['/users'])
            s++;
        }

        const method = req.method;
        const ctx = pool[(++pIdx) & 1023];
        
        // ⚡ INLINED Context.reset() for max speed (No function call overhead)
        ctx.req = req;
        ctx._status = 200;
        ctx._headers = undefined;
        if (ctx.store.size > 0) ctx.store.clear();
        ctx.params = EMPTY_PARAMS;
        ctx.body = undefined;

        // ⚡ JIT Generated Code Start
        ${routerCode}
        // ⚡ JIT Generated Code End

        return new Response('404', { status: 404 });
      }
    `;

    this.hotFetch = new Function(...args, fnBody)(...values);
    this.compiled = true;
    // ⚡ Auto-Optimize: Replace wrapper with direct JIT function
    this.fetch = this.hotFetch!;
  }

  public fetch = (req: Request): any => {
    if (!this.compiled) {
      this.compile();
      return this.hotFetch!(req);
    }
    return this.hotFetch!(req);
  };

  public listen(port: number = 3000, hostname: string = '0.0.0.0') {
    if (!this.compiled) this.compile();

    console.log(`🚀 BareJS server running at http://${hostname}:${port}`);

    return Bun.serve({
      port,
      hostname,
      fetch: this.fetch,
      reusePort: true,

    });
  }
}

export { Context, typebox, t };
