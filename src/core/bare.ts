import { BareRouter } from './router';
import { RadixNode } from './radix';
import { Context } from './context';
import { Type as typebox, Type as t } from '@sinclair/typebox';
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { bootstrapConfig } from "./loader";

export interface NotFoundResponse {
  status: number;
  message: string;
  [key: string]: any;
}
export class BareJS extends BareRouter {
  private tree = new RadixNode();
  private pool: Context[] = [];
  private poolIdx = 0;
  private hotFetch?: (req: Request) => any;
  private compiled = false;
  private poolMask: number;

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


  // inherited use() from BareRouter handles router merging now

  private compileHandler(pipeline: any[]): Function {
    const mws = pipeline;
    const len = pipeline.length;

    //  Static ResponseInit for 200 OK (Zero Allocation)
    const json200 = { status: 200, headers: { "content-type": "application/json" } };

    // Inline Finalizer
    const finalizeCode = `
      if (res instanceof Response) return res;
      //  Smart Finalizer: Handle String vs Object vs Null
      if (typeof res === 'string') {
         return new Response(res, {
            status: ctx._status,
            headers: ctx._headers || { "content-type": "text/plain" }
         });
      }
      
      //  FASTEST PATH: 200 OK + No Custom Headers -> Use Cached Init
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

    //  Middleware Hoisting: Pass functions as arguments to avoid array lookup
    const fnNames = pipeline.map((_, i) => `fn${i}`);

    if (isAsync) {
      // ASYNC MODE
      for (let i = 0; i < len - 1; i++) {
        //  Smart Await: Optimistically assume sync execution
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
        //  Optim: Truthy check first
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
    const mask = this.poolMask;
    let pIdx = 0;
    const hNotFound = this.notFoundHandler;
    const hError = (err: any) => ({
      status: 500,
      message: err.message || "Internal Server Error",
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    //  JIT Compiler: Create all Code instead of tree.lookup
    const hoistedHandlers: Function[] = [];
    const register = (h: Function) => {
      const name = `h${hoistedHandlers.length}`;
      hoistedHandlers.push(h);
      return name;
    };

    const routerCode = tree.jitCompile(register);

    // Create seamless Fetcher (JIT Edition)
    // We send nodes into the closure so the code can use them
    const EMPTY_PARAMS = Object.freeze({});
    const hNames = hoistedHandlers.map((_, i) => `h${i}`);

    const args = ['pool', 'pIdx', 'mask', 'hNotFound', 'hError', 'EMPTY_PARAMS', ...hNames];
    const values = [pool, pIdx, mask, hNotFound, hError, EMPTY_PARAMS, ...hoistedHandlers];

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
        const ctx = pool[(++pIdx) & mask];
        try {
        //  INLINED Context.reset() for max speed (No function call overhead)
        ctx.req = req;
        ctx._status = 200;
        ctx._headers = undefined;
        if (ctx.store.size > 0) ctx.store.clear();
        ctx.params = EMPTY_PARAMS;
        ctx.body = undefined;

        //  JIT Generated Code Start
        ${routerCode}
        //  JIT Generated Code End
        const errorBody = hNotFound();
        return Response.json(errorBody, { status: errorBody.status || 404 });
        } catch (e) {
          const errorBody = hError(e);
          return Response.json(errorBody, { status: errorBody.status || 500 });
        }
      }
    `;

    this.hotFetch = new Function(...args, fnBody)(...values);
    this.compiled = true;
    // Auto-Optimize: Replace wrapper with direct JIT function
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
    
    // ดึงค่า Config ล่าสุดมาใช้
    const { BARE_CONFIG } = require("./config");
    
    // ลำดับความสำคัญ: Parameter > Config File > Default (3000)
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

    const server = Bun.serve({
      port: finalPort,
      hostname,
      fetch: this.fetch,
      reusePort: reusePort,
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
  }
}

export { Context, typebox, t };
