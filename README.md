# 🚀 BareJS
### The Ultra-Low Latency JIT Web Engine for Bun

BareJS is a minimalist, high-performance web engine architected for the **Bun** ecosystem. By utilizing a **Just-In-Time (JIT) Route Compilation** strategy and an asynchronous **Onion-Model** pipeline, BareJS achieves near-native throughput, outperforming traditional frameworks by eliminating runtime routing overhead.

![Benchmark Status](https://github.com/xarhang/bareJS/actions/workflows/bench.yml/badge.svg)
[![Performance Dashboard](https://img.shields.io/badge/Performance-Dashboard-blueviolet?style=flat-square&logo=speedtest)](https://xarhang.github.io/bareJS/dev/benchmarks/)
[![Bun Version](https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?style=flat-square&logo=bun)](https://bun.sh)
[![NPM Version](https://img.shields.io/npm/v/barejs.svg?style=flat-square)](https://www.npmjs.com/package/barejs)

---

## 🏛 Architectural Engineering

Unlike traditional frameworks that iterate through arrays or regex patterns on every request, BareJS utilizes a **Static Compilation Phase**.



### The JIT Lifecycle
When `app.listen()` is invoked, the engine:
1. **Analyzes** the complete route tree and global middleware stack.
2. **Serializes** the execution logic into a flat, optimized JavaScript function.
3. **Binds** the function using `new Function()`, allowing the **JavaScriptCore (JSC)** engine to perform aggressive inline caching and speculative optimizations.

---

---

## 📊 Performance Benchmarks

Performance comparison between **BareJS**, **Elysia**, and **Hono**.

### 🚀 Latest Benchmark Results
*Awaiting automated update...*

<!-- MARKER: PERFORMANCE_TABLE_START -->
| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS** | **-- ns/iter** | **Baseline (1.0x)** |
| Elysia | -- ns/iter | --x slower |
| Hono | -- ns/iter | --x slower |
<!-- MARKER: PERFORMANCE_TABLE_END -->

<!-- NOTE: The table above is automatically updated via scripts/update-readme.ts -->

---


### ✨ **Features**

* **Ultra Low Latency:** Optimized to minimize processing overhead.
* **Zero Dependency:** Built natively for security and raw speed.
* **Optimized for Bun:** Leverages native Bun APIs for maximum performance.
* **Memory Efficient:** Minimal heap usage and clean garbage collection.

---

## 📦 Installation

```bash
bun add barejs
```

---

## ⚡ Quick Start

Create an `index.ts` and get your server running in seconds:

```typescript
import { BareJS } from 'barejs';

const app = new BareJS();

// Simple Route
app.get('/ping', (ctx) => ctx.json({ message: 'pong' }));

// Start Server
app.listen('0.0.0.0', 3000);

```
---

## 📖 Manual & Documentation

### 1. Request Context (`ctx`)

Every handler receives a `Context` object, providing a high-speed interface to the request:

* `ctx.req`: The [Native Bun Request](https://www.google.com/search?q=https://bun.sh/docs/api/http%23request).
* `ctx.json(data)`: Optimized JSON response helper with pre-defined headers.
* `ctx.body`: The validated JSON payload (available when using validators).
* `ctx.params`: Route parameters (e.g., `/user/:id`).

### 2. Middleware (The Onion Model)

BareJS supports an asynchronous recursive pipeline, allowing you to wrap logic before and after the handler.

```typescript
app.use(async (ctx, next) => {
  const start = performance.now();
  const response = await next(); // Proceed to next middleware or handler
  console.log(`Latency: ${(performance.now() - start).toFixed(2)}ms`);
  return response;
});

```

### 3. Full Plugin System

Encapsulate complex logic into reusable modules that plug directly into the engine lifecycle.

```typescript
const databasePlugin = {
  name: 'barejs-db',
  version: '1.0.0',
  install: (app: BareJS) => {
    app.use(async (ctx, next) => {
      ctx.db = "CONNECTED";
      return await next();
    });
  }
};

app.use(databasePlugin);

```

---

## 🛡️ Schema Validation

BareJS allows you to use different validators for different routes, focusing on high-speed schema checks.

```typescript
import { typebox, zod, native } from 'barejs/middleware';
import { Type } from '@sinclair/typebox';
import { z } from 'zod';

// High Performance: TypeBox
const UserSchema = Type.Object({ name: Type.String() });
app.post('/tb', typebox(UserSchema), (ctx) => ctx.json(ctx.body));

// Popular Choice: Zod
const ZodSchema = z.object({ age: z.number() });
app.post('/zod', zod(ZodSchema), (ctx) => ctx.json(ctx.body));

// Zero Dependency: Native
app.post('/native', native({ properties: { id: { type: 'number' } } }), (ctx) => ctx.json(ctx.body));

```

---

## 🏗 Roadmap

* [x] **Middleware Support**: Async/Await "Onion" execution chain.
* [x] **JIT Static Routing**:  lookup via compiled static maps.
* [x] **Validation Integration**: Support for TypeBox, Zod, and Native JSON.
* [x] **Full Plugin System**: Modular extensibility with zero overhead.
* [x] **Dynamic Path JIT**: Compiled Regex for parameterized routes (e.g., `/user/:id`).
* [ ] **Native WebSocket Support**: High-speed binary streaming.

---

## 💎 Credits & Dependencies

* **[Bun](https://bun.sh/)**: The foundational runtime for BareJS.
* **[TypeBox](https://github.com/sinclairzx81/typebox)** & **[Zod](https://zod.dev/)**: For high-speed type safety.
* **Inspiration**: Architectural patterns from **Koa** and **ElysiaJS**.

**Maintained by [xarhang**](https://www.google.com/search?q=https://github.com/xarhang)
**License: MIT**
```