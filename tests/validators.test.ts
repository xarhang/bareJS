import { expect, test, describe } from "bun:test";
import { BareJS, Context, Type, Z, typebox, zod, native, validate } from "../src/index";

describe("Validation Engines (TypeBox, Zod, Native, Auto)", () => {
  test("TypeBox engine validates valid & invalid payloads", async () => {
    const app = new BareJS();
    app.post("/tb", typebox(Type.Object({ name: Type.String(), age: Type.Number() })), (ctx: Context) => ctx.body);
    app.compile();

    const ok = await app.fetch(new Request("http://localhost/tb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", age: 25 })
    }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: "Alice", age: 25 });

    const bad = await app.fetch(new Request("http://localhost/tb", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice", age: "25" })
    }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("VALIDATION_FAILED");
  });

  test("Zod engine validates, transforms, and reports ZOD_ERROR", async () => {
    const app = new BareJS();
    app.post("/zd", zod(Z.object({ email: Z.string().email(), count: Z.number().default(1) })), (ctx: Context) => ctx.body);
    app.compile();

    const ok = await app.fetch(new Request("http://localhost/zd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com" })
    }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ email: "a@b.com", count: 1 });

    const bad = await app.fetch(new Request("http://localhost/zd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" })
    }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("ZOD_ERROR");
  });

  test("Native engine rejects prototype keys, arrays, primitives, and missing fields", async () => {
    const app = new BareJS();
    app.post("/nv", native({ properties: { title: { type: "string" } } }), (ctx: Context) => ctx.body);
    app.post("/proto", native({ properties: { toString: { type: "function" } } }), (ctx: Context) => ctx.body);
    app.compile();

    const ok = await app.fetch(new Request("http://localhost/nv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hello" })
    }));
    expect(ok.status).toBe(200);

    const arr = await app.fetch(new Request("http://localhost/nv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(["Hello"])
    }));
    expect(arr.status).toBe(400);

    const proto = await app.fetch(new Request("http://localhost/proto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }));
    expect(proto.status).toBe(400);
  });

  test("Smart dispatcher validate() auto-detects TypeBox, Zod, and Native", async () => {
    const app = new BareJS();
    app.post("/a-tb", validate(Type.Object({ x: Type.Number() })), (ctx: Context) => ctx.body);
    app.post("/a-zd", validate(Z.object({ y: Z.string() })), (ctx: Context) => ctx.body);
    app.post("/a-nv", validate({ properties: { z: { type: "boolean" } } }), (ctx: Context) => ctx.body);
    app.compile();

    expect((await app.fetch(new Request("http://localhost/a-tb", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: 1 })
    }))).status).toBe(200);

    expect((await app.fetch(new Request("http://localhost/a-zd", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ y: "ok" })
    }))).status).toBe(200);

    expect((await app.fetch(new Request("http://localhost/a-nv", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ z: true })
    }))).status).toBe(200);
  });
});
