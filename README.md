# 🚀 BareJS

BareJS is an ultra-high-performance web engine built on the **Bun** runtime, specifically architected for minimalism and the lowest possible latency. It represents the pinnacle of **Mechanical Sympathy**, ensuring software execution aligns perfectly with modern CPU data processing.

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
  <a href="https://xarhang.github.io/bareJS/dev/benchmarks/">
    <img src="https://img.shields.io/badge/Performance-Dashboard-blueviolet?style=flat-square&logo=speedtest" alt="Performance Dashboard">
  </a>
  <a href="https://bun.sh">
    <img src="https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?style=flat-square&logo=bun" alt="Bun Version">
  </a>
</p>

---

## 📊 Performance Benchmarks: Breaking the Nanosecond Barrier

BareJS is the definitive baseline for speed in the JavaScript ecosystem. By ruthlessly eliminating common framework overhead, we consistently achieve sub-microsecond latency.

### 📈 Global Latency Comparison (Lower is Better)
<!-- MARKER: PERFORMANCE_TABLE_START -->

| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **621.69 ns** | **Baseline** |
| Elysia | 2.28 µs | 3.67x slower |
| Hono | 3.83 µs | 6.16x slower |

> Last Updated: Wed, 07 Jan 2026 08:53:13 GMT

<!-- MARKER: PERFORMANCE_TABLE_END -->

<!-- NOTE: The table above is automatically updated via scripts/update-readme.ts -->


## 🛠️ Rapid Scaffolding (Recommended)

The fastest way to initialize a production-ready environment is via the official **`bun create`** command. This scaffolds a pre-configured project with optimized `tsconfig.json` and production build scripts.

```bash
bun create barejs my-app
cd my-app
bun dev

```

---

## 🏛 Architectural Engineering Deep-Dive

### 1. Zero-Allocation Circular Context Pool

Traditional frameworks create new objects for every hit, triggering Garbage Collector (GC) spikes. BareJS pre-allocates a fixed array of Context objects and utilizes **Bitwise Masking** (`idx & mask`) for instant recycling.

### 2. Synchronous Fast-Path Execution

BareJS identifies if your handler is synchronous. Synchronous handlers bypass the Microtask queue entirely, executing directly on the call stack to avoid the "Promise Tax."

### 3. JIT Route Compilation (The "Baking" Phase)

During `app.listen()`, the route tree is transformed into a **Static Jump Table**. Middleware is recursively "baked" into a single flat execution function, removing array iteration overhead at runtime.

---

## ⚡ Comprehensive Usage Guide

BareJS supports **Hybrid Handler Signatures**, allowing you to choose between maximum performance (Context) or standard Web APIs (Request/Params).

### 🚀 Implementation Example

```typescript
import { BareJS, type Context, type Params } from 'barejs'; 

const app = new BareJS({ 
  poolSize: 2048 // Power of 2 required for hardware-accelerated masking
});

// Style A: Zero-Allocation Context Pool (The 379ns Path)
app.get('/ctx', (ctx: Context) => ctx.json({ mode: "pooled" }));

// Style B: Native Request/Params (Legacy/Standard compatibility)
app.get('/user/:id', (req: Request, params: Params) => {
  return { id: params.id, method: "native" };
});

app.listen(3000);

```
---
### ⚡ Example: Using Protected & Public Groups
Since you wanted separate variables for your groups:

```TypeScript
import { BareJS, BareRouter, type Context } from 'barejs';
import { bareAuth, createToken } from 'barejs'; // Your new script

const app = new BareJS();
const SECRET = process.env.JWT_SECRET || "super-secret-key";

// --- 1. Public Auth Router ---
const authRouter = new BareRouter("/auth");

authRouter.post("/login", async (ctx: Context) => {
  // Logic to check DB password here...
  const token = await createToken({ id: 1, name: "Admin" }, SECRET);
  return { token };
});

// --- 2. Protected Data Router ---
// Pass your bareAuth middleware directly to the constructor
const protectedRoute = new BareRouter("", [bareAuth(SECRET)]);

protectedRoute.group("/api/v1", (v1) => {
  v1.get("/me", (ctx: Context) => {
    // ctx.get('user') works because of ctx.set('user', ...) in bareAuth
    return { user: ctx.get('user') };
  });

  v1.get("/dashboard", (ctx: Context) => ({ stats: [10, 20, 30] }));
});

// --- 3. Mount ---
app.use(authRouter);
app.use(protectedRoute);

app.listen(3000);
```
---

## 🔌 Advanced Deployment

To achieve the benchmarked numbers, ensure you deploy using the BareJS optimized runtime environment.

| Variable | Description | Default |
| --- | --- | --- |
| `BARE_POOL_SIZE` | Sets the number of pre-allocated Context objects | 1024 |
| `NODE_ENV` | Set to `production` to enable full JIT optimizations | development |

**Deployment Command:**

```bash
BARE_POOL_SIZE=4096 NODE_ENV=production bun run index.ts

```

---

## 🏗 Roadmap & Vision

* [x] Zero-Allocation Context Pooling
* [x] Bitwise Masking Optimization
* [x] JIT Route Compilation
* [x] Hybrid Handler Signatures (Context & Native)
* [x] Route Grouping: Zero-overhead route organization via JIT flattening.
* [x] **Native Cluster Mode Support**: Automatic horizontal scaling across CPU cores.
* [ ] **Direct Buffer Response**: Aiming for 400ns latency by writing directly to the TCP stream.


---

**Maintained by [xarhang]** | **License: MIT**

