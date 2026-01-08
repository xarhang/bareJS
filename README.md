# 🚀 BareJS

**The "Metal" of Web Frameworks.**

BareJS is an ultra-high-performance web engine built on **Bun**, architected strictly for **Mechanical Sympathy**. By aligning software execution with modern CPU branch prediction and memory caching, we achieve latencies that traditional frameworks simply cannot touch.

<p align="left">
  <a href="https://github.com/xarhang/bareJS/tags">
    <img src="https://img.shields.io/github/v/tag/xarhang/bareJS?style=flat-square&logo=github&label=github&color=black" alt="GitHub Tag">
  </a>
  <a href="https://www.npmjs.com/package/barejs">
    <img src="https://img.shields.io/npm/v/barejs?style=flat-square&logo=npm&color=CB3837" alt="NPM Version">
  </a>
  <a href="https://github.com/xarhang/bareJS/actions/workflows/bench.yml">
    <img src="https://github.com/xarhang/bareJS/actions/workflows/bench.yml/badge.svg" alt="Performance Benchmark">
  </a>
</p>

---

## 📊 Benchmarks: The "Nanosecond" Standard

BareJS ruthlessly optimizes the hot path. We don't just "wrap" request handlers; we **JIT compile** them into a flat executive function, bypassing object lookups entirely.

| Scenario | Framework | Time/Request | Speedup |
| :--- | :--- | :--- | :--- |
| **Stress Test** (10 MW + Deep Path) | **BareJS** | **1.61 µs** | **Baseline 🚀** |
| | Elysia | 2.15 µs | 1.33x slower |
| | Hono | 9.57 µs | 5.94x slower |
| **Simple Route** (Hello World) | **BareJS** | **1.99 µs** | **Tied (Runtime Limit)** |

> *Benchmarks run on AMD Ryzen 7 3700X, Bun v1.3.5*

---

## ⚡ Quick Start

Initialize a production-ready project instantly:

```bash
bun create barejs my-app
cd my-app
bun dev
```

### The "Bare" Minimum
```typescript
import { BareJS, type Context } from 'barejs';

const app = new BareJS();

app.get('/ping', (ctx: Context) => ctx.json({ msg: "pong" }));

app.listen(3000);
```

---

## 📖 The Hitchhiker's Guide to BareJS

### 1. Routing & Context
BareJS uses a **Zero-Allocation Context**. The `ctx` object is reused from a pre-allocated pool to prevent Garbage Collection spikes.

```typescript
app.get('/users/:id', (ctx: Context) => {
  // 1. Params (Zero-Copy slices)
  const id = ctx.params.id;

  // 2. Query Strings (Wait... where are they?)
  // Use native Bun request for raw speed if needed:
  const url = new URL(ctx.req.url);
  const sort = url.searchParams.get('sort');

  // 3. Response
  return ctx.status(200).json({ id, sort });
});
```

### 2. Nested Routers & Grouping
Organize your API into standard modules using `BareRouter`.

```typescript
import { BareJS, BareRouter } from 'barejs';

const app = new BareJS();
const v1 = new BareRouter("/api/v1");
const auth = new BareRouter("/auth");

// Define routes on sub-router
auth.post("/login", (ctx) => ctx.json({ token: "..." }));

// Mount router (Result: /api/v1/auth/login)
v1.use(auth);
app.use(v1);
```

### 3. Middleware
Middleware in BareJS is "Compiled Away". Whether you have 1 or 100 middlewares, the runtime cost is flattened.

```typescript
// Global Middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`Took: ${Date.now() - start}ms`);
});

// Route-Specific Middleware
const upgrade = (ctx, next) => {
  if (ctx.req.headers.get("upgrade") !== "websocket") return ctx.status(400).json({ error: "No WS" });
  return next();
};

app.get('/ws', upgrade, (ctx) => { /* ... */ });
```

---

## 🛡️ Security & Authentication (JWT)
BareJS includes a standard-compliant (RFC 7515) JWT implementation powered by `CrytpoKey` caching.

```typescript
import { bareAuth, createToken, type Context } from 'barejs';

const SECRET = process.env.JWT_SECRET || "s3cr3t";

// 1. Generate Token
app.post('/login', async (ctx: Context) => {
  const user = { id: 1, role: "admin" };
  const token = await createToken(user, SECRET);
  return { token };
});

// 2. Protect Routes
// bareAuth automatically verifies header and sets ctx.get('user')
app.get('/admin', bareAuth(SECRET), (ctx: Context) => {
  const user = ctx.get('user');
  return { secret_data: "42", user };
});
```

---

## ✅ Validation (TypeBox)
We recommend **TypeBox** for validation as it compiles to JIT-friendly code.

```typescript
import { typebox, t } from 'barejs';

const UserSchema = t.Object({
  username: t.String(),
  age: t.Number()
});

app.post('/user', typebox(UserSchema), (ctx) => {
  // TypeScript knows ctx.body is { username: string, age: number }
  return { created: ctx.body.username };
});
```

---

## 🔌 Built-in Utilities

### CORS
```typescript
import { cors } from 'barejs';
app.use(cors({ origin: "*", methods: ["GET", "POST"] }));
```

### Static Files
```typescript
import { staticFile } from 'barejs';
// Serve everything in ./public at root
app.use(staticFile("public"));
```

---

## ⚙️ Deployment & Tuning

To unleash full performance (100k+ RPS), create a production environment:

```bash
# Power of 2 pool size allows bitwise masking vs expensive modulo
BARE_POOL_SIZE=4096 NODE_ENV=production bun run index.ts
```

| Config | Default | Description |
| :--- | :--- | :--- |
| `BARE_POOL_SIZE` | `1024` | Request context pool. Must be power of 2. |
| `NODE_ENV` | `development` | Set to `production` to enable aggressive JIT. |

---

**Maintained by [xarhang]** | **License: MIT**
