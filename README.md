---

# 🚀 BareJS

### The Sub-Microsecond JIT Web Engine for Bun

BareJS is a minimalist, ultra-high-performance web engine architected for the **Bun** ecosystem. By combining **Just-In-Time (JIT) Route Compilation** with a **Zero-Allocation Circular Context Pool**, BareJS achieves latency levels previously thought impossible for JavaScript—frequently breaking the **600ns** barrier.

---

## 🏛 Architectural Engineering: The "Nano-Core"

While other frameworks focus on features, BareJS focuses on **Mechanical Sympathy**—aligning software execution with how CPUs actually process data.

### 1. Zero-Allocation (Circular Context Pool)

Traditional frameworks create new objects for every request, triggering the Garbage Collector (GC). BareJS uses a pre-allocated pool of `Context` objects (default: 1024). When a request hits the server, the engine "resets" an existing object instead of creating a new one. **Result: Zero GC pressure.**

### 2. Double-Jump JIT Routing

BareJS transforms your route definitions into a **Static Jump Table**. For static routes, lookup is —a direct property access on a V8/JSC object. For dynamic routes, regex patterns are pre-compiled and cached during the boot phase.

### 3. Pre-Compiled Onion Pipeline

Middleware chains are not evaluated at runtime. Instead, they are recursively "baked" into a single, flat execution function during the `.compile()` phase.

---

## 📊 Performance Benchmarks (v0_fast_01)

Performance comparison conducted on **Bun v1.3.5** (Windows x64 / AMD Ryzen).

### 🚀 Latest Benchmark Results

<!-- MARKER: PERFORMANCE_TABLE_START -->

| Framework | Latency | Speed |
| :--- | :--- | :--- |
| **BareJS** | **595.16 ns** | **Baseline** |
| Elysia | 1.84 µs | 3.10x slower |
| Hono | 3.55 µs | 5.96x slower |

> Last Updated: Tue, 06 Jan 2026 16:03:09 GMT

<!-- MARKER: PERFORMANCE_TABLE_END -->

<!-- NOTE: The table above is automatically updated via scripts/update-readme.ts -->

---

## ⚡ Quick Start

```typescript
import { BareJS, type Context } from 'barejs';

const app = new BareJS();

// High-speed static route
app.get('/', () => ({ status: 'optimal', latency: '< 600ns' }));

// Dynamic route with context pooling
app.get('/user/:id', (ctx: Context) => {
  const id = ctx.params.id;
  return { id, timestamp: Date.now() };
});

app.listen(3000);

```

---

## 📖 Feature Manual

### 🛡️ Native Authentication (`bareAuth`)

Uses **Bun.crypto** (HMAC-SHA256) for hardware-accelerated signing. Much faster than standard JWT libraries.

```typescript
import { bareAuth, createToken } from 'barejs';

app.get('/admin', bareAuth('MY_SECRET'), (ctx) => {
  return { user: ctx.get('user') };
});

```

### 🧪 Schema Validation

BareJS supports JIT-compiled validation via **TypeBox**. This ensures that even with validation, your API remains significantly faster than rivals.

```typescript
import { typebox } from 'barejs';
import * as TB from '@sinclair/typebox';

const Schema = TB.Type.Object({
  id: TB.Type.Number()
});

app.post('/data', typebox(Schema), (ctx) => ctx.body);

```

### 🛰️ WebSockets

BareJS provides a native wrapper for Bun's high-speed WebSockets.

```typescript
app.ws('/chat', {
  message(ws, msg) {
    ws.send(`Echo: ${msg}`);
  }
});

```

---

## 🏗 Roadmap

* [x] **Zero-Allocation Context Pooling**
* [x] **JIT Static & Dynamic Routing**
* [x] **Native Auth (Bun.crypto)**
* [x] **WebSocket Support**
* [ ] **Auto-Generated Swagger/OpenAPI**
* [ ] **Buffer-Based Raw Responses** (Targeting 400ns)

---

**Maintained by [xarhang**](https://www.google.com/search?q=https://github.com/xarhang) **License: MIT**

---
