import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { brotliDecompressSync } from "node:zlib";
import {
  BareJS,
  BareRouter,
  Type,
  bareClient,
  rateLimit,
  idempotency,
  redisStore,
  bareAuth,
  createToken,
  revokeToken,
  isTokenRevoked,
  compress,
  staticFile,
  type BareStore,
} from "../src/index";

// --- Mock Redis Clients ---
function createMockIoredis() {
  const data = new Map<string, { val: string; expAt?: number }>();
  const clean = (k: string) => {
    const e = data.get(k);
    if (e && e.expAt !== undefined && e.expAt <= Date.now()) {
      data.delete(k);
      return undefined;
    }
    return e;
  };
  return {
    async get(k: string) {
      return clean(k)?.val ?? null;
    },
    async set(k: string, v: string, ...args: any[]) {
      let ttlMs: number | undefined;
      let nx = false;
      for (let i = 0; i < args.length; i++) {
        const a = String(args[i]).toUpperCase();
        if (a === "PX") ttlMs = Number(args[++i]);
        else if (a === "EX") ttlMs = Number(args[++i]) * 1000;
        else if (a === "NX") nx = true;
      }
      if (nx && clean(k) !== undefined) return null;
      data.set(k, {
        val: String(v),
        expAt: ttlMs !== undefined ? Date.now() + ttlMs : undefined,
      });
      return "OK";
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) {
        if (data.delete(k)) n++;
      }
      return n;
    },
    async incr(k: string) {
      const cur = clean(k);
      const next = (cur ? Number(cur.val) : 0) + 1;
      data.set(k, { val: String(next), expAt: cur?.expAt });
      return next;
    },
    async pexpire(k: string, ms: number) {
      const cur = clean(k);
      if (!cur) return 0;
      cur.expAt = Date.now() + ms;
      return 1;
    },
    async pttl(k: string) {
      const cur = clean(k);
      if (!cur) return -2;
      if (cur.expAt === undefined) return -1;
      return Math.max(0, cur.expAt - Date.now());
    },
  };
}

function createMockBunRedis() {
  const io = createMockIoredis();
  return {
    async send(command: string, args: (string | number)[]) {
      const cmd = command.toUpperCase();
      if (cmd === "GET") return io.get(String(args[0]));
      if (cmd === "SET") return io.set(String(args[0]), String(args[1]), ...args.slice(2));
      if (cmd === "DEL") return io.del(...args.map(String));
      if (cmd === "INCR") return io.incr(String(args[0]));
      if (cmd === "PEXPIRE") return io.pexpire(String(args[0]), Number(args[1]));
      if (cmd === "PTTL") return io.pttl(String(args[0]));
      throw new Error(`Unsupported mock command: ${cmd}`);
    },
  };
}

