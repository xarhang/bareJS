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
| **BareJS** | **1636.94 ns/iter** | **Baseline (1.0x)** |
| Elysia | 2125.70 ns/iter | 1.30x slower |
| Hono | 4148.99 ns/iter | 2.53x slower |
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
import { BareJS, type Context, typebox } from 'barejs';
import * as TB from '@sinclair/typebox';

const app = new BareJS();

// Create Schema with TypeBox
const UserSchema = TB.Type.Object({
  name: TB.Type.String(),
  age: TB.Type.Number()
});

// ✅ Route 1: Using TypeBox Validator (Fastest for Bun)
app.post('/users-tb', typebox(UserSchema), (ctx: Context) => {
  return ctx.json({ message: "Saved via TypeBox", user: ctx.body });
});


// ✅ Route 2: Using Native Validator (Safe alternative if TypeBox has issues)
app.post('/users-native', native(UserSchema), (ctx: Context) => {
  return ctx.json({ message: "Saved via Native", user: ctx.body });
});

// ✅ Route 3: No Validator (Pure speed, 0 ns overhead)
app.get('/ping', (ctx: Context) => ctx.json({ message: "pong" }));
// Dynamic Path
app.get('/user/:id', (ctx: Context) => {
  const userId = ctx.params.id;
  return ctx.json({ user: userId, status: 'active' });
});

// Multiple Params
app.get('/post/:category/:id', (ctx: Context) => {
  return ctx.json(ctx.params); // { category: 'tech', id: '1' }
});


app.listen('0.0.0.0', 3000);

```
---

## 📖 Manual & Documentation

### 1. Request Context (`ctx`)

Every handler receives a `Context` object, providing a high-speed interface to the request:

* `ctx.req`: The Native Bun Request.
* `ctx.json(data)`: High-speed JSON helper with pre-defined headers.
* `ctx.params`: Object containing route parameters (e.g., { id: "123" }).
* `ctx.body`: Validated payload (populated by typebox, zod, or native).
* `ctx.status(code)`: Chainable status setter (e.g., ctx.status(201).json(...)).
* `ctx.setResHeader(key, value)`: Direct response header manipulation.

### 2. Middleware (The Onion Model)

BareJS supports an asynchronous recursive pipeline, allowing you to wrap logic before and after the handler. Using Context from the main package ensures full type safety.

```typescript
import { type Context, type Next } from 'barejs';

app.use(async (ctx: Context, next: Next) => {
  const start = performance.now();
  
  const response = await next(); // Proceed to next middleware or handler
  
  const duration = (performance.now() - start).toFixed(2);
  console.log(`Latency: ${duration}ms`);
  
  return response;
});

```

### 3. Full Plugin System

Encapsulate complex logic into reusable modules. Plugins have direct access to the BareJS instance during the installation phase.

```typescript
import { type Context, type Next, type BareJS } from 'barejs';

const databasePlugin = {
  name: 'barejs-db',
  version: '1.0.0',
  install: (app: BareJS) => {
    app.use(async (ctx: Context, next: Next) => {
      ctx.db = "CONNECTED"; // Attach custom properties to context
      return await next();
    });
  }
};

app.use(databasePlugin);

```

### 4. Native WebSocket Support (MAX Speed)

BareJS leverages Bun's native WebSocket implementation, allowing you to handle real-time binary and text streams with minimal overhead.

```typescript
import { BareJS } from 'barejs';

const app = new BareJS();

app.ws('/chat', {
  open: (ws) => console.log('Client connected!'),
  message: (ws, msg) => {
    ws.send(`Echo: ${msg}`);
  },
  close: (ws, code, reason) => console.log('Closed')
});

app.listen();

```

---

## 🛡️ Schema Validation

BareJS allows you to use different validators for different routes, focusing on high-speed schema checks.

```typescript
import { BareJS, typebox, zod, native, type Context } from 'barejs';
import { Type } from '@sinclair/typebox';
import { z } from 'zod';

const app = new BareJS();

// 🚀 Tier 1: High Performance (TypeBox)
// Best for Bun. Compiled JIT validation.
const UserSchema = Type.Object({ name: Type.String() });
app.post('/tb', typebox(UserSchema), (ctx: Context) => ctx.json(ctx.body));

// 💎 Tier 2: Popular Choice (Zod)
// Flexible and feature-rich.
const ZodSchema = z.object({ age: z.number() });
app.post('/zod', zod(ZodSchema), (ctx: Context) => ctx.json(ctx.body));

// 🍃 Tier 3: Zero Dependency (Native)
// Extremely lightweight. Uses built-in typeof checks.
app.post('/native', native({ properties: { id: { type: 'number' } } }), (ctx: Context) => {
  return ctx.json(ctx.body);
});

```

---

## 🏗 Roadmap

* [x] **Middleware Support**: Async/Await "Onion" execution chain.
* [x] **JIT Static Routing**:  lookup via compiled static maps.
* [x] **Validation Integration**: Support for TypeBox, Zod, and Native JSON.
* [x] **Full Plugin System**: Modular extensibility with zero overhead.
* [x] **Dynamic Path JIT**: Compiled Regex for parameterized routes (e.g., `/user/:id`).
* [x] **Native WebSocket Support**: High-speed binary streaming.

---

## 💎 Credits & Dependencies

* **[Bun](https://bun.sh/)**: The foundational runtime for BareJS.
* **[TypeBox](https://github.com/sinclairzx81/typebox)** & **[Zod](https://zod.dev/)**: For high-speed type safety.
* **Inspiration**: Architectural patterns from **Koa** and **ElysiaJS**.

**Maintained by [xarhang**](https://www.google.com/search?q=https://github.com/xarhang)
**License: MIT**
```