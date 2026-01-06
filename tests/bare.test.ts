// All comments in English
import { expect, test, describe, beforeEach } from "bun:test";
import { BareJS, Context } from "../src/bare";

describe("BareJS Nano-Core Integrity Tests", () => {
  let app: BareJS;

  beforeEach(() => {
    app = new BareJS(); // สร้าง instance ใหม่ทุกครั้งเพื่อให้สะอาด
  });

  test("Static Routing & JSON Response", async () => {
    app.get("/hello", () => ({ message: "world" }));
    app.compile();

    const res = await app.fetch(new Request("http://localhost/hello"));
    const body = await res.json();
    expect(body.message).toBe("world");
  });

  test("Context Store Isolation (Pool Safety)", async () => {
    app.get("/set", (ctx: Context) => {
      ctx.set("secret", "hidden-data");
      return { ok: true };
    });
    app.get("/check", (ctx: Context) => ({ data: ctx.get("secret") }));
    app.compile();

    await app.fetch(new Request("http://localhost/set"));
    const res = await app.fetch(new Request("http://localhost/check"));
    const body = await res.json();
    
    // ต้องเป็น undefined เพราะแต่ละ Request ต้องแยกกัน
    expect(body.data).toBeUndefined(); 
  });

  test("Dynamic Parameters Accuracy", async () => {
    app.get("/user/:id", (ctx: Context) => {
      // ✅ เช็คให้มั่นใจว่าดึง params.id ออกมาได้จริง
      return { userId: ctx.params?.id || "not-found" };
    });
    app.compile();

    const res = await app.fetch(new Request("http://localhost/user/123"));
    const body = await res.json();
    expect(body.userId).toBe("123");
  });

  test("Middleware Chain Execution", async () => {
    let trace = "";
    // ✅ สำคัญ: ต้องใช้ middleware ก่อนประกาศ route เสมอ
    app.use((req: Request, params: any, next: () => any) => {
      trace += "1";
      return next();
    });

    app.get("/trace", () => {
      trace += "2";
      return { ok: true };
    });
    
    app.compile();

    await app.fetch(new Request("http://localhost/trace"));
    expect(trace).toBe("12");
  });
});