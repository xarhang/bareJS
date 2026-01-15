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
| **BareJS** | **1.81 µs** | **Baseline** |
| Elysia | 2.43 µs | 1.34x slower |
| Hono | 9.79 µs | 5.42x slower |

> Last Updated: 2026-01-15 (github action)

<!-- MARKER: PERFORMANCE_TABLE_END -->

> [!TIP]
> **View our [Continuous Benchmark Dashboard**](https://xarhang.github.io/bareJS/dev/benchmarks/) for historical data and detailed performance trends.

## 🚀 Key Features

* **JIT Pipeline Compilation**: Routes and middleware chains are flattened into a single function at runtime.
* **Object Pooling**: Recycles `Context` objects via a circular buffer, drastically reducing GC pressure.
* **Internal High-Performance Logger**: Zero-overhead logging integrated directly into the JIT engine.
* **Precise Radix Router**: v0.1.46 introduces optimized segment matching for deep-nested paths.
* **Mechanical Sympathy**: Intentionally designed to align with V8's optimization and Bun's I/O.

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

### 1. ⚡ Standardized Response & Chaining

BareJS v0.1.46 provides a fluent API for building responses.

```typescript
app.get('/api/v1/health', (ctx: Context) => {
  // Chainable status and standardized send helper
  return ctx.status(200).send("System is healthy", { 
    uptime: process.uptime() 
  });
});

// Output: { "status": "success", "msg": "System is healthy", "uptime": ... }

```

### 2. 🛡️ Security & Authentication (Dual-API)

```typescript
import { bareAuth, createToken, Password, Hash, type Context } from 'barejs';

const SECRET = process.env.JWT_SECRET || "your-secret";

app.post('/register', async (ctx: Context) => {
  const body = await ctx.jsonBody();
  
  // High-performance Argon2id Hashing (64MB default)
  const hash = await Password.make(body.password); 
  
  // Verify with ease
  const isValid = await Hash.verify(body.password, hash);
  
  if (isValid) {
    const token = await createToken({ id: 1 }, SECRET);
    return { token };
  }
});

// Protect routes with built-in JWT middleware
app.get('/me', bareAuth(SECRET), (ctx: Context) => {
  return ctx.send("Authenticated", { user: ctx.get('user') });
});

```

### 3. ✅ Data Validation (3 Styles)

BareJS is the only engine that offers JIT-optimized validation paths.

```typescript
import { typebox, zod, native, t, type Context } from 'barejs';
import { z } from 'zod';

// Style A: TypeBox (JIT Optimized - Recommended)
// Pre-compiled validation to outperform competitors by 55%
const Schema = t.Object({ name: t.String() });
app.post('/user', typebox(Schema), (ctx) => ctx.json(ctx.body));

// Style B: Zod (Industry Standard)
const ZodSchema = z.object({ age: z.number() });
app.post('/age', zod(ZodSchema), (ctx) => ctx.json(ctx.body));

// Style C: Native (Zero Dependency - Simple Checks)
app.post('/native', native({ properties: { id: { type: 'number' } } }), (ctx) => ctx.json(ctx.body));

```

### 4. 🔌 Essential Middleware

```typescript
import { cors, staticFile } from 'barejs';

app.use(cors());
app.use(staticFile("public"));

```

---

## 🧠 Context API

| Method / Property | Description |
| --- | --- |
| `ctx.req` | Raw incoming Bun `Request` object. |
| `ctx.params` | Route parameters (e.g., `:id`). |
| `ctx.jsonBody()` | **[Async]** Parses and caches JSON body for performance. |
| `ctx.status(code)` | Sets the HTTP status code (**Chainable**). |
| `ctx.send(msg, ext)` | Returns a standardized JSON response. |
| `ctx.json(data)` | Returns an optimized raw JSON response. |
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
