<div align="center">
  <br />
  <h1>Bare<span style="color: #F7DF1E;">JS</span></h1>
  <p><strong>The "Metal" of Web Frameworks</strong></p>
  <p><i>An ultra-high-performance web engine built for Bun, architected strictly for Mechanical Sympathy.</i></p>

  <p>
    <a href="https://www.npmjs.com/package/barejs">
      <img src="https://img.shields.io/npm/v/barejs?style=for-the-badge&logo=npm&color=CB3837" alt="NPM Version">
    </a>
    <a href="https://github.com/xarhang/bareJS/actions/workflows/bench.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/xarhang/bareJS/bench.yml?branch=main&label=Performance&style=for-the-badge&logo=github" alt="Performance">
    </a>
    <a href="https://bun.sh">
      <img src="https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?style=for-the-badge&logo=bun" alt="Bun Version">
    </a>
    <a href="https://github.com/xarhang/bareJS/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/xarhang/bareJS?style=for-the-badge&color=blue" alt="License">
    </a>
  </p>

  <p align="center">
    <a href="#-benchmarks">Benchmarks</a> •
    <a href="#-features">Features</a> •
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-architecture">Architecture</a>
  </p>

  ---
</div>

## 📊 Benchmarks: Real-World Performance

BareJS leads in complex, real-world scenarios. We measure engine efficiency using a **stress test** involving **10+ middlewares** and **deep radix tree routing** to ensure performance holds under high concurrency, not just in isolated "Hello World" loops.
<!-- MARKER: PERFORMANCE_TABLE_START -->
| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **1.15 µs** | **Baseline** |
| Elysia | 1.60 µs | 1.39x slower |
| Hono | 8.81 µs | 7.63x slower |

> Last Updated: 2026-01-09 (BareJS Ultra-Accuracy Suite)

<!-- MARKER: PERFORMANCE_TABLE_END -->
> [!TIP]
> **View our [Continuous Benchmark Dashboard](https://xarhang.github.io/bareJS/dev/benchmarks/)** for historical data and detailed performance trends across different hardware.

## 🚀 Key Features

* **JIT Pipeline Compilation**: Routes and middleware chains are compiled into a single, flattened JavaScript function at runtime to eliminate recursive call overhead.
* **Object Pooling**: Recycles `Context` objects via a circular buffer, significantly reducing Garbage Collection (GC) pressure.
* **Lazy Body Parsing**: Requests are processed instantly. Payloads are only parsed on-demand via `ctx.jsonBody()`, maintaining peak speed for GET requests.
* **Mechanical Sympathy**: Intentionally designed to align with V8's optimization heuristics and Bun's internal I/O architecture.

## 🛠️ Installation

```bash
bun add barejs

```

### The "Bare" Minimum

```typescript
import { BareJS, type Context } from 'barejs';

const app = new BareJS();

app.get('/', (ctx: Context) => ctx.json({ hello: "world" }));

app.listen(3000);

```

---

## 📘 Comprehensive Guide

### 1. 🔀 Advanced Routing

Modularize your application and maintain clean codebases using `BareRouter`.

```typescript
import { BareJS, BareRouter, type Context } from 'barejs';

const app = new BareJS();
const api = new BareRouter("/api/v1");

api.get("/status", (ctx: Context) => ({ status: "ok" }));

app.use(api); // Accessible at /api/v1/status

```

### 2. 🛡️ Security & Authentication

Built-in utilities for secure password hashing (Argon2/Bcrypt via Bun) and RFC-compliant JWT handling.

```typescript
import { bareAuth, createToken, Password, type Context } from 'barejs';

const SECRET = "your-ultra-secure-secret";

app.post('/login', async (ctx: Context) => {
  const body = await ctx.jsonBody();
  const hash = await Password.hash(body.password);
  const isValid = await Password.verify(body.password, hash);
  
  if (isValid) {
    const token = await createToken({ id: 1 }, SECRET);
    return { token };
  }
});

// Protect routes with bareAuth middleware
app.get('/me', bareAuth(SECRET), (ctx: Context) => {
  const user = ctx.get('user'); // Identity injected by bareAuth
  return { user };
});

```

### 3. ✅ Data Validation (3 Styles)

BareJS integrates deeply with TypeBox for JIT-level speeds but remains compatible with the broader ecosystem.

```typescript
import { typebox, zod, native, t, type Context } from 'barejs';
import { z } from 'zod';

// Style A: TypeBox (Highest Performance - Recommended)
const TypeBoxSchema = t.Object({ name: t.String() });
app.post('/typebox', typebox(TypeBoxSchema), async (ctx: Context) => {
  const body = await ctx.jsonBody();
  return body;
});

// Style B: Zod (Industry Standard)
const ZodSchema = z.object({ age: z.number() });
app.post('/zod', zod(ZodSchema), async (ctx: Context) => {
  const body = await ctx.jsonBody();
  return body;
});

// Style C: Native (Zero Dependency / JSON Schema)
const NativeSchema = { 
  type: "object",
  properties: { id: { type: 'number' } },
  required: ["id"]
};
app.post('/native', native(NativeSchema), async (ctx: Context) => {
  const body = await ctx.jsonBody();
  return body;
});

```

### 4. 🔌 Essential Plugins

Standard utilities optimized for the BareJS engine's execution model.

#### **Logger**

High-precision terminal logging with color-coded status codes and microsecond timing.

```typescript
import { logger } from 'barejs';
app.use(logger);

```

#### **CORS**

Highly optimized Cross-Origin Resource Sharing middleware.

```typescript
import { cors } from 'barejs';
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));

```

#### **Static Files**

Serves static assets with zero-overhead using Bun's native file system implementation.

```typescript
import { staticFile } from 'barejs';
app.use(staticFile("public"));

```

---

## 🧠 Context API

The `Context` object is pre-allocated in a circular pool to eliminate memory fragmentation.

| Method / Property | Description |
| --- | --- |
| `ctx.req` | Raw incoming Bun `Request` object. |
| `ctx.params` | Object containing route parameters (e.g., `:id`). |
| **`ctx.jsonBody()`** | **[Async]** Parses the JSON body on-demand and caches it for the lifecycle. |
| `ctx.status(code)` | Sets the HTTP status code (Chainable). |
| `ctx.json(data)` | Finalizes and returns an optimized JSON response. |
| `ctx.set(k, v)` | Stores metadata in the request-scoped store. |
| `ctx.get(k)` | Retrieves stored data from the lifecycle store. |

---

## ⚙️ Performance Tuning

| OS Variable | Default | Description |
| --- | --- | --- |
| `BARE_POOL_SIZE` | `1024` | Pre-allocated context pool size. Must be a **Power of 2**. |
| `NODE_ENV` | `development` | Use `production` to hide stack traces and enable V8's hot-path optimizations. |

---

**Maintained by [xarhang](https://github.com/xarhang) | **License: MIT**