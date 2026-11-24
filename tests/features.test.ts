import { expect, test, describe } from "bun:test";
import { BareJS, Context, Type, Z, typebox, zod, native, bareClient } from "../src/index";

describe("Advanced Features (SSE, OpenAPI, RPC Client, onError)", () => {
  test("ctx.sse() supports AsyncIterable sources", async () => {
    const app = new BareJS();
    async function* streamEvents() {
      yield "first";
      yield { event: "update", id: "2", retry: 3000, data: { count: 2 } };
    }
    app.get("/stream", (ctx: Context) => ctx.sse(streamEvents()));
    app.compile();

    const res = await app.fetch(new Request("http://localhost/stream"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("data: first\n\n");
    expect(body).toContain("id: 2\nevent: update\nretry: 3000\ndata: {\"count\":2}\n\n");
  });

  test("OpenAPI generator extracts Zod, TypeBox, Native schemas and path params", async () => {
    const app = new BareJS();
    app.post("/z/:id", zod(Z.object({ name: Z.string(), age: Z.number().optional() })), () => ({}));
    app.put("/t/:uid", typebox(Type.Object({ active: Type.Boolean() })), () => ({}));
    app.patch("/n", native({ properties: { flag: { type: "boolean" } } }), () => ({}));
    app.docs("/docs", { title: "My API", version: "1.2.3", description: "Fast API" });
    app.compile();

    const res = await app.fetch(new Request("http://localhost/docs/json"));
    const spec = await res.json();
    expect(spec.info).toEqual({ title: "My API", version: "1.2.3", description: "Fast API" });
    expect(spec.paths["/docs"]).toBeUndefined();
    expect(spec.paths["/z/{id}"].post.parameters[0].name).toBe("id");
    expect(spec.paths["/z/{id}"].post.requestBody.content["application/json"].schema.required).toEqual(["name"]);
    expect(spec.paths["/t/{uid}"].put.requestBody.content["application/json"].schema.properties.active.type).toBe("boolean");
    expect(spec.paths["/n"].patch.requestBody.content["application/json"].schema.properties.flag.type).toBe("boolean");
  });

  test("bareClient supports all HTTP methods, text responses, and HTTP error throwing", async () => {
    const app = new BareJS();
    app.get("/hello", () => "plain text");
    app.put("/item/:id", async (ctx: Context) => ({ id: ctx.params.id, body: await ctx.jsonBody() }));
    app.patch("/item/:id", async (ctx: Context) => ({ patched: ctx.params.id }));
    app.delete("/item/:id", (ctx: Context) => ({ deleted: ctx.params.id }));
    app.get("/fail", (ctx: Context) => ctx.status(404).json({ error: "not here" }));
    app.compile();

    const client = bareClient("http://localhost", {
      headers: { "X-Client": "bare" },
      fetch: (input, init) => app.fetch(new Request(input, init))
    });

    expect(await client.get("/hello")).toBe("plain text");
    expect(await client.put("/item/:id", { params: { id: "a/b" }, body: { k: 1 } })).toEqual({
      id: "a%2Fb",
      body: { k: 1 }
    });
    expect(await client.patch("/item/:id", { params: { id: 5 } })).toEqual({ patched: "5" });
    expect(await client.delete("/item/:id", { params: { id: 5 } })).toEqual({ deleted: "5" });

    let caught: any;
    try {
      await client.get("/fail");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.status).toBe(404);
    expect(caught.data).toEqual({ error: "not here" });
  });

  test("onError supports returning Response or string", async () => {
    const app = new BareJS();
    app.onError((err) => {
      if (err.message === "resp") return new Response("custom-resp", { status: 503 });
      return "plain-error";
    });
    app.get("/e1", () => { throw new Error("resp"); });
    app.get("/e2", () => { throw new Error("other"); });
    app.compile();

    const r1 = await app.fetch(new Request("http://localhost/e1"));
    expect(r1.status).toBe(503);
    expect(await r1.text()).toBe("custom-resp");

    const r2 = await app.fetch(new Request("http://localhost/e2"));
    expect(r2.status).toBe(500);
    expect(await r2.text()).toBe("plain-error");
  });

  test("Native WebSocket (app.ws) live connection, echo, and close", async () => {
    const app = new BareJS();
    let opened = false;
    let closed = false;

    app.get("/health", () => ({ ok: true }));
    app.ws("/chat", {
      open(ws) {
        opened = true;
        ws.send("welcome");
      },
      message(ws, msg) {
        ws.send(`echo:${msg}`);
      },
      close() {
        closed = true;
      }
    });

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const port = 18000 + Math.floor(Math.random() * 10000);
    const server = app.listen(port, "127.0.0.1", false);
    await (server as any).ready;
    process.env.NODE_ENV = prevEnv;

    try {
      // HTTP route still works alongside WebSocket
      const httpRes = await fetch(`http://127.0.0.1:${port}/health`);
      expect(await httpRes.json()).toEqual({ ok: true });

      const received: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/chat`);
        ws.onmessage = (ev) => {
          received.push(String(ev.data));
          if (received.length === 1) {
            ws.send("barejs");
          } else if (received.length === 2) {
            ws.close();
            resolve();
          }
        };
        ws.onerror = (err) => reject(err);
      });

      await new Promise((r) => setTimeout(r, 20));
      expect(opened).toBe(true);
      expect(received).toEqual(["welcome", "echo:barejs"]);
      expect(closed).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("JSON-RPC 2.0 (app.rpc) single, batch, notification, and error codes", async () => {
    const app = new BareJS();
    app.rpc("/rpc", {
      add: ({ a, b }: { a: number; b: number }) => a + b,
      fail: () => { throw new Error("boom"); }
    });
    app.compile();

    const rSingle = await app.fetch(new Request("http://localhost/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "add", params: { a: 3, b: 4 }, id: 1 })
    }));
    expect(await rSingle.json()).toEqual({ jsonrpc: "2.0", result: 7, id: 1 });

    const rNotFound = await app.fetch(new Request("http://localhost/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "missing", id: 2 })
    }));
    expect(await rNotFound.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32601, message: "Method not found" },
      id: 2
    });

    const rBatch = await app.fetch(new Request("http://localhost/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { jsonrpc: "2.0", method: "add", params: { a: 1, b: 2 }, id: 10 },
        { jsonrpc: "2.0", method: "add", params: { a: 5, b: 5 } }, // notification (no id)
        { jsonrpc: "2.0", method: "fail", id: 11 }
      ])
    }));
    expect(await rBatch.json()).toEqual([
      { jsonrpc: "2.0", result: 3, id: 10 },
      { jsonrpc: "2.0", error: { code: -32603, message: "boom" }, id: 11 }
    ]);
  });
});
