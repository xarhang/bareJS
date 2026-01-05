
# 🏁 BareJS (v0.1.0-alpha)

**The High-performance JIT-specialized web framework for Bun.** 🚀

BareJS isn't just another framework; it's a high-speed engine engineered to outpace the fastest tools in the Bun ecosystem by utilizing **Static Code Injection** and **Zero-Allocation** routing.

## 📊 Performance Benchmark
BareJS is designed for maximum throughput. In our latest head-to-head test against ElysiaJS:

| Framework | Requests/sec | Avg Latency |
|-----------|--------------|-------------|
| **BareJS** | **7,416** | **1,335ms** |
| ElysiaJS  | 4,760        | 2,001ms     |

> **Result:** BareJS is **55.79% FASTER** than the competition.

---

## 🚀 Quick Start

### 1. Installation
```bash
bun add barejs

```

### 2. Basic Usage

```typescript
import { BareJS } from "barejs";

const app = new BareJS();

// Global Middleware
app.use(async (ctx, next) => {
  const start = performance.now();
  await next();
  console.log(`Latency: ${performance.now() - start}ms`);
});

// Route with Auto-JSON Response
app.get("/", () => ({ status: "BareJS is flying!" }));

// Dynamic Route (Zero-Allocation)
app.get("/user/:id", (ctx) => {
  return `User ID: ${ctx.params.id}`;
});

app.listen(3000);

```

---

## 🧠 Why is it so fast?

1. **JIT-First Compilation:** Unlike traditional frameworks that loop through arrays, BareJS compiles your entire route and middleware stack into a single, flat JavaScript function at startup. This allows the **JavaScriptCore JIT** to inline everything.
2. **Zero-Allocation Routing:** We use a frozen `EMPTY_PARAMS` object for static routes, reducing Garbage Collection (GC) pressure to nearly zero.
3. **Hyper-light Context:** The `ctx` object is kept minimal to ensure it stays within the CPU's L1/L2 cache during execution.

---

## 🧩 Plugin System

BareJS supports a modular architecture. You can extend it easily:

```typescript
const myPlugin = {
  name: 'my-plugin',
  setup: (app) => {
    app.use(async (ctx, next) => {
      ctx.customValue = "Hello";
      await next();
    });
  }
};

app.register(myPlugin);

```
