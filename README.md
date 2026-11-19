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

All benchmark numbers below are **automatically generated on every push to `main`** by GitHub Actions running `benchmarks/fair-suite.ts`, `benchmarks/production-bench.ts`, and `benchmarks/head-to-head.ts` on real `mitata` runs.

<!-- MARKER: MULTI_BENCH_START -->

| Scenario | **BareJS** 🏆 | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`1.23 µs`**<br><sub>`p99: 7.97 µs`</sub> | `1.76 µs`<br><sub>`p99: 8.98 µs`</sub> | `3.46 µs`<br><sub>`p99: 14.39 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`1.08 µs`**<br><sub>`p99: 6.74 µs`</sub> | `1.76 µs`<br><sub>`p99: 8.53 µs`</sub> | `3.77 µs`<br><sub>`p99: 14.60 µs`</sub> |
| **3. POST JSON + Schema Validation** | **`3.54 µs`**<br><sub>`p99: 12.61 µs`</sub> | `4.00 µs`<br><sub>`p99: 12.85 µs`</sub> | `4.10 µs`<br><sub>`p99: 13.50 µs`</sub> |
| **4. Async Handler + Query Parsing** | **`1.82 µs`**<br><sub>`p99: 8.97 µs`</sub> | `2.11 µs`<br><sub>`p99: 10.04 µs`</sub> | `2.84 µs`<br><sub>`p99: 12.25 µs`</sub> |
| **5. Response Schema Secret Stripping** | **`1.04 µs`**<br><sub>`p99: 6.92 µs`</sub> | `1.62 µs`<br><sub>`p99: 8.09 µs`</sub> | — |
| **6. SQLite Report (`SUM`/`AVG`/`GROUP BY`)** | **`16.84 µs`**<br><sub>`p99: 29.20 µs`</sub> | `17.34 µs`<br><sub>`p99: 31.00 µs`</sub> | `21.39 µs`<br><sub>`p99: 44.36 µs`</sub> |
| **7. SQLite Write (`POST` + Validate + `INSERT`)** | **`8.49 µs`**<br><sub>`p99: 22.14 µs`</sub> | `10.81 µs`<br><sub>`p99: 34.97 µs`</sub> | `12.70 µs`<br><sub>`p99: 39.24 µs`</sub> |

> Last Updated: 2026-11-19 (github action)

<!-- MARKER: MULTI_BENCH_END -->

### Head-to-Head Stress Test (10 Middlewares + Deep Path)

<!-- MARKER: PERFORMANCE_TABLE_START -->

| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **1.09 µs** | **Baseline** |
| Elysia | 1.57 µs | 1.43x slower |
| Hono | 4.97 µs | 4.54x slower |

> Last Updated: 2026-11-19 (github action)

<!-- MARKER: PERFORMANCE_TABLE_END -->

> Verified with **268 Automated Tests (5,634 assertions)** and **100.00% Function & 100.00% Line Coverage**.
>
> [!TIP]
> **View our [Continuous Benchmark Dashboard](https://xarhang.github.io/bareJS/dev/benchmarks/)** for historical data and detailed performance trends.

> [!TIP]
> **Using AI Coding Assistants (Cursor, Copilot, Claude, Windsurf)?** Point them to [`llms.txt`](./llms.txt) for a complete, token-efficient reference of every BareJS API.

---

## 🚀 Key Features

* **JIT Pipeline Compilation**: Flattens routes and middleware chains into direct JavaScript functions at startup, using `AsyncFunction` single-handler fast paths and conditional bytecode inlining.
* **$O(1)$ Radix Jump-Table Router**: Compiles static branches, dynamic `:params`, and catch-all wildcards (`/*`) into inline `switch` jump-tables.
* **Recursive JIT Response Projector & Mass-Assignment Guard**: Compiles `response` schemas into fixed-shape JS object literals to strip undeclared fields, and supports `stripUnknown: true` on `body` to prevent Mass-Assignment attacks.
* **Built-In Resilience (`circuitBreaker`, `idempotency`, `createSingleflight`, `app.cron`)**: Prevent cascading failures (`503 Retry-After`), double-charges (`409 IDEMPOTENT_IN_FLIGHT`), cache stampedes (100 concurrent calls -> 1 DB hit), and overlapping background jobs.
* **Native Zero-Dep Gzip (`compress`)**: Compresses responses via Bun's native C/Zig `Bun.gzipSync` with `minSize` threshold and automatic SSE/204/304 bypass.
* **End-to-End Type Inference (`bareClient(app)`)**: Automatic compile-time inference of route paths (across all HTTP methods on shared paths), `params`, `query`, `headers`, `body`, and `response` types directly from your `BareJS` app or mounted `BareRouter`—with zero runtime overhead.
* **Concurrency-Safe Object Pooling**: Recycles `Context` instances via a LIFO free-list stack with automatic cleanup on release—zero cross-request state leakage.
* **Dual Response Ergonomics & Full HTTP Methods**: Return plain objects/strings directly (Elysia style) OR use `ctx.json()`, `ctx.html()`, `ctx.text()`, `ctx.redirect()`, `ctx.send()`, with `get`, `post`, `put`, `patch`, `delete`, `options`, `head`, and `all`.
* **Unified Schema Validation & Auto-Coercion**: Validate `body`, `query`, `params`, `headers`, `response`, and `maxBodySize` (`413` DoS guard) in one object with **TypeBox**, **Zod**, or **Native JSON Schema**—with automatic `number`/`boolean` coercion on `query` and `params`.
* **Batteries-Included Zero-Trust Security Suite**: Built-in `securityHeaders()`, `cors()`, `csrf()`, `timeout()`, `rateLimit()`, `trustProxy(false)` anti-spoofing, `maxRequestBodySize` server cap, `bareAuth()` (constant-time HS256 JWT + `revokeToken()` / `isRevoked`), `Hash` (Argon2id), HMAC-signed cookies, `ctx.upload()`, and symlink-safe `staticFile()`.
* **Observability, Real-Time, RPC & OpenAPI 3.1**: Built-in `logger()` (`pretty`/`json` + `X-Request-Id`), `healthcheck()` (`/health` + `/ready`), parameterized WebSockets (`app.ws('/ws/:room')`), SSE (`ctx.sse`), JSON-RPC 2.0 (`app.rpc`), and OpenAPI 3.1 (`app.docs`) with `securitySchemes`, `servers`, and `tags`.

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
  BareJS, BareRouter, securityHeaders, cors, csrf, timeout, rateLimit,
  idempotency, createSingleflight, redisStore, compress,
  bareAuth, createToken, basicAuth, hasRole, Hash, staticFile
} from 'barejs';

const app = new BareJS();
const SECRET = process.env.JWT_SECRET || 'super-secret-key';
const store = redisStore(Bun.redis, { prefix: 'myapp:' }); // Optional: omit for zero-overhead in-memory Map

app.use(securityHeaders());
app.use(cors({ origin: ['https://app.example.com'], credentials: true }));
app.use(csrf({ allowedOrigins: ['https://app.example.com'] }));
app.use(timeout(10_000)); // Returns 408 if handler exceeds 10s
app.use(compress({ minSize: 1024, encodings: ['zstd', 'br', 'gzip'] })); // Negotiates zstd / br / gzip
app.use(rateLimit({ windowMs: 60_000, max: 100, store }));
app.use(staticFile('public', { maxAge: 3600, etag: true, cacheMetadata: { maxEntries: 1024, ttlMs: 30_000 } }));

// Payment/Order Double-Charge Protection (Idempotency-Key header)
// - Returns 409 Conflict if duplicate request is currently in-flight
// - Replays cached response with X-Idempotent-Replayed: true on retry
app.post('/payments', idempotency({ ttlMs: 86_400_000, store }), async (ctx) => {
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

// Protect routes with constant-time HS256 JWT or asymmetric RS256/ES256/JWKS (`ctx.user`)
app.get('/admin', bareAuth({ secret: SECRET, revocationStore: store }), hasRole('admin'), (ctx) => ({
  user: ctx.user,
  requestId: ctx.requestId
}));
app.get('/sso', bareAuth({ algorithms: ['RS256', 'ES256'], jwksUri: 'https://auth.example.com/.well-known/jwks.json' }), (ctx) => ctx.user);
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
import { BareJS, BareRouter, bareClient, Type } from 'barejs';

const usersRouter = new BareRouter().get('/users/:id', {
  params: Type.Object({ id: Type.Integer() }),
  query: Type.Object({ full: Type.Optional(Type.Boolean()) }),
}, (ctx) => ({ id: ctx.params.id, full: ctx.query.full }));

const app = new BareJS().route('/api', usersRouter); // Preserves full route type inference!

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

// Ergonomic in-memory test helper
const res = await app.request('/api/users/42?full=true');

// Type-Safe Client (Zero-Network In-Memory for tests/SSR OR Network URL)
const inMemoryClient = bareClient(app);
const localRes = await inMemoryClient.get('/api/users/:id', { params: { id: 42 }, query: { full: true } });

const httpClient = bareClient('http://localhost:3000');
const remoteRes = await httpClient.get('/api/users/:id', { params: { id: 42 }, query: { full: true } });
```

---

### 6. 🛡️ Production Observability & Zero-Trust Hardening

```typescript
import { BareJS, logger, healthcheck, bareAuth, revokeToken } from 'barejs';

const app = new BareJS()
  .trustProxy(false) // Ignore spoofed X-Forwarded-For when directly exposed
  .use(logger({ format: 'json' })) // Structured JSON logs + X-Request-Id
  .use(healthcheck({
    path: '/health',
    readyPath: '/ready',
    version: '1.0.0',
    checks: { db: async () => true }
  }))
  .use(bareAuth({
    secret: process.env.JWT_SECRET!,
    isRevoked: async (payload) => isBlockedInRedis(payload.jti)
  }));

// Revoke a compromised token or jti immediately
revokeToken('compromised-jti-123', 3600_000);

// OpenAPI 3.1 with Bearer JWT securitySchemes
app.docs('/docs', {
  title: 'Production API',
  securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  security: [{ bearerAuth: [] }]
});

// Enforce server-level maxRequestBodySize (default: 10MB)
app.listen(3000, '0.0.0.0', true, { maxRequestBodySize: 2 * 1024 * 1024 });
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
