<div align="center">
<br />
<h1>Bare<span style="color: #F7DF1E;">JS</span></h1>
<p><strong>The "Metal" of Web Frameworks</strong></p>
<p><i>An ultra-high-performance JIT-compiled web engine built for Bun, architected strictly for Mechanical Sympathy, Zero-Trust Security, and Effortless Developer Experience.</i></p>

<p>
<a href="https://www.npmjs.com/package/barejs">
<img src="https://img.shields.io/npm/v/barejs?style=for-the-badge&logo=npm&color=CB3837" alt="NPM Version">
</a>
<a href="https://github.com/xarhang/barejs/actions/workflows/bench.yml">
<img src="https://img.shields.io/github/actions/workflow/status/xarhang/barejs/bench.yml?branch=main&label=Performance&style=for-the-badge&logo=github" alt="Performance">
</a>
<a href="https://bun.sh">
<img src="https://img.shields.io/badge/Bun-%3E%3D1.1.0-black?style=for-the-badge&logo=bun" alt="Bun Version">
</a>
<a href="https://github.com/xarhang/barejs/blob/main/LICENSE">
<img src="https://img.shields.io/github/license/xarhang/barejs?style=for-the-badge&color=blue" alt="License">
</a>
</p>
</div>

---

## 📊 Benchmarks: Multi-Scenario & Real-World Performance

BareJS is engineered to beat both **ElysiaJS** and **Hono** across routing, middleware pipelines, schema validation, recursive response secret stripping, and real SQLite database workloads—while matching raw **Bun Native (`Bun.serve`)** HTTP throughput.

| Scenario (`benchmarks/fair-suite.ts` & `production-bench.ts`) | **BareJS** 🏆 | **Bun Native** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`1.85 µs`** (`792 ns` min) | `2.86 µs` | `2.31 µs` | `4.77 µs` |
| **2. 10 Middlewares + Deep Path** | **`1.82 µs`** (`970 B` RAM) | `2.54 µs` | `2.71 µs` (`1.14 KB`) | `5.34 µs` (`1.81 KB`) |
| **3. POST JSON + Schema Validation** | **`5.00 µs`** (`2.26 KB`) | `5.04 µs` | `5.45 µs` (`2.24 KB`) | `5.51 µs` (`3.53 KB`) |
| **4. Async Handler + Query Parsing** | **`2.83 µs`** (`1.22 KB` RAM) | `2.99 µs` | `2.92 µs` (`1.58 KB`) | `4.19 µs` (`1.80 KB`) |
| **5. Live HTTP Server (`Bun.serve` + `fetch`)** | **`45.33 µs`** (`p99: 94 µs`) | `46.63 µs` (`p99: 126 µs`) | `49.31 µs` (`p99: 145 µs`) | `68.54 µs` (`p99: 162 µs`) |
| **6. Response Schema Secret Stripping** | **`2.01 µs`** (`653 B` RAM) | — | `2.40 µs` (`893 B` RAM) | — |
| **7. Live SQLite Report (`SUM`/`AVG`/`GROUP BY`)** | **`91.53 µs`** (`p99: 218 µs`) | — | `94.51 µs` (`p99: 277 µs`) | `103.66 µs` (`p99: 543 µs`) |
| **8. Live SQLite Write (`POST` + Validate + `INSERT`)** | **`88.37 µs`** (`2.84 KB`) | — | `88.51 µs` (`2.95 KB`) | `103.73 µs` (`3.33 KB`) |

> Verified with **209 Automated Tests (2,878 assertions)** and **100.00% Function & 100.00% Line Coverage**.

<!-- MARKER: PERFORMANCE_TABLE_START -->

| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **1.85 µs** | **Baseline** |
| Elysia | 2.31 µs | 1.25x slower |
| Hono | 4.77 µs | 2.58x slower |

<!-- MARKER: PERFORMANCE_TABLE_END -->

> [!TIP]
> **Using AI Coding Assistants (Cursor, Copilot, Claude, Windsurf)?** Point them to [`llms.txt`](./llms.txt) for a complete, token-efficient reference of every BareJS API.

---

## 🚀 Key Features

