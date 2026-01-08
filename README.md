# 🚀 BareJS

**The "Metal" of Web Frameworks.**

BareJS is an ultra-high-performance web engine built on **Bun**, architected strictly for **Mechanical Sympathy**. It JIT-compiles your routes and middleware into a flat execution pipeline, bypassing object lookups and overcoming the "Promise Tax".

<p align="left">
  <a href="https://www.npmjs.com/package/barejs">
    <img src="https://img.shields.io/npm/v/barejs?style=flat-square&logo=npm&color=CB3837" alt="NPM Version">
  </a>
  <a href="https://github.com/xarhang/bareJS/actions/workflows/bench.yml">
    <img src="https://github.com/xarhang/bareJS/actions/workflows/badge.svg" alt="Performance Benchmark">
  </a>
</p>

---

## 📊 Benchmarks: Real-World Performance

BareJS is designed to lead in complex, real-world scenarios. In our "Stress Test" involving 10 middlewares and deep routing, BareJS outperforms even the fastest competitors.

<!-- MARKER: PERFORMANCE_TABLE_START -->

| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **1.95 µs** | **Baseline** |
| Elysia | 1.92 µs | 0.98x slower |
| Hono | 3.64 µs | 1.87x slower |

> Last Updated: Thu, 08 Jan 2026 17:04:12 GMT

<!-- MARKER: PERFORMANCE_TABLE_END -->
---

## 🛠️ Installation & Setup

```bash
bun add barejs
```

### The "Bare" Minimum
```typescript
import { BareJS } from 'barejs';

const app = new BareJS();

app.get('/', (ctx) => ctx.json({ hello: "world" }));

app.listen(3000);
```

---

## 📘 Comprehensive Guide

### 1. 🔀 Advanced Routing
Use `BareRouter` for modularity and nesting.

```typescript
import { BareJS, BareRouter } from 'barejs';

const app = new BareJS();
const api = new BareRouter("/api/v1");

api.get("/status", (ctx) => ({ status: "ok" }));

app.use(api); // Result: /api/v1/status
```

### 2. 🛡️ Security & Authentication
Full RFC 7515 compliant JWT support and secure password utilities.

```typescript
import { bareAuth, createToken, Password, type Context } from 'barejs';

const SECRET = "your-secret";

// JWT Generation
app.post('/login', async (ctx) => {
  const hash = await Password.hash("password123");
  const isValid = await Password.verify("password123", hash);
  
  if (isValid) {
    const token = await createToken({ id: 1 }, SECRET);
    return { token };
  }
});

// Protection Middleware
app.get('/me', bareAuth(SECRET), (ctx) => {
  const user = ctx.get('user'); // Set by bareAuth
  return { user };
});
```

### 3. ✅ Data Validation (3 Styles)
Choose the validation style that fits your workflow.

```typescript
import { typebox, zod, native, t } from 'barejs';
import { z } from 'zod';

// Style A: TypeBox (Fastest, Highly Recommended)
const TypeBoxSchema = t.Object({ name: t.String() });
app.post('/typebox', typebox(TypeBoxSchema), (ctx) => ctx.body);

// Style B: Zod (Standard)
const ZodSchema = z.object({ age: z.number() });
app.post('/zod', zod(ZodSchema), (ctx) => ctx.body);

// Style C: Native (Zero Dependency)
const NativeSchema = { properties: { id: { type: 'number' } } };
app.post('/native', native(NativeSchema), (ctx) => ctx.body);
```

### 4. 🔌 Essential Plugins
Built-in utilities for modern web development.

#### **Logger**
Color-coded terminal logging with millisecond-precision timing.
```typescript
import { logger } from 'barejs';
app.use(logger);
```

#### **CORS**
```typescript
import { cors } from 'barejs';
app.use(cors({ origin: "*", methods: "GET,POST" }));
```

#### **Static Files**
Efficiently serve files from any directory.
```typescript
import { staticFile } from 'barejs';
app.use(staticFile("public")); // Serves ./public/* at /
```

### 5. 🧠 Context API
The `Context` object is recycled to eliminate GC overhead.

| Method / Property | Description |
| :--- | :--- |
| `ctx.req` | Raw Bun `Request` object |
| `ctx.params` | Route parameters |
| `ctx.body` | Validated body (from `typebox`, `zod`, etc.) |
| `ctx.status(code)` | Sets response status |
| `ctx.json(data)` | Returns an optimized JSON response |
| `ctx.set(k, v)` | Stores data in request lifecycle |
| `ctx.get(k)` | Retrieves stored data |

---

## ⚙️ Performance Tuning

| OS Variable | Default | Description |
| :--- | :--- | :--- |
| `BARE_POOL_SIZE` | `1024` | Pre-allocated context pool. Use power of 2. |
| `NODE_ENV` | `development` | Use `production` to enable max JIT stability. |

---

**Maintained by [xarhang]** | **License: MIT**
