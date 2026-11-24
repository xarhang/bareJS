import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import zlib from "node:zlib";
import { BareJS } from "../../src/core/bare";

if (typeof (globalThis as any).WebSocket === "undefined") {
  const req = createRequire(import.meta.url);
  (globalThis as any).WebSocket = req("ws").WebSocket;
}

if (!(globalThis as any).Bun) {
  (globalThis as any).Bun = {
    sleep(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    async write(filePath: string, data: string | Uint8Array) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, data);
      return typeof data === "string" ? Buffer.byteLength(data) : data.byteLength;
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
      throw new Error("zstdDecompressSync not available in this Node version");
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
          return server.stop(true);
        },
      };
    },
  };
}
