# 🚀 BareJS

BareJS is an ultra-high-performance web engine built on the **Bun** runtime, specifically architected for minimalism and the lowest possible latency. It represents the pinnacle of **Mechanical Sympathy**, ensuring that every line of software execution aligns perfectly with how modern CPUs process data.

<p align="left">
<a href="[https://github.com/xarhang/bareJS/actions](https://github.com/xarhang/bareJS/actions)">
<img src="[https://github.com/xarhang/bareJS/actions/workflows/bench.yml/badge.svg](https://github.com/xarhang/bareJS/actions/workflows/bench.yml/badge.svg)" alt="Performance Benchmark">
</a>
<a href="[https://xarhang.github.io/bareJS/dev/benchmarks/](https://xarhang.github.io/bareJS/dev/benchmarks/)">
<img src="[https://img.shields.io/badge/Performance-Dashboard-blueviolet?style=flat-square&logo=speedtest](https://img.shields.io/badge/Performance-Dashboard-blueviolet?style=flat-square&logo=speedtest)" alt="Performance Dashboard">
</a>
<a href="[https://bun.sh](https://bun.sh)">
<img src="[https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?style=flat-square&logo=bun](https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?style=flat-square&logo=bun)" alt="Bun Version">
</a>
</p>

---

## 📊 Performance Benchmarks: Breaking the Nanosecond Barrier

BareJS is designed to be the definitive baseline for speed in the JavaScript ecosystem. By ruthlessly eliminating common framework overhead, we consistently achieve sub-microsecond latency.

### 📈 Global Latency Comparison (Lower is Better)
<!-- MARKER: PERFORMANCE_TABLE_START -->

| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **538.73 ns** | **Baseline** |
| Elysia | 2.26 µs | 4.19x slower |
| Hono | 4.02 µs | 7.46x slower |

> Last Updated: Tue, 06 Jan 2026 19:23:27 GMT

<!-- MARKER: PERFORMANCE_TABLE_END -->

<!-- NOTE: The table above is automatically updated via scripts/update-readme.ts -->

---

## 🏛 Architectural Engineering Deep-Dive

Why is BareJS significantly faster than established frameworks? The answer lies in three core engineering pillars.

### 1. Zero-Allocation Circular Context Pool

Traditional frameworks create a new Request or Context object for every single incoming hit, triggering constant Garbage Collector (GC) activity and unpredictable latency spikes.

* **Pre-allocation**: BareJS pre-allocates a fixed array of Context objects during startup.
* **The Masking Logic**: It utilizes **Bitwise Masking** (`idx & mask`) to recycle these objects instantly. For a pool of 1024, the engine performs a bitwise `AND` operation, which is hardware-accelerated and exponentially faster than standard modulo division.
* **Result**: Zero GC pressure during the request-response cycle.

### 2. Synchronous Fast-Path Execution

The "Promise Tax" is a silent performance killer. Most modern frameworks wrap every route in an `async` wrapper, forcing a ~800ns penalty even for simple operations.

* **Automatic Detection**: BareJS identifies if your handler is synchronous.
* **Queue Bypassing**: Synchronous handlers bypass the Microtask queue entirely, executing directly on the call stack.

### 3. JIT Route Compilation (The "Baking" Phase)

Unlike standard routers that perform string matching or tree traversal during the request, BareJS uses a Compilation Step.

* **Static Jump Table**: During `app.listen()`, the entire route tree is transformed into a static jump table.
* **Flat Middleware Chains**: Middleware is recursively "baked" into a single flat execution function, removing the need for array iteration while the server is running.

---

## ⚡ Comprehensive Usage Guide

BareJS provides a unified API. All core utilities, validators, and types are exported from a single point to ensure your code remains as clean as the engine is fast.

### 📦 Installation

```bash
bun add barejs

```

### 🚀 Full Implementation Manual

```typescript
import { BareJS, typebox, zod, type Context } from 'barejs'; 
import * as TB from '@sinclair/typebox';

// 1. Core Initialization
// poolSize must be a power of 2 (1024, 2048, 4096) for bitwise masking
const app = new BareJS({ 
  poolSize: 2048 
});

// 2. Optimized Global Middleware
app.use((ctx, next) => {
  ctx.set('server_id', 'BARE_NODE_01');
  return next();
});

// 3. High-Speed Static Route (Sync Fast-Path: ~571ns)
app.get('/ping', () => "pong");

// 4. JIT Compiled Validation (TypeBox)
// Data in ctx.body is automatically typed and validated
const UserSchema = TB.Type.Object({ 
  username: TB.Type.String(),
  age: TB.Type.Number()
});

app.post('/register', typebox(UserSchema), (ctx: Context) => {
  const name = ctx.body.username; 
  return { status: 'created', user: name };
});

// 5. Native Dynamic Parameters
app.get('/user/:id', (ctx) => {
  return { userId: ctx.params.id };
});

// 6. Hardware-Accelerated WebSockets
app.ws('/stream', {
  message(ws, msg) {
    ws.send(`BareJS Echo: ${msg}`);
  }
});

// 7. The Baking Phase
// app.listen() triggers JIT compilation of all routes
app.listen(3000);
console.log("BareJS is screaming on port 3000");

```

---

## 🔌 Advanced Deployment: BareJS JIT & Env

To achieve the benchmarked numbers, ensure you deploy using the BareJS optimized runtime environment variables.

| Variable | Description | Default |
| --- | --- | --- |
| `BARE_POOL_SIZE` | Sets the number of pre-allocated Context objects | 1024 |
| `NODE_ENV` | Set to `production` to enable full JIT optimizations | development |

**Deployment Command:**

```bash
BARE_POOL_SIZE=4096 bun run index.ts

```

---

## 🏗 Roadmap & Vision

* [x] Zero-Allocation Context Pooling
* [x] Bitwise Masking Optimization
* [x] JIT Route Compilation
* [x] Unified Export API (Typebox/Zod/Native)
* [ ] **Direct Buffer Response**: Aiming for 400ns latency by writing directly to the TCP stream.
* [ ] **Native Cluster Mode Support**: Automatic horizontal scaling across CPU cores.

---

**Maintained by [xarhang]** | **License: MIT**