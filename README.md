<div align="center">
<br />
<h1>Bare<span style="color: #F7DF1E;">JS</span></h1>
<p><strong>The "Metal" of Web Frameworks</strong></p>
<p><i>An ultra-high-performance web engine built for Bun, architected strictly for Mechanical Sympathy.</i></p>

<p>
<a href="https://www.npmjs.com/package/barejs">
<img src="https://img.shields.io/npm/v/barejs?style=for-the-badge&logo=npm&color=CB3837" alt="NPM Version">
</a>
<a href="https://github.com/xarhang/barejs/actions/workflows/bench.yml">
<img src="https://img.shields.io/github/actions/workflow/status/xarhang/barejs/bench.yml?branch=main&label=Performance&style=for-the-badge&logo=github" alt="Performance">
</a>
<a href="https://bun.sh">
<img src="https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?style=for-the-badge&logo=bun" alt="Bun Version">
</a>
<a href="https://github.com/xarhang/barejs/blob/main/LICENSE">
<img src="https://img.shields.io/github/license/xarhang/barejs?style=for-the-badge&color=blue" alt="License">
</a>
</p>
</div>

---

</div>

## 📊 Benchmarks: Real-World Performance

BareJS leads in complex, real-world scenarios. We measure engine efficiency using a **stress test** involving **10+ middlewares** and **deep radix tree routing** to ensure performance holds under high concurrency.
<!-- MARKER: PERFORMANCE_TABLE_START -->

| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **0.85 µs** | **Baseline** |
| Elysia | 1.30 µs | 1.52x slower |
| Hono | 5.00 µs | 5.88x slower |

> Last Updated: 2026-11-17 (github action)

<!-- MARKER: PERFORMANCE_TABLE_END -->

