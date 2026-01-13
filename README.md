
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

  <p align="center">
    <a href="#-benchmarks">Benchmarks</a> •
    <a href="#-features">Features</a> •
    <a href="#-quick-start">Quick Start</a> •
    <a href="#-configuration">Configuration</a> •
    <a href="#-architecture">Architecture</a>
  </p>

  ---
</div>

## 📊 Benchmarks: Real-World Performance

BareJS leads in complex, real-world scenarios. We measure engine efficiency using a **stress test** involving **10+ middlewares** and **deep radix tree routing** to ensure performance holds under high concurrency.

<!-- MARKER: PERFORMANCE_TABLE_START -->

| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **1.57 µs** | **Baseline** |
| Elysia | 2.43 µs | 1.55x slower |
| Hono | 10.63 µs | 6.76x slower |

> Last Updated: 2026-01-12

<!-- MARKER: PERFORMANCE_TABLE_END -->
> [!TIP]
> **View our [Continuous Benchmark Dashboard](https://xarhang.github.io/bareJS/dev/benchmarks/)** for historical data and detailed performance trends across different hardware.


## 🚀 Key Features

* **JIT Pipeline Compilation**: Routes and middleware chains are flattened into a single function at runtime.
* **Object Pooling**: Recycles `Context` objects via a circular buffer, drastically reducing GC pressure.
* **Secure by Default**: Built-in **Argon2id (64MB)** hashing for maximum production security.
* **Mechanical Sympathy**: Intentionally designed to align with V8's optimization and Bun's I/O.

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

### 1. 🛡️ Security & Authentication (Dual-API)

BareJS provides high-level security utilities. You can use `Hash` or `Password` interchangeably for semantic clarity.

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

// Protect routes
app.get('/me', bareAuth(SECRET), (ctx: Context) => {
  return { user: ctx.get('user') };
});

```

### 2. ⚙️ Configuration

Customize your engine by creating a `bare.config.ts` in your root directory.

```typescript
// bare.config.ts
export default {
  port: 3000,
  hash: {
    algorithm: "argon2id",
    memoryCost: 65536, // 64MB
    timeCost: 2
  }
};

```

### 3. ✅ Data Validation (3 Styles)

```typescript
import { typebox, zod, native, t, type Context } from 'barejs';
import { z } from 'zod';

// Style A: TypeBox (JIT Optimized - Recommended)
const Schema = t.Object({ name: t.String() });
app.post('/user', typebox(Schema), (ctx) => ctx.json(ctx.body));

// Style B: Zod (Industry Standard)
const ZodSchema = z.object({ age: z.number() });
app.post('/age', zod(ZodSchema), (ctx) => ctx.json(ctx.body));

```

### 4. 🔌 Essential Plugins

```typescript
import { logger, cors, staticFile } from 'barejs';

app.use(logger);
app.use(cors());
app.use(staticFile("public"));

```

---

## 🧠 Context API

| Method / Property | Description |
| --- | --- |
| `ctx.req` | Raw incoming Bun `Request` object. |
| `ctx.params` | Route parameters (e.g., `:id`). |
| `ctx.jsonBody()` | **[Async]** Parses and caches JSON body. |
| `ctx.status(code)` | Sets the HTTP status code. |
| `ctx.json(data)` | Returns an optimized JSON response. |

---

## ⚙️ Performance Tuning

| OS Variable / File | Default | Description |
| --- | --- | --- |
| `bare.config.ts` | - | Centralized config for Port and Hash. |
| `BARE_POOL_SIZE` | `1024` | Context pool size (Must be Power of 2). |
| `NODE_ENV` | `development` | Set to `production` for peak JIT speed. |

**Maintained by [xarhang](https://github.com/xarhang) | License: MIT**