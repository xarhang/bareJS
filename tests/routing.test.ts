import { expect, test, describe } from "bun:test";
import { BareJS, Context } from "../src/index";

describe("Routing, HTTP Methods & Context", () => {
  test("Supports GET, POST, PUT, PATCH, DELETE on same path", async () => {
    const app = new BareJS();
    app.get("/res", () => ({ m: "GET" }));
    app.post("/res", () => ({ m: "POST" }));
    app.put("/res", () => ({ m: "PUT" }));
    app.patch("/res", () => ({ m: "PATCH" }));
    app.delete("/res", () => ({ m: "DELETE" }));
    app.compile();

    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const res = await app.fetch(new Request("http://localhost/res", { method }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ m: method });
    }
  });

  test("Handles root path and multiple same-length static routes without switch collision", async () => {
    const app = new BareJS();
    app.get("/", () => "root");
    app.get("/users", () => "users");
    app.get("/posts", () => "posts");
    app.get("/items", () => "items");
    app.get("/a", () => "a");
    app.get("/b", () => "b");
    app.compile();

    expect(await (await app.fetch(new Request("http://localhost/"))).text()).toBe("root");
    expect(await (await app.fetch(new Request("http://localhost/users"))).text()).toBe("users");
    expect(await (await app.fetch(new Request("http://localhost/posts"))).text()).toBe("posts");
    expect(await (await app.fetch(new Request("http://localhost/items"))).text()).toBe("items");
    expect(await (await app.fetch(new Request("http://localhost/a"))).text()).toBe("a");
    expect(await (await app.fetch(new Request("http://localhost/b"))).text()).toBe("b");
  });

  test("Deep multi-param route extraction", async () => {
    const app = new BareJS();
    app.get("/org/:orgId/repo/:repoId/issue/:issueId", (ctx: Context) => ctx.params);
    app.compile();

    const res = await app.fetch(new Request("http://localhost/org/acme/repo/barejs/issue/42"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "acme", repoId: "barejs", issueId: "42" });
  });

  test("Custom setNotFound and default 404", async () => {
    const app1 = new BareJS();
    app1.get("/ok", () => "ok");
    app1.compile();
    const r1 = await app1.fetch(new Request("http://localhost/missing"));
    expect(r1.status).toBe(404);
    expect((await r1.json()).message).toBe("Route not found");

    const app2 = new BareJS();
    app2.setNotFound(() => ({ status: 404, message: "Custom 404" }));
    app2.compile();
    const r2 = await app2.fetch(new Request("http://localhost/nope"));
    expect(r2.status).toBe(404);
    expect(await r2.json()).toEqual({ status: 404, message: "Custom 404" });
  });

  test("Context status, send, setHeader, and null/string/Response returns", async () => {
    const app = new BareJS();
    app.get("/created", (ctx: Context) => ctx.status(201).setHeader("X-Custom", "1").send("created", { id: 7 }));
    app.get("/err-send", (ctx: Context) => ctx.status(400).send("bad input"));
    app.get("/str-hdr", (ctx: Context) => {
      ctx.setHeader("X-Str", "yes");
      return "hello";
    });
    app.get("/null-res", () => null);
    app.get("/raw-res", () => new Response("raw", { status: 202, headers: { "x-raw": "true" } }));
    app.compile();

    const rCreated = await app.fetch(new Request("http://localhost/created"));
    expect(rCreated.status).toBe(201);
    expect(rCreated.headers.get("x-custom")).toBe("1");
    expect(await rCreated.json()).toEqual({ status: "success", msg: "created", id: 7 });

    const rErr = await app.fetch(new Request("http://localhost/err-send"));
    expect(rErr.status).toBe(400);
    expect(await rErr.json()).toEqual({ status: "error", msg: "bad input" });

    const rStr = await app.fetch(new Request("http://localhost/str-hdr"));
    expect(rStr.status).toBe(200);
    expect(rStr.headers.get("x-str")).toBe("yes");
    expect(await rStr.text()).toBe("hello");

    const rNull = await app.fetch(new Request("http://localhost/null-res"));
    expect(rNull.status).toBe(200);
    expect(await rNull.json()).toBeNull();

    const rRaw = await app.fetch(new Request("http://localhost/raw-res"));
    expect(rRaw.status).toBe(202);
    expect(rRaw.headers.get("x-raw")).toBe("true");
    expect(await rRaw.text()).toBe("raw");
  });

  test("Query parser handles flags, prototype keys, and malformed encoding safely", async () => {
    const app = new BareJS();
    app.get("/q", (ctx: Context) => ({
      flag: ctx.getQuery("flag"),
      missing: ctx.getQuery("missing"),
      bad: ctx.getQuery("bad"),
      hasProto: Object.prototype.hasOwnProperty.call(ctx.query, "__proto__")
    }));
    app.compile();

    const res = await app.fetch(new Request("http://localhost/q?flag&__proto__=polluted&constructor=x&bad=%E0%A4%A"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.flag).toBe("");
    expect(data.missing).toBeUndefined();
    expect(data.bad).toBe("%E0%A4%A");
    expect(data.hasProto).toBe(false);
  });

  test("Context.jsonBody caches parsed JSON and handles non-JSON / invalid JSON", async () => {
    const app = new BareJS();
    app.post("/json", async (ctx: Context) => {
      const b1 = await ctx.jsonBody();
      const b2 = await ctx.jsonBody();
      return { same: b1 === b2, b1 };
    });
    app.compile();

    const rValid = await app.fetch(new Request("http://localhost/json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ a: 1 })
    }));
    expect(await rValid.json()).toEqual({ same: true, b1: { a: 1 } });

    const rBad = await app.fetch(new Request("http://localhost/json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad"
    }));
    expect(await rBad.json()).toEqual({ same: true, b1: null });

    const rText = await app.fetch(new Request("http://localhost/json", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello"
    }));
    expect(await rText.json()).toEqual({ same: true, b1: null });
  });

  test("Pool exhaustion & isolation under 200 concurrent async requests (poolSize=2)", async () => {
    const app = new BareJS(2);
    app.get("/stress/:id", async (ctx: Context) => {
      ctx.set("id", ctx.params.id);
      await new Promise((r) => setTimeout(r, (Number(ctx.params.id) % 5) + 1));
      return { id: ctx.get("id"), param: ctx.params.id, q: ctx.getQuery("n") };
    });
    app.compile();

    const results = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        app.fetch(new Request(`http://localhost/stress/${i}?n=${i}`)).then((r: Response) => r.json())
      )
    );

    for (let i = 0; i < 200; i++) {
      expect(results[i]).toEqual({ id: String(i), param: String(i), q: String(i) });
    }
  });
});