// --- Crypto Helpers for RS256 / ES256 ---
function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeJwtPart(obj: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function signAsymmetricJwt(
  header: Record<string, any>,
  payload: Record<string, any>,
  privateKey: CryptoKey,
  alg: "RS256" | "ES256"
): Promise<string> {
  const signingInput = `${encodeJwtPart({ typ: "JWT", ...header, alg })}.${encodeJwtPart(payload)}`;
  const algParams =
    alg === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5" }
      : { name: "ECDSA", hash: "SHA-256" };
  const sig = await crypto.subtle.sign(
    algParams,
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${toBase64Url(sig)}`;
}

async function spkiToPem(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  const b64 = Buffer.from(spki).toString("base64");
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

describe("Enhancements v2", () => {
  describe("1. Pluggable Store + Redis Adapter", () => {
    test("redisStore works with ioredis-style client for rateLimit, idempotency, and token revocation", async () => {
      const store = redisStore(createMockIoredis(), { prefix: "test:" });
      const app = new BareJS();

      app.get("/limited", rateLimit({ windowMs: 10_000, max: 2, store }), () => ({ ok: true }));
      app.post("/pay", idempotency({ ttlMs: 10_000, store }), (ctx) =>
        ctx.status(201).json({ orderId: "ord_1" })
      );
      app.get(
        "/me",
        bareAuth({ secret: "s3cr3t", revocationStore: store }),
        (ctx) => ({ user: ctx.user })
      );

      // Rate limit
      const r1 = await app.request("/limited");
      expect(r1.status).toBe(200);
      expect(r1.headers.get("x-ratelimit-remaining")).toBe("1");
      const r2 = await app.request("/limited");
      expect(r2.status).toBe(200);
      const r3 = await app.request("/limited");
      expect(r3.status).toBe(429);
      expect(r3.headers.get("retry-after")).toBeTruthy();

      // Idempotency with Response (201)
      const p1 = await app.request("/pay", {
        method: "POST",
        headers: { "idempotency-key": "key-1" },
      });
      expect(p1.status).toBe(201);
      expect(await p1.json()).toEqual({ orderId: "ord_1" });

      const p2 = await app.request("/pay", {
        method: "POST",
        headers: { "idempotency-key": "key-1" },
      });
      expect(p2.status).toBe(201);
      expect(p2.headers.get("x-idempotent-replayed")).toBe("true");
      expect(await p2.json()).toEqual({ orderId: "ord_1" });

      // Token revocation via store
      const token = await createToken(
        { id: 42, exp: Math.floor(Date.now() / 1000) + 60 },
        "s3cr3t"
      );
      const authOk = await app.request("/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(authOk.status).toBe(200);

      expect(await isTokenRevoked(token, store)).toBe(false);
      await revokeToken(token, Math.floor(Date.now() / 1000) + 60, store);
      expect(await isTokenRevoked(token, store)).toBe(true);

      const authRevoked = await app.request("/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(authRevoked.status).toBe(401);
    });

    test("redisStore works with Bun.redis send() client and enforces 409 lock on in-flight idempotency", async () => {
      const store = redisStore(createMockBunRedis());
      const app = new BareJS();

      app.post("/slow", idempotency({ ttlMs: 10_000, store }), async () => {
        await new Promise((r) => setTimeout(r, 40));
        return { done: true };
      });
      app.post("/err", idempotency({ ttlMs: 10_000, store }), () => {
        throw new Error("boom");
      });

      const first = app.request("/slow", {
        method: "POST",
        headers: { "idempotency-key": "flight-1" },
      });
      // Give acquire() a tick to lock the key
      await new Promise((r) => setTimeout(r, 5));
      const concurrent = await app.request("/slow", {
        method: "POST",
        headers: { "idempotency-key": "flight-1" },
      });
      expect(concurrent.status).toBe(409);
      expect((await concurrent.json()).code).toBe("IDEMPOTENT_IN_FLIGHT");

      const firstRes = await first;
      expect(firstRes.status).toBe(200);

      // Error releases the lock so retry succeeds
      const errRes = await app.request("/err", {
        method: "POST",
        headers: { "idempotency-key": "err-1" },
      });
      expect(errRes.status).toBe(500);
      expect(await store.get("idem:err-1")).toBeNull();
    });

    test("custom BareStore implementation works with rateLimit", async () => {
      const counts = new Map<string, number>();
      const customStore: BareStore = {
        async increment(key, windowMs) {
          const next = (counts.get(key) ?? 0) + 1;
          counts.set(key, next);
          return { count: next, resetAt: Date.now() + windowMs };
        },
        async get() { return null; },
        async set() {},
        async acquire() { return true; },
        async release() {},
        async isRevoked() { return false; },
        async revoke() {},
      };

      const app = new BareJS();
      app.get("/x", rateLimit({ windowMs: 5000, max: 1, store: customStore }), () => "ok");
      expect((await app.request("/x")).status).toBe(200);
      expect((await app.request("/x")).status).toBe(429);
    });
  });

  describe("2. app.request(path, init?)", () => {
    test("normalizes relative paths, missing leading slashes, and full URLs", async () => {
      const app = new BareJS();
      app.get("/ping", () => "pong");
      app.post("/echo", async (ctx) => {
        const body = await ctx.jsonBody();
        return { body, header: ctx.req.headers.get("x-test") };
      });

      const r1 = await app.request("/ping");
      expect(r1.status).toBe(200);
      expect(await r1.text()).toBe("pong");

      const r2 = await app.request("ping");
      expect(r2.status).toBe(200);
      expect(await r2.text()).toBe("pong");

      const r3 = await app.request("https://api.example.com/echo", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test": "yes" },
        body: JSON.stringify({ hello: "world" }),
      });
      expect(r3.status).toBe(200);
      expect(await r3.json()).toEqual({ body: { hello: "world" }, header: "yes" });
    });
  });

  describe("3. TypeScript Route Type Inference for BareJS.route() and BareJS.use(prefix, router)", () => {
    test("preserves end-to-end bareClient type inference across mounted sub-routers", async () => {
      const usersRouter = new BareRouter()
        .get(
          "/:id",
          {
            params: Type.Object({ id: Type.Integer() }),
            response: Type.Object({ id: Type.Number(), name: Type.String() }),
          },
          (ctx) => ({ id: ctx.params.id, name: "Alice" })
        )
        .post(
          "/",
          {
            body: Type.Object({ name: Type.String() }),
            response: Type.Object({ created: Type.Boolean(), name: Type.String() }),
          },
          (ctx) => ({ created: true, name: ctx.body.name })
        );

      const itemsRouter = new BareRouter().get(
        "/list",
        {
          response: Type.Object({ items: Type.Array(Type.String()) }),
        },
        () => ({ items: ["a", "b"] })
      );

      const app = new BareJS()
        .route("/api/users", usersRouter)
        .use("/v2", itemsRouter);

      const client = bareClient(app);

      const user = await client.get("/api/users/:id", { params: { id: 7 } });
      expect(user).toEqual({ id: 7, name: "Alice" });

      const created = await client.post("/api/users", { body: { name: "Bob" } });
      expect(created).toEqual({ created: true, name: "Bob" });

      const list = await client.get("/v2/list");
      expect(list).toEqual({ items: ["a", "b"] });
    });
  });

  describe("4. Asymmetric JWT (RS256 / ES256) & JWKS Support", () => {
    test("verifies RS256 with CryptoKey and PEM publicKey, and rejects HS256 / alg:none", async () => {
      const kp = await crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"]
      );

      const pem = await spkiToPem(kp.publicKey);
      const token = await signAsymmetricJwt(
        { kid: "k1" },
        { sub: "user-1", role: "admin", exp: Math.floor(Date.now() / 1000) + 60 },
        kp.privateKey,
        "RS256"
      );

      const app = new BareJS();
      app.get("/rsa-key", bareAuth({ algorithms: ["RS256"], publicKey: kp.publicKey }), (ctx) => ctx.user);
      app.get("/rsa-pem", bareAuth({ algorithms: ["RS256"], publicKey: pem }), (ctx) => ctx.user);

      const r1 = await app.request("/rsa-key", { headers: { authorization: `Bearer ${token}` } });
      expect(r1.status).toBe(200);
      expect((await r1.json()).sub).toBe("user-1");

      const r2 = await app.request("/rsa-pem", { headers: { authorization: `Bearer ${token}` } });
      expect(r2.status).toBe(200);
      expect((await r2.json()).role).toBe("admin");

      // Reject HS256 token on RS256 endpoint
      const hsToken = await createToken({ sub: "hs", exp: Math.floor(Date.now() / 1000) + 60 }, "secret");
      const r3 = await app.request("/rsa-key", { headers: { authorization: `Bearer ${hsToken}` } });
      expect(r3.status).toBe(401);

      // Reject alg: none
      const noneToken = `${encodeJwtPart({ alg: "none", typ: "JWT" })}.${encodeJwtPart({ sub: "x" })}.`;
      const r4 = await app.request("/rsa-key", { headers: { authorization: `Bearer ${noneToken}` } });
      expect(r4.status).toBe(401);
    });

    test("verifies ES256 with CryptoKey and PEM publicKey", async () => {
      const kp = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
      const pem = await spkiToPem(kp.publicKey);
      const token = await signAsymmetricJwt(
        {},
        { sub: "ec-user", exp: Math.floor(Date.now() / 1000) + 60 },
        kp.privateKey,
        "ES256"
      );

      const app = new BareJS();
      app.get("/ec-key", bareAuth({ algorithms: ["ES256"], publicKey: kp.publicKey }), (ctx) => ctx.user);
      app.get("/ec-pem", bareAuth({ algorithms: ["ES256"], publicKey: pem }), (ctx) => ctx.user);

      expect((await app.request("/ec-key", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
      expect((await app.request("/ec-pem", { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    });

    test("fetches JWKS from jwksUri, caches by kid, and refreshes on unknown kid", async () => {
      const kp1 = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
      const kp2 = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign", "verify"]
      );
      const jwk1 = { ...(await crypto.subtle.exportKey("jwk", kp1.publicKey)), kid: "key-1", alg: "ES256", use: "sig" };
      const jwk2 = { ...(await crypto.subtle.exportKey("jwk", kp2.publicKey)), kid: "key-2", alg: "ES256", use: "sig" };

      let fetchCount = 0;
      let keys = [jwk1];

      const jwksServer = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch() {
          fetchCount++;
          return Response.json({ keys });
        },
      });

      try {
        const app = new BareJS();
        app.get(
          "/jwks",
          bareAuth({
            algorithms: ["ES256"],
            jwksUri: `http://127.0.0.1:${jwksServer.port}/.well-known/jwks.json`,
            jwksCacheTtlMs: 60_000,
          }),
          (ctx) => ctx.user
        );

        const t1 = await signAsymmetricJwt(
          { kid: "key-1" },
          { sub: "u1", exp: Math.floor(Date.now() / 1000) + 60 },
          kp1.privateKey,
          "ES256"
        );

        expect((await app.request("/jwks", { headers: { authorization: `Bearer ${t1}` } })).status).toBe(200);
        expect(fetchCount).toBe(1);

        // Second request uses cached kid
        expect((await app.request("/jwks", { headers: { authorization: `Bearer ${t1}` } })).status).toBe(200);
        expect(fetchCount).toBe(1);

        // Rotate key: add key-2 and send token with kid=key-2
        keys = [jwk1, jwk2];
        const t2 = await signAsymmetricJwt(
          { kid: "key-2" },
          { sub: "u2", exp: Math.floor(Date.now() / 1000) + 60 },
          kp2.privateKey,
          "ES256"
        );
        const res2 = await app.request("/jwks", { headers: { authorization: `Bearer ${t2}` } });
        expect(res2.status).toBe(200);
        expect((await res2.json()).sub).toBe("u2");
        expect(fetchCount).toBe(2);
      } finally {
        jwksServer.stop(true);
      }
    });
  });

  describe("5. compress (zstd/brotli/gzip) & staticFile metadata cache", () => {
    test("compress negotiates zstd, br, and gzip based on Accept-Encoding and custom preference", async () => {
      const payload = "hello barejs compression ".repeat(100);
      const app = new BareJS();
      app.use(compress({ threshold: 100 }));
      app.get("/data", () => payload);

      // zstd preferred by default
      const rZstd = await app.request("/data", {
        headers: { "accept-encoding": "gzip, br, zstd" },
      });
      expect(rZstd.headers.get("content-encoding")).toBe("zstd");
      const zstdBuf = new Uint8Array(await rZstd.arrayBuffer());
      expect(new TextDecoder().decode(Bun.zstdDecompressSync(zstdBuf))).toBe(payload);

      // br when zstd not accepted
      const rBr = await app.request("/data", {
        headers: { "accept-encoding": "gzip, br" },
      });
      expect(rBr.headers.get("content-encoding")).toBe("br");
      const brBuf = new Uint8Array(await rBr.arrayBuffer());
      expect(brotliDecompressSync(brBuf).toString("utf-8")).toBe(payload);

      // gzip fallback
      const rGzip = await app.request("/data", {
        headers: { "accept-encoding": "gzip" },
      });
      expect(rGzip.headers.get("content-encoding")).toBe("gzip");
      const gzBuf = new Uint8Array(await rGzip.arrayBuffer());
      expect(new TextDecoder().decode(Bun.gunzipSync(gzBuf))).toBe(payload);

      // Custom preference order
      const appCustom = new BareJS();
      appCustom.use(compress({ threshold: 100, encodings: ["gzip", "br"] }));
      appCustom.get("/data", () => payload);
      const rCustom = await appCustom.request("/data", {
        headers: { "accept-encoding": "zstd, br, gzip" },
      });
      expect(rCustom.headers.get("content-encoding")).toBe("gzip");
    });

    test("staticFile cacheMetadata caches ETag/stat, handles 304/206, and expires on TTL", async () => {
      const dir = mkdtempSync(join(tmpdir(), "barejs-static-cache-"));
      try {
        writeFileSync(join(dir, "a.txt"), "alpha-content-12345");
        writeFileSync(join(dir, "b.txt"), "bravo-content");
        writeFileSync(join(dir, "c.txt"), "charlie-content");

        const app = new BareJS();
        app.use(
          staticFile(dir, {
            cacheMetadata: { maxEntries: 2, ttlMs: 80 },
            etag: true,
          })
        );

        const r1 = await app.request("/a.txt");
        expect(r1.status).toBe(200);
        const etag = r1.headers.get("etag");
        expect(etag).toBeTruthy();
        expect(await r1.text()).toBe("alpha-content-12345");

        // 304 Not Modified via cached ETag
        const r304 = await app.request("/a.txt", {
          headers: { "if-none-match": etag! },
        });
        expect(r304.status).toBe(304);

        // 206 Partial Content via cached fileSize
        const r206 = await app.request("/a.txt", {
          headers: { range: "bytes=0-4" },
        });
        expect(r206.status).toBe(206);
        expect(await r206.text()).toBe("alpha");

        // Trigger LRU eviction (>2 entries)
        expect((await app.request("/b.txt")).status).toBe(200);
        expect((await app.request("/c.txt")).status).toBe(200);

        // Wait for TTL expiry and update a.txt
        await new Promise((r) => setTimeout(r, 100));
        writeFileSync(join(dir, "a.txt"), "updated-alpha-content!");
        const rUpdated = await app.request("/a.txt");
        expect(rUpdated.status).toBe(200);
        expect(await rUpdated.text()).toBe("updated-alpha-content!");
        expect(rUpdated.headers.get("etag")).not.toBe(etag);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
