// All comments in English
import { expect, test, describe, beforeEach } from "bun:test";
import { BareJS, Context, typebox } from "../src/bare";
import * as TB from "@sinclair/typebox";

describe("BareJS Ultra-Accuracy Suite", () => {
  let app: BareJS;

  beforeEach(() => {
    app = new BareJS();
  });

  describe("Engine Precision", () => {
    test("Strict Header & Status Injection", async () => {
      app.get("/hex", (ctx: Context) => {
        return ctx.status(201).set("X-Framework", "BareJS").json({ hex: "0xFF" });
      });
      app.compile();

      const res = await app.fetch(new Request("http://localhost/hex"));
      
      // Accuracy Check: Status, Custom Headers, and Native Bun Content-Type
      expect(res.status).toBe(201);
      expect(res.headers.get("X-Framework")).toBe("BareJS");
      expect(res.headers.get("Content-Type")).toContain("application/json");
      
      const body = await res.json();
      expect(body.hex).toBe("0xFF");
    });

    test("Method Mismatch Isolation (404/405 Logic)", async () => {
      app.get("/only-get", () => "ok");
      app.compile();

      // Accuracy Check: Ensure POSTing to a GET route doesn't leak data
      const res = await app.fetch(new Request("http://localhost/only-get", { method: "POST" }));
      expect(res.status).toBe(404); 
    });
  });

  describe("Validation Edge Cases", () => {
    test("TypeBox Rejection Accuracy", async () => {
      const Schema = TB.Type.Object({ age: TB.Type.Number() });
      app.post("/age", typebox(Schema), () => "valid");
      app.compile();

      // Accuracy Check: Sending string instead of number should trigger validation failure
      const res = await app.fetch(new Request("http://localhost/age", {
        method: "POST",
        body: JSON.stringify({ age: "twenty" }), // Invalid type
        headers: { "Content-Type": "application/json" }
      }));

      // If your typebox middleware returns a specific error status
      expect(res.status).toBeGreaterThanOrEqual(400);
    });

    test("Complex Dynamic Routing Precision", async () => {
      // Testing overlapping routes: /u/:id vs /u/settings
      app.get("/u/settings", () => "settings");
      app.get("/u/:id", (ctx:Context) => ctx.params.id);
      app.compile();

      const res1 = await app.fetch(new Request("http://localhost/u/settings"));
      expect(await res1.text()).toBe("settings");

      const res2 = await app.fetch(new Request("http://localhost/u/123"));
      expect(await res2.text()).toBe("123");
    });
  });
});