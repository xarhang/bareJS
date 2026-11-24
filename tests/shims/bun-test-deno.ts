import {
  describe,
  it as bddIt,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "jsr:@std/testing@^1.0.0/bdd";
export { describe, beforeAll, afterAll, beforeEach, afterEach };
import { expect as stdExpect } from "jsr:@std/expect@^1.0.0";
import { spy } from "jsr:@std/testing@^1.0.0/mock";
import * as zlib from "node:zlib";
import * as path from "node:path";
import { BareJS } from "../../src/core/bare.ts";

export function expect(received: any): any {
  if (received && received.__isBareSpy) {
    const checkCalls = (negate: boolean) => ({
      toHaveBeenCalled() {
        const ok = received.calls.length > 0;
        if (negate ? ok : !ok) throw new Error(`Expected spy ${negate ? "not " : ""}to have been called`);
      },
      toHaveBeenCalledTimes(n: number) {
        const ok = received.calls.length === n;
        if (negate ? ok : !ok) throw new Error(`Expected spy to be called ${n} times, got ${received.calls.length}`);
      },
      toHaveBeenCalledWith(...expected: any[]) {
        const ok = received.calls.some((c: any[]) =>
          c.length === expected.length && c.every((v: any, i: number) => {
            try { stdExpect(v).toEqual(expected[i]); return true; } catch { return false; }
          })
        );
        if (negate ? ok : !ok) throw new Error(`Expected spy ${negate ? "not " : ""}to have been called with ${JSON.stringify(expected)}`);
      },
    });
    const pos = checkCalls(false);
    const neg = checkCalls(true);
    return new Proxy(pos, {
      get(target, prop) {
        if (prop === "not") {
          return new Proxy(neg, {
            get(nt, nprop) {
              return nprop in nt ? (nt as any)[nprop] : stdExpect(received).not[nprop];
            },
          });
        }
        return prop in target ? (target as any)[prop] : stdExpect(received)[prop];
      },
    });
  }
  return stdExpect(received);
}

function makeTestFn(base: any) {
  const fn: any = (...args: any[]) => base(...args);
  fn.skip = (...args: any[]) => base.skip?.(...args);
  fn.only = (...args: any[]) => base.only?.(...args);
  fn.each = (cases: any[]) => (name: string, body: (...args: any[]) => any) => {
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const args = Array.isArray(c) ? c : [c];
      let label = name;
      for (const a of args) {
        label = label.replace(/%[sdifjoO%]/, String(a));
      }
      base(`${label} [${i}]`, () => body(...args));
    }
  };
  return fn;
}

export const it = makeTestFn(bddIt);
export const test = it;

export function spyOn(obj: any, method: string) {
  const original = obj[method];
  let impl: (...args: any[]) => any = (...args: any[]) =>
    typeof original === "function" ? original.apply(obj, args) : undefined;
  const calls: any[][] = [];
  const sp: any = function (this: any, ...args: any[]) {
    calls.push(args);
    return impl.apply(this, args);
  };
  obj[method] = sp;

  sp.__isBareSpy = true;
  sp.calls = calls;
  sp.mockImplementation = (fn: (...args: any[]) => any) => {
    impl = fn;
    return sp;
  };
  sp.mockReturnValue = (val: any) => {
    impl = () => val;
    return sp;
  };
  sp.mockResolvedValue = (val: any) => {
    impl = () => Promise.resolve(val);
    return sp;
  };
  sp.mockRestore = () => {
    obj[method] = original;
  };
  sp.mockClear = () => {
    calls.length = 0;
  };
  return sp;
}

export const mock = Object.assign(
  (fn?: (...args: any[]) => any) => spy(fn ?? (() => undefined)),
  {
    module: () => {},
    restore: () => {},
  }
);

if (!(globalThis as any).Bun) {
  (globalThis as any).Bun = {
    sleep(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    async write(filePath: string, data: string | Uint8Array) {
      await Deno.mkdir(path.dirname(filePath), { recursive: true });
      if (typeof data === "string") {
        await Deno.writeTextFile(filePath, data);
        return new TextEncoder().encode(data).byteLength;
      }
      await Deno.writeFile(filePath, data);
      return data.byteLength;
    },
    gunzipSync(data: Uint8Array) {
      return new Uint8Array(zlib.gunzipSync(data));
    },
    gzipSync(data: Uint8Array | string) {
      return new Uint8Array(zlib.gzipSync(data));
    },
    zstdDecompressSync(data: Uint8Array) {
      if (typeof (zlib as any).zstdDecompressSync === "function") {
        return new Uint8Array((zlib as any).zstdDecompressSync(data));
      }
      throw new Error("zstdDecompressSync not available in this Deno/Node zlib");
    },
    gc() {
      if (typeof (globalThis as any).gc === "function") {
        (globalThis as any).gc();
      }
    },
    serve(opts: { port?: number; hostname?: string; fetch: (req: Request) => Response | Promise<Response> }) {
      const app = new BareJS({ banner: false });
      app.all("/*", (ctx) => opts.fetch(ctx.req));
      const server: any = app.listen(opts.port ?? 0, opts.hostname ?? "127.0.0.1");
      return {
        get port() {
          return server.port;
        },
        ready: server.ready,
        stop() {
          return server.stop?.(true);
        },
      };
    },
  };
}