* **JIT Pipeline Compilation**: Flattens routes and middleware chains into direct JavaScript functions at startup, using `AsyncFunction` single-handler fast paths and conditional bytecode inlining.
* **$O(1)$ Radix Jump-Table Router**: Compiles static branches, dynamic `:params`, and catch-all wildcards (`/*`) into inline `switch` jump-tables.
* **Recursive JIT Response Projector (`compileProjector`)**: Compiles `response` schemas (**TypeBox**, **Zod**, or **Native**) into fixed-shape JS object literals that strip undeclared secret fields (`passwordHash`, `secretToken`) recursively at **`2.01 µs` (`653 B` RAM)**—19.4% faster and 27% lower memory than ElysiaJS.
* **Built-In Payment Idempotency & Singleflight Coalescing**: Prevent double-charges and race conditions with `idempotency()` (`409 IDEMPOTENT_IN_FLIGHT` + `X-Idempotent-Replayed: true`), and eliminate cache-stampede / thundering-herd DB overload with `createSingleflight()`.
* **Concurrency-Safe Object Pooling**: Recycles `Context` instances via a LIFO free-list stack with automatic cleanup on release—zero cross-request state leakage.
* **Dual Response Ergonomics**: Return plain objects/strings directly (Elysia style) OR use chainable `ctx.json()`, `ctx.html()`, `ctx.text()`, `ctx.redirect()`, `ctx.send()` helpers (Hono/Express style).
* **Unified Schema Validation & Auto-Coercion**: Validate `body`, `query`, `params`, `headers`, `response`, and `maxBodySize` (`413` DoS guard) in one object with **TypeBox**, **Zod**, or **Native JSON Schema**—with automatic `number`/`boolean` coercion on `query` and `params`.
* **Batteries-Included Security Suite**: Built-in `securityHeaders()` (frozen zero-alloc), `cors()` (allowlist/predicate/credentials), `csrf()` (`Sec-Fetch-Site` + `Origin`/`Referer` + double-submit token), `timeout()` (`408`), `rateLimit()` (bounded LRU), `bareAuth()` (constant-time HS256 JWT), `Hash` (Argon2id), HMAC-signed `HttpOnly` cookies, and safe `ctx.upload()`.
* **Real-Time, RPC, OpenAPI 3.1 & Zero-Network Client**: Native WebSocket (`app.ws`), Server-Sent Events (`ctx.sse`), JSON-RPC 2.0 (`app.rpc`), Scalar OpenAPI 3.1 UI (`app.docs`), and `bareClient(app | url)` (supports both in-memory zero-port execution and network HTTP).

---

## 🛠️ Installation & Quick Start

```bash
bun add barejs
```

```typescript
import { BareJS, Type, type Context } from 'barejs';

const app = new BareJS();

// 1. Direct return (Elysia style)
app.get('/', () => ({ hello: 'world' }));
app.get('/ping', () => 'pong');

// 2. Context helpers (Hono / Express style)
app.get('/welcome', (ctx: Context) => ctx.html('<h1>ສະບາຍດີ BareJS</h1>'));
app.get('/old', (ctx: Context) => ctx.redirect('/', 301));

// 3. Wildcard catch-all route
app.get('/assets/*', (ctx: Context) => ({ path: ctx.params['*'] }));

app.listen(3000);
```

---

## 📘 Comprehensive Guide

### 1. ✅ Unified Route Validation & Auto-Coercion (`body`, `query`, `params`, `headers`)

Pass a schema object directly before your handler. BareJS automatically coerces numeric and boolean strings in `params` and `query`, enforces `maxBodySize` (`413 Payload Too Large`), and registers the route in OpenAPI `/docs`.

```typescript
import { BareJS, Type, Z, native, type Context } from 'barejs';

const app = new BareJS();

// Declarative RouteSchemas (works with TypeBox, Zod, or Native JSON Schema)
app.post('/orders/:orderId', {
  detail: { summary: 'Create Order', tags: ['Orders'] },
  params: Type.Object({ orderId: Type.Integer() }),        // "42" -> 42
  query:  Type.Object({ notify: Type.Optional(Type.Boolean()) }), // "true" -> true
  headers: Type.Object({ 'x-api-version': Type.Optional(Type.String()) }),
  body: Type.Object({
    item: Type.String({ minLength: 1 }),
    qty: Type.Integer({ minimum: 1 })
  }),
  // Response schema automatically strips undeclared secret fields (e.g. internal_cost)!
  response: Type.Object({
    orderId: Type.Number(),
    notify: Type.Optional(Type.Boolean()),
    body: Type.Object({ item: Type.String(), qty: Type.Number() })
  }),
  maxBodySize: 512 * 1024 // 512 KB limit (returns 413 if exceeded)
}, (ctx: Context) => ({
  orderId: ctx.params.orderId, // number
  notify: ctx.query.notify,    // boolean | undefined
  body: ctx.body,              // validated body
  internal_cost: 9999          // automatically stripped before sending to client!
}));

// Standalone middleware validators are also supported:
app.post('/zod', Z.object({ email: Z.string().email() }), (ctx) => ctx.body);
app.post('/native', native({
  properties: { title: { type: 'string' }, priority: { type: 'number' } },
  required: ['title'] // 'priority' is optional
}), (ctx) => ctx.body);
```