> [!TIP]
> **View our [Continuous Benchmark Dashboard**](https://xarhang.github.io/bareJS/dev/benchmarks/) for historical data and detailed performance trends.

## 🚀 Key Features

* **JIT Pipeline Compilation**: Routes and middleware chains are flattened into a single function at runtime.
* **Concurrency-Safe Object Pooling**: Recycles `Context` objects via a free-list stack, drastically reducing GC pressure with zero cross-request leakage.
* **Internal High-Performance Logger**: Zero-overhead logging integrated directly into the JIT engine.
* **Precise Radix Router**: Optimized segment matching for deep-nested paths and lazy query parsing (`ctx.query`).
* **Real-Time & RPC Ready**: Built-in **Native WebSocket (`app.ws`)**, **SSE (`ctx.sse`)**, **JSON-RPC 2.0 (`app.rpc`)**, and **Type-Safe `bareClient`**.
* **AOT OpenAPI 3.1 Docs**: Zero-runtime-cost `app.docs()` with Scalar UI generated from TypeBox, Zod, and Native schemas.
* **Mechanical Sympathy**: Intentionally designed to align with JSC/V8 optimization and Bun's I/O.

## 🛠️ Installation

```bash
bun add barejs
```

### The "Bare" Minimum

```typescript
import { BareJS, type Context } from 'barejs';

const app = new BareJS();

// Enable Internal Logger
app.useLog(true);

app.get('/', (ctx: Context) => ctx.json({ hello: "world" }));

app.listen(3000);
```

---

## 📘 Comprehensive Guide

### 1. ⚡ Standardized Response, Lazy Query & Error Hook

BareJS v0.1.49 provides a fluent API for responses, lazy query parsing, and centralized error handling.

```typescript
app.onError((err, ctx) => {
  ctx.status(500);
  return { status: "error", message: err.message };
});

app.get('/api/v1/health', (ctx: Context) => {
  const verbose = ctx.getQuery('verbose'); // Lazy-parsed only when accessed
  return ctx.status(200).send("System is healthy", {
    verbose: verbose === 'true',
    uptime: process.uptime()
  });
});

// Output: { "status": "success", "msg": "System is healthy", "verbose": ..., "uptime": ... }
```

### 2. 🛡️ Security & Authentication (Dual-API)

```typescript
import { bareAuth, createToken, basicAuth, hasRole, Password, Hash, type Context } from 'barejs';

const SECRET = process.env.JWT_SECRET || "your-secret";

app.post('/register', async (ctx: Context) => {
  const body = await ctx.jsonBody();
  
  // High-performance Argon2id Hashing (64MB default)
  const hash = await Password.make(body.password); 
  
  // Verify with ease
  const isValid = await Hash.verify(body.password, hash);
  
  if (isValid) {
    const token = await createToken({ id: 1, role: 'admin' }, SECRET);
    return { token };
  }
});

// Protect routes with constant-time JWT middleware & RBAC
app.get('/me', bareAuth(SECRET), hasRole('admin'), (ctx: Context) => {
  return ctx.send("Authenticated", { user: ctx.get('user') });
});
```

### 3. ✅ Data Validation (3 Styles)

BareJS is the only engine that offers JIT-optimized validation paths.

```typescript
import { typebox, zod, native, t, type Context } from 'barejs';
import { z } from 'zod';

// Style A: TypeBox (JIT Optimized - Recommended)
const Schema = t.Object({ name: t.String() });
app.post('/user', typebox(Schema), (ctx) => ctx.json(ctx.body));

// Style B: Zod (Industry Standard)
const ZodSchema = z.object({ age: z.number() });
app.post('/age', zod(ZodSchema), (ctx) => ctx.json(ctx.body));

// Style C: Native (Zero Dependency - Simple Checks)
app.post('/native', native({ properties: { id: { type: 'number' } } }), (ctx) => ctx.json(ctx.body));
```

### 4. 🔌 Essential Production Middleware

```typescript
import { cors, rateLimit, securityHeaders, staticFile } from 'barejs';

app.use(securityHeaders());
app.use(cors({ origin: 'https://example.com' }));
app.use(rateLimit({ windowMs: 60_000, max: 100 }));
app.use(staticFile("public"));
```

### 5. 📡 Real-Time (WebSocket, SSE), OpenAPI & RPC

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

// JSON-RPC 2.0 Endpoint (single & batch)
app.rpc('/rpc', {
  add: ({ a, b }: { a: number; b: number }) => a + b
});

// Auto OpenAPI 3.1 Spec (/docs/json) + Scalar UI (/docs)
app.docs('/docs', { title: 'My BareJS API', version: '1.0.0' });

// Type-Safe HTTP RPC Client
const client = bareClient('http://localhost:3000');
const user = await client.get('/users/:id', { params: { id: 42 }, query: { full: true } });
```

---

## 🧠 Context API

| Method / Property | Description |
| --- | --- |
| `ctx.req` | Raw incoming Bun `Request` object. |
| `ctx.params` | Route parameters (e.g., `:id`). |
| `ctx.query` | **Lazy** parsed query parameters object. |
| `ctx.getQuery(key)` | Returns a single query parameter value lazily. |
| `ctx.jsonBody()` | **[Async]** Parses and caches JSON body for performance. |
| `ctx.status(code)` | Sets the HTTP status code (**Chainable**). |
| `ctx.send(msg, ext)` | Returns a standardized JSON response. |
| `ctx.json(data)` | Returns an optimized raw JSON response. |
| `ctx.sse(source)` | Streams Server-Sent Events (`text/event-stream`). |
| `ctx.setHeader(k, v)` | Sets a response header. |
| `ctx.set / ctx.get` | Manual storage within the request lifecycle. |

---

## ⚙️ Performance Tuning

| OS Variable / File | Default | Description |
| --- | --- | --- |
| `bare.config.ts` | - | Centralized config for Port and Hash algorithms. |
| `BARE_POOL_SIZE` | `1024` | Context pool size (**Must be Power of 2**). |
| `NODE_ENV` | `development` | Set to `production` to enable peak JIT optimizations. |

---

**Maintained by [xarhang](https://github.com/xarhang) | License: MIT**
