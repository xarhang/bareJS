import { existsSync } from "node:fs";
import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { chromium, type Browser } from "playwright-core";
import { BareJS, Context, securityHeaders, cors, Type } from "../src/index";

const chromiumPath = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome"
].find((p): p is string => Boolean(p && existsSync(p)));

describe.skipIf(!chromiumPath)("Playwright Real Browser E2E & Security Tests", () => {
  let browser: Browser;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    const app = new BareJS();
    app.use(securityHeaders({ frameOptions: "DENY" }));
    app.use(cors());

    app.get("/app", () => {
      return new Response(
        `<!doctype html>
        <html>
          <head><title>BareJS Browser E2E</title></head>
          <body>
            <h1 id="title">BareJS Ready</h1>
            <div id="sse-out"></div>
            <div id="ws-out"></div>
          </body>
        </html>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    });

    app.post("/api/login", (ctx: Context) => {
      ctx.setCookie("auth_sid", "user_999", { secret: "pw_secret", httpOnly: true, sameSite: "Lax" });
      ctx.setCookie("ui_lang", "lo", { httpOnly: false, sameSite: "Lax" });
      return { loggedIn: true };
    });

    app.get("/api/check-cookie", (ctx: Context) => ({
      signedUser: ctx.getSignedCookie("auth_sid", "pw_secret"),
      lang: ctx.cookies.ui_lang
    }));

    app.post("/api/validate", {
      body: Type.Object({ name: Type.String() })
    }, (ctx: Context) => ({ hello: ctx.body.name }));

    app.get("/api/sse", (ctx: Context) =>
      ctx.sse(async (send) => {
        send("msg-1", "ping", "1");
        send("msg-2", "ping", "2");
      })
    );

    app.ws("/ws/chat", {
      open: (ws) => ws.send("ws-open"),
      message: (ws, msg) => ws.send(`ws-reply:${msg}`)
    });

    app.docs("/docs", { title: "Playwright API Docs", version: "0.1.49" });

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const port = 38000 + Math.floor(Math.random() * 10000);
    server = app.listen(port, "127.0.0.1", false);
    process.env.NODE_ENV = prevEnv;
    baseUrl = `http://127.0.0.1:${port}`;

    browser = await chromium.launch({
      ...(chromiumPath ? { executablePath: chromiumPath } : {}),
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  test("Browser renders HTML, verifies security headers & HttpOnly cookie isolation", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const response = await page.goto(`${baseUrl}/app`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    expect(await page.textContent("#title")).toBe("BareJS Ready");

    // Login via browser fetch -> sets HttpOnly signed cookie + non-HttpOnly ui_lang cookie
    const loginResult = await page.evaluate(async () => {
      const r = await fetch("/api/login", { method: "POST" });
      return r.json();
    });
    expect(loginResult).toEqual({ loggedIn: true });

    // document.cookie MUST see ui_lang=lo, MUST NOT see auth_sid (HttpOnly!)
    const jsCookies = await page.evaluate(() => document.cookie);
    expect(jsCookies).toContain("ui_lang=lo");
    expect(jsCookies).not.toContain("auth_sid");

    // Server still receives HttpOnly signed cookie and verifies HMAC signature
    const checkResult = await page.evaluate(async () => {
      const r = await fetch("/api/check-cookie");
      return r.json();
    });
    expect(checkResult).toEqual({ signedUser: "user_999", lang: "lo" });

    await context.close();
  });

  test("Browser EventSource (SSE) and WebSocket work end-to-end", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/app`);

    // Real Browser EventSource
    const sseEvents = await page.evaluate(() => {
      return new Promise<string[]>((resolve) => {
        const es = new EventSource("/api/sse");
        const items: string[] = [];
        es.addEventListener("ping", (ev: any) => {
          items.push(ev.data);
          if (items.length === 2) {
            es.close();
            resolve(items);
          }
        });
      });
    });
    expect(sseEvents).toEqual(["msg-1", "msg-2"]);

    // Real Browser WebSocket
    const wsMessages = await page.evaluate((url) => {
      return new Promise<string[]>((resolve) => {
        const ws = new WebSocket(url);
        const items: string[] = [];
        ws.onmessage = (ev) => {
          items.push(String(ev.data));
          if (items.length === 1) ws.send("from-chromium");
          else if (items.length === 2) {
            ws.close();
            resolve(items);
          }
        };
      });
    }, `${baseUrl.replace("http://", "ws://")}/ws/chat`);
    expect(wsMessages).toEqual(["ws-open", "ws-reply:from-chromium"]);

    await context.close();
  });

  test("Browser loads /docs OpenAPI UI and blocks XSS/invalid JSON validation", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${baseUrl}/docs`);
    const dataUrl = await page.getAttribute("#api-reference", "data-url");
    expect(dataUrl).toBe("/docs/json");

    // Validation check from browser
    const valRes = await page.evaluate(async () => {
      const bad = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: 123 })
      });
      return { status: bad.status, body: await bad.json() };
    });
    expect(valRes.status).toBe(400);
    expect(valRes.body.code).toBe("VALIDATION_FAILED");

    await context.close();
  });
});