---

### 2. 🍪 Cookies, HMAC Signed Cookies & Safe File Uploads

```typescript
// HMAC-SHA256 Signed Cookies (HttpOnly & SameSite=Lax by default)
app.post('/session', async (ctx) => {
  await ctx.setCookie('session_id', 'user_42', {
    secret: process.env.COOKIE_SECRET!,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 3600
  });
  return { loggedIn: true };
});

app.get('/session', async (ctx) => {
  const userId = await ctx.getSignedCookie('session_id', process.env.COOKIE_SECRET!);
  if (!userId) return ctx.status(401).json({ error: 'Invalid or tampered cookie' });
  return { userId };
});

// Safe Multipart File Upload (enforces size, file count, MIME allowlist & filename sanitization)
app.post('/upload', async (ctx) => {
  const { fields, files } = await ctx.upload({
    maxFileSize: 5 * 1024 * 1024, // 5 MB -> 413 if exceeded
    maxFiles: 3,                  // -> 413 if exceeded
    allowedTypes: ['image/png', 'image/jpeg', 'application/pdf'] // -> 415 if unsupported
  });
  return {
    fields,
    uploaded: files.map((f) => ({ safeName: f.safeName, size: f.size, type: f.type }))
  };
});
```

---

### 3. 🛡️ Production Security Suite, Idempotency & Singleflight

```typescript
import {
  BareJS, securityHeaders, cors, csrf, timeout, rateLimit,
  idempotency, createSingleflight,
  bareAuth, createToken, basicAuth, hasRole, Hash, staticFile
} from 'barejs';

const app = new BareJS();
const SECRET = process.env.JWT_SECRET || 'super-secret-key';

app.use(securityHeaders());
app.use(cors({ origin: ['https://app.example.com'], credentials: true }));
app.use(csrf({ allowedOrigins: ['https://app.example.com'] }));
app.use(timeout(10_000)); // Returns 408 if handler exceeds 10s
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.use(staticFile('public', { maxAge: 3600, etag: true })); // ETag, 304, Range 206/416

// Payment/Order Double-Charge Protection (Idempotency-Key header)
// - Returns 409 Conflict if duplicate request is currently in-flight
// - Replays cached response with X-Idempotent-Replayed: true on retry
app.post('/payments', idempotency({ ttlMs: 86_400_000 }), async (ctx) => {
  const body = await ctx.jsonBody();
  return { chargeId: 'ch_101', amount: body.amount, status: 'paid' };
});

// Cache-Stampede / Thundering-Herd Request Coalescing
const singleflight = createSingleflight();
app.get('/reports/daily', async () => {
  // 100 concurrent requests coalesce into a SINGLE database query execution
  return singleflight.do('daily-report', async () => ({ revenue: 125_000, generatedAt: Date.now() }));
});

// Argon2id Password Hashing & JWT Creation
app.post('/login', async (ctx) => {
  const { password } = await ctx.jsonBody();
  const hash = await Hash.make(password);
  const valid = await Hash.verify(password, hash);
  if (!valid) return ctx.status(401).send('Invalid credentials');

  const token = await createToken({ id: 1, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return { token };
});

// Protect routes with constant-time JWT verification & RBAC (`ctx.user`)
app.get('/admin', bareAuth({ secret: SECRET }), hasRole('admin'), (ctx) => ({
  user: ctx.user,
  requestId: ctx.requestId
}));
```

---

### 4. 🧩 Type-Safe Context Derivation (`app.derive`), Plugins & Lifecycle Hooks

```typescript
// Enrich ctx with full TypeScript inference (auto-cleaned on pool release)
const appWithContext = app.derive((ctx) => ({
  requestTime: Date.now(),
  traceId: ctx.requestId
}));

appWithContext.get('/trace', (ctx) => ({
  traceId: ctx.traceId,         // typed as string
  requestTime: ctx.requestTime  // typed as number
}));

// Register a modular plugin
app.use({
  name: 'health-plugin',
  install(instance) {
    instance.get('/healthz', (ctx: any) => ({ ok: true, traceId: ctx.traceId }));
  }
});

// Server Lifecycle & Error Masking
app.onStart(() => console.log('Database ready'));
app.onStop(async () => console.log('Cleaned up resources'));
app.onError((err, ctx) => ctx.status(err.status || 500).json({
  status: 'error',
  message: err.message,
  requestId: ctx.requestId
}));
```

