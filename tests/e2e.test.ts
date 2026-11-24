import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import {
  BareJS,
  Context,
  Type,
  bareAuth,
  createToken,
  cors,
  rateLimit,
  securityHeaders,
  staticFile,
  Hash,
  bareClient
} from "../src/index";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Full Live-Server E2E Test Suite (HTTP + WS + SSE + Security)", () => {
  const SECRET = "e2e_jwt_secret";
  const COOKIE_SECRET = "e2e_cookie_secret";
  let server: any;
  let baseUrl: string;
  let staticDir: string;
  const users = new Map<string, string>();

  beforeAll(async () => {
    staticDir = mkdtempSync(join(tmpdir(), "barejs-e2e-"));
    writeFileSync(join(staticDir, "index.html"), "<html><body><h1>BareJS E2E</h1></body></html>");
    writeFileSync(join(staticDir, "data.txt"), "ABCDEFGHIJ");

    const app = new BareJS();
    app.use(securityHeaders({ contentSecurityPolicy: "default-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'" }));
    app.use(cors({ origin: "https://client.example.com" }));
    app.use(staticFile(staticDir, { maxAge: 120 }));

    app.onError((err, ctx) => {
      ctx.status(500);
      return { error: err.message };
    });

    app.post("/auth/register", {
      body: Type.Object({ username: Type.String(), password: Type.String() })
    }, async (ctx: Context) => {
      const hash = await Hash.make(ctx.body.password);
      users.set(ctx.body.username, hash);
      return ctx.status(201).json({ registered: ctx.body.username });
    });

    app.post("/auth/login", {
      body: Type.Object({ username: Type.String(), password: Type.String() })
    }, async (ctx: Context) => {
      const hash = users.get(ctx.body.username);
      if (!hash || !(await Hash.verify(ctx.body.password, hash))) {
        return ctx.status(401).json({ error: "Invalid credentials" });
      }
      const token = await createToken({ sub: ctx.body.username, exp: Math.floor(Date.now() / 1000) + 300 }, SECRET);
      ctx.setCookie("session", ctx.body.username, { secret: COOKIE_SECRET, httpOnly: true, sameSite: "Lax" });
      return { token };
    });

    app.get("/api/me", bareAuth(SECRET), (ctx: Context) => ({
      jwtUser: ctx.get("user"),
      cookieUser: ctx.getSignedCookie("session", COOKIE_SECRET)
    }));

    app.get("/api/limited", rateLimit({ max: 2, windowMs: 5000 }), () => ({ ok: true }));

    app.get("/api/sse", (ctx: Context) =>
      ctx.sse(async (send) => {
        send({ step: 1 }, "tick", "1");
        send({ step: 2 }, "tick", "2");
      })
    );

    app.rpc("/api/rpc", {
      multiply: ({ a, b }: { a: number; b: number }) => a * b
    });

    app.ws("/ws/echo", {
      open: (ws) => ws.send("ready"),
      message: (ws, msg) => ws.send(`ws:${msg}`)
    });

    app.docs("/docs", { title: "E2E API", version: "1.0.0" });

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const port = 28000 + Math.floor(Math.random() * 10000);
    server = app.listen(port, "127.0.0.1", false);
    await (server as any).ready;
    process.env.NODE_ENV = prevEnv;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(() => {
    server?.stop(true);
    if (staticDir) rmSync(staticDir, { recursive: true, force: true });
  });

  test("Full Auth Flow (Register -> Argon2id -> Login -> Signed Cookie + JWT -> /api/me)", async () => {
    const client = bareClient(baseUrl);

    const reg = await client.post("/auth/register", {
      body: { username: "alice", password: "StrongPassword!123" }
    });
    expect(reg).toEqual({ registered: "alice" });

    const loginRes = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "StrongPassword!123" })
    });
    expect(loginRes.status).toBe(200);
    const { token } = await loginRes.json();
    const rawCookie = loginRes.headers.getSetCookie()[0]!.split(";")[0]!;

    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: rawCookie
      }
    });
    expect(meRes.status).toBe(200);
    const me = await meRes.json();
    expect(me.jwtUser.sub).toBe("alice");
    expect(me.cookieUser).toBe("alice");
    expect(meRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(meRes.headers.get("access-control-allow-origin")).toBe("https://client.example.com");
  });

  test("Live Rate Limiting (429), CORS Preflight (204), and Static Range/304", async () => {
    const pre = await fetch(`${baseUrl}/api/limited`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);

    expect((await fetch(`${baseUrl}/api/limited`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/limited`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/limited`)).status).toBe(429);

    const st = await fetch(`${baseUrl}/data.txt`, { headers: { Range: "bytes=2-5" } });
    expect(st.status).toBe(206);
    expect(await st.text()).toBe("CDEF");
  });

  test("Live SSE, JSON-RPC 2.0, OpenAPI Docs, and WebSocket", async () => {
    // SSE
    const sseRes = await fetch(`${baseUrl}/api/sse`);
    expect(sseRes.status).toBe(200);
    const sseText = await sseRes.text();
    expect(sseText).toContain("event: tick");
    expect(sseText).toContain('{"step":2}');

    // JSON-RPC 2.0
    const rpcRes = await fetch(`${baseUrl}/api/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "multiply", params: { a: 6, b: 7 }, id: 1 })
    });
    expect(await rpcRes.json()).toEqual({ jsonrpc: "2.0", result: 42, id: 1 });

    // OpenAPI Docs
    const docsRes = await fetch(`${baseUrl}/docs/json`);
    expect(docsRes.status).toBe(200);
    expect((await docsRes.json()).info.title).toBe("E2E API");

    // WebSocket
    const wsUrl = baseUrl.replace("http://", "ws://") + "/ws/echo";
    const msgs: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        msgs.push(String(ev.data));
        if (msgs.length === 1) ws.send("ping");
        else if (msgs.length === 2) { ws.close(); resolve(); }
      };
      ws.onerror = reject;
    });
    expect(msgs).toEqual(["ready", "ws:ping"]);
  });
});
