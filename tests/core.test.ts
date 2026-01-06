// All comments in English
import { expect, test, describe, beforeEach } from "bun:test";
import { BareJS, Context, typebox } from "../src/bare";
import * as TB from "@sinclair/typebox";

describe("BareJS Unified Test Suite", () => {
  let app: BareJS;

  beforeEach(() => {
    app = new BareJS();
  });

  // --- Integrity Group ---
  describe("Engine Integrity", () => {
    test("Context Store Isolation (Pool Safety)", async () => {
      app.get("/set", (ctx: Context) => {
        ctx.set("user", "admin");
        return { ok: true };
      });
      app.get("/check", (ctx: Context) => ({ user: ctx.get("user") }));
      app.compile();

      await app.fetch(new Request("http://localhost/set"));
      const res = await app.fetch(new Request("http://localhost/check"));
      const body = await res.json();
      expect(body.user).toBeUndefined(); // Verifies reset() works
    });

    test("Middleware Chain Trace", async () => {
      let trace = "";
      app.use((ctx, next) => { trace += "1"; return next(); });
      app.get("/trace", () => { trace += "2"; return { ok: true }; });
      app.compile();

      await app.fetch(new Request("http://localhost/trace"));
      expect(trace).toBe("12");
    });
  });

  // --- Logic Group ---
  describe("Logic & Features", () => {
    test("TypeBox Validation & ctx.body", async () => {
      const Schema = TB.Type.Object({ id: TB.Type.Number() });
      app.post("/data", typebox(Schema), (ctx: Context) => ctx.status(201).json(ctx.body));
      app.compile();

      const res = await app.fetch(new Request("http://localhost/data", {
        method: "POST",
        body: JSON.stringify({ id: 571 }),
        headers: { "Content-Type": "application/json" }
      }));
      
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.id).toBe(571);
    });

    test("Dynamic Params Accuracy", async () => {
      app.get("/user/:id", (ctx: Context) => ({ userId: ctx.params.id }));
      app.compile();

      const res = await app.fetch(new Request("http://localhost/user/99"));
      const body = await res.json();
      expect(body.userId).toBe("99");
    });
  });
});