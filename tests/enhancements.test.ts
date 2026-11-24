import { describe, expect, test } from "bun:test";
import {
  BareJS,
  BareRouter,
  Type,
  bareClient,
  logger,
  healthcheck,
  generateOpenAPISpec,
  type LogEntry
} from "../src/index";

describe("BareJS Enhancements & Fixes", () => {
  test("1. bareClient supports shared path across GET & POST with query/headers inference", async () => {
    const app = new BareJS()
      .get(
        "/items",
        {
          query: Type.Object({ search: Type.Optional(Type.String()) }),
          headers: Type.Object({ "x-api-key": Type.String() }),
          response: Type.Object({ items: Type.Array(Type.String()), q: Type.Optional(Type.String()) })
        },
        (ctx) => ({ items: ["a", "b"], q: ctx.query.search })
      )
      .post(
        "/items",
        {
          body: Type.Object({ name: Type.String() }),
          response: Type.Object({ created: Type.String() })
        },
        (ctx) => ({ created: ctx.body.name })
      );

    app.compile();
    const client = bareClient(app);

    const list = await client.get("/items", {
      query: { search: "book" },
      headers: { "x-api-key": "secret" }
    });
    expect(list).toEqual({ items: ["a", "b"], q: "book" });

    const created = await client.post("/items", {
      body: { name: "notebook" }
    });
    expect(created).toEqual({ created: "notebook" });
  });

  test("2. BareRouter mounted via app.use() propagates route types and works at runtime", async () => {
    const sub = new BareRouter("/api").get("/ping", () => ({ pong: true }));
    const app = new BareJS().use(sub);
    app.compile();

    const res = await app.fetch(new Request("http://localhost/api/ping"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: true });
  });

  test("3. app.head() and app.all() handle multiple HTTP methods", async () => {
    const app = new BareJS()
      .head("/status", (ctx) => {
        ctx.setHeader("x-alive", "1");
        return "";
      })
      .all("/echo", (ctx) => ({ method: ctx.req.method }));

    app.compile();

    const headRes = await app.fetch(new Request("http://localhost/status", { method: "HEAD" }));
    expect(headRes.status).toBe(200);
    expect(headRes.headers.get("x-alive")).toBe("1");

    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const r = await app.fetch(new Request("http://localhost/echo", { method }));
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ method });
    }
  });

  test("4. logger() middleware attaches X-Request-Id, supports skip and onLog", async () => {
    const logs: LogEntry[] = [];
    const app = new BareJS()
      .use(
        logger({
          skip: (_ctx, path) => path === "/quiet",
          onLog: (entry) => logs.push(entry)
        })
      )
      .get("/hello", (ctx) => ({ id: ctx.requestId }))
      .get("/quiet", () => "shh");

    app.compile();

    const res1 = await app.fetch(new Request("http://localhost/hello"));
    const body1 = (await res1.json()) as { id: string };
    expect(body1.id).toBeTruthy();
    expect(res1.headers.get("x-request-id")).toBe(body1.id);
    expect(logs.length).toBe(1);
    expect(logs[0]!.method).toBe("GET");
    expect(logs[0]!.path).toBe("/hello");

    const res2 = await app.fetch(
      new Request("http://localhost/hello", { headers: { "x-request-id": "custom-123" } })
    );
    expect(res2.headers.get("x-request-id")).toBe("custom-123");
    expect(logs.length).toBe(2);

    await app.fetch(new Request("http://localhost/quiet"));
    expect(logs.length).toBe(2);
  });

  test("5. healthcheck() plugin returns 200 when healthy and 503 when a check fails", async () => {
    let dbOk = true;
    const app = new BareJS().use(
      healthcheck({
        path: "/health",
        readyPath: "/ready",
        version: "1.2.3",
        checks: {
          db: () => dbOk,
          cache: async () => true
        }
      })
    );
    app.compile();

    const okRes = await app.fetch(new Request("http://localhost/health"));
    expect(okRes.status).toBe(200);
    const okJson = (await okRes.json()) as any;
    expect(okJson.status).toBe("ok");
    expect(okJson.version).toBe("1.2.3");
    expect(okJson.checks).toEqual({ db: "ok", cache: "ok" });

    dbOk = false;
    const failRes = await app.fetch(new Request("http://localhost/ready"));
    expect(failRes.status).toBe(503);
    const failJson = (await failRes.json()) as any;
    expect(failJson.status).toBe("degraded");
    expect(failJson.checks).toEqual({ db: "fail", cache: "ok" });
  });

  test("6. generateOpenAPISpec supports servers, tags, securitySchemes, and security", () => {
    const app = new BareJS().get("/users", () => []);
    const spec = generateOpenAPISpec(app.routes, {
      title: "Test API",
      version: "2.0.0",
      servers: [{ url: "https://api.example.com", description: "Production" }],
      tags: [{ name: "Users", description: "User operations" }],
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
      },
      security: [{ bearerAuth: [] }]
    });

    expect(spec.servers).toEqual([{ url: "https://api.example.com", description: "Production" }]);
    expect(spec.tags).toEqual([{ name: "Users", description: "User operations" }]);
    expect(spec.components?.securitySchemes?.bearerAuth?.scheme).toBe("bearer");
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });

  test("7. WebSocket supports case-insensitive Upgrade header and parameterized /ws/:room", async () => {
    const app = new BareJS();
    let joinedRoom = "";

    app.ws("/ws/:room", {
      open(ws) {
        joinedRoom = ws.data?.params?.room || "";
        ws.send(`joined:${joinedRoom}`);
      },
      message(ws, msg) {
        ws.send(`echo:${msg}`);
      }
    });

    const server = app.listen(0);
    await (server as any).ready;
    try {
      const ws = new WebSocket(`ws://localhost:${server.port}/ws/lounge`);
      const messages: string[] = [];

      await new Promise<void>((resolve, reject) => {
        ws.onmessage = (ev) => {
          messages.push(String(ev.data));
          if (messages.length === 1) {
            ws.send("hello");
          } else if (messages.length === 2) {
            ws.close();
            resolve();
          }
        };
        ws.onerror = (err) => reject(err);
      });

      expect(joinedRoom).toBe("lounge");
      expect(messages).toEqual(["joined:lounge", "echo:hello"]);
    } finally {
      await app.stop(true);
    }
  });
});