---

### 5. 📡 Real-Time (WebSocket, SSE), OpenAPI 3.1, JSON-RPC 2.0 & Client

```typescript
import { BareJS, bareClient } from 'barejs';

const app = new BareJS();

// Native Bun WebSocket
app.ws('/ws/chat', {
  open: (ws) => ws.send('connected'),
  message: (ws, msg) => ws.send(`echo: ${msg}`)
});

// Server-Sent Events (SSE)
app.get('/events', (ctx) => ctx.sse(async (send) => {
  send({ step: 1, msg: 'streaming...' }, 'progress', '1');
}));

// JSON-RPC 2.0 Endpoint (single, batch & notifications)
app.rpc('/rpc', {
  add: ({ a, b }: { a: number; b: number }) => a + b
});

// Auto OpenAPI 3.1 Spec (/docs/json) + Scalar UI (/docs)
app.docs('/docs', { title: 'My BareJS API', version: '1.0.0' });

// Type-Safe Client (Zero-Network In-Memory for tests/SSR OR Network URL)
const inMemoryClient = bareClient(app);
const localRes = await inMemoryClient.get('/users/:id', { params: { id: 42 }, query: { full: true } });

const httpClient = bareClient('http://localhost:3000');
const remoteRes = await httpClient.get('/users/:id', { params: { id: 42 }, query: { full: true } });
```

---

## 🧠 Complete `Context` (`ctx`) Reference

| Method / Property | Description |
| :--- | :--- |
| `ctx.req` | Raw incoming Bun `Request` object. |
| `ctx.params` | Route parameters (`:id` or `ctx.params['*']` for wildcard routes). |
| `ctx.query` / `ctx.getQuery(k)` | Lazy, prototype-pollution-safe parsed query parameters. |
| `await ctx.jsonBody(maxBytes?)` | Parses & caches JSON body (enforces `413` limit, default 1MB). |
| `await ctx.upload(options?)` | Safe `multipart/form-data` upload parser (`maxFileSize`, `maxFiles`, `allowedTypes`). |
| `ctx.cookies` | Lazy parsed request cookies (`Record<string, string>`). |
| `await ctx.setCookie(k, v, opts?)` | Sets a cookie (`HttpOnly; SameSite=Lax` default, optional HMAC `secret`). |
| `await ctx.getSignedCookie(k, s)` | Verifies HMAC-SHA256 signed cookie in constant time. |
| `ctx.deleteCookie(k, opts?)` | Expires a cookie immediately. |
| `ctx.user` | Authenticated user payload from `bareAuth` or `basicAuth`. |
| `ctx.requestId` | Incoming `x-request-id` header or generated UUIDv4. |
| `ctx.status(code)` | Sets HTTP response status code (chainable). |
| `ctx.setHeader(name, value)` | Sets response header (chainable, copy-on-write safe). |
| `ctx.json(data)` | Returns `application/json` response. |
| `ctx.send(msg, extra?)` | Returns standardized `{ status, msg, ...extra }` JSON response. |
| `ctx.html(html, status?)` | Returns `text/html; charset=utf-8` response. |
| `ctx.text(text, status?)` | Returns `text/plain; charset=utf-8` response. |
| `ctx.redirect(url, status?)` | Returns HTTP redirect response (default `302`). |
| `ctx.sse(source)` | Streams Server-Sent Events (`text/event-stream`). |
| `ctx.set(k, v)` / `ctx.get(k)` | Per-request key-value storage (cleared on pool release). |

---

## ⚙️ Performance & Environment Configuration

| Variable / File | Default | Description |
| :--- | :--- | :--- |
| `bare.config.ts` | Optional | Centralized config for `port` and Argon2/bcrypt `hash` parameters. |
| `poolSize` | `1024` | `new BareJS(poolSize)` — rounded up to power of 2 for $O(1)$ pooling. |
| `NODE_ENV` | `development` | Set to `production` to mask 500 stack traces and disable startup banner. |

---

**Maintained by [xarhang](https://github.com/xarhang) | License: MIT**
