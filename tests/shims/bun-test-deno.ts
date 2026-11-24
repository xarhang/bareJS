export {
  describe,
  it,
  it as test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "jsr:@std/testing@^1.0.0/bdd";
export { expect } from "jsr:@std/expect@^1.0.0";
import { spy, stub } from "jsr:@std/testing@^1.0.0/mock";
import * as zlib from "node:zlib";
import * as path from "node:path";
import { BareJS } from "../../src/core/bare.ts";

export function spyOn(obj: any, method: string) {
  const s = stub(obj, method as any);
  return Object.assign(s, {
    mockImplementation(fn: any) {
      s.restore();
      return stub(obj, method as any, fn);
    },
    mockRestore() {
      s.restore();
    },
  });
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
    gc() {},
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
