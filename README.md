# 🚀 BareJS
BareJS is an ultra-high-performance web engine built on the Bun runtime, designed for minimalism and the lowest possible latency.

![Benchmark Status](https://github.com/xarhang/bareJS/actions/workflows/bench.yml/badge.svg)
[![Performance Dashboard](https://img.shields.io/badge/Performance-Dashboard-blueviolet?style=flat-square&logo=speedtest)](https://xarhang.github.io/bareJS/dev/benchmarks/)
[![Bun Version](https://img.shields.io/badge/Bun-%3E%3D1.0.0-black?style=flat-square&logo=bun)](https://bun.sh)

---

## 📊 Performance Benchmarks

Performance comparison between **BareJS**, **Elysia**, and **Hono**.

### 🚀 Latest Benchmark Results
*Awaiting automated update...*

<!-- MARKER: PERFORMANCE_TABLE_START -->
| Framework | Latency (Avg) | Speed Ratio |
| :--- | :--- | :--- |
| **BareJS (Your Engine)** | **-- ns/iter** | **Baseline (1.0x)** |
| Elysia | -- ns/iter | --x slower |
| Hono | -- ns/iter | --x slower |
<!-- MARKER: PERFORMANCE_TABLE_END -->

<!-- NOTE: The table above is automatically updated via scripts/update-readme.ts -->

---

✨ **Features**

* **Ultra Low Latency:** Optimized to minimize processing overhead.
* **Zero Dependency:** Built natively for security and raw speed.
* **Optimized for Bun:** Leverages native Bun APIs for maximum performance.
* **Memory Efficient:** Minimal heap usage and clean garbage collection.

---

## 📖 Documentation

### ⚡ The Core Engine

BareJS uses a **Static Route Compiler**. When you call `app.listen()`, BareJS transforms your routes into an optimized lookup table. This ensures  routing complexity, meaning your app stays fast whether you have 10 routes or 10,000.

### 🏗️ Request Context

Every handler receives a `Context` object:

* `ctx.req`: The native Bun `Request`.
* `ctx.params`: Route parameters (e.g., `/user/:id`).
* `ctx.json(data)`: High-speed JSON response helper.
* `ctx.body`: The validated JSON payload (available when using validators).

---

## 🛠 Usage Examples

### 1. Basic Server

```typescript
import { BareJS } from 'barejs';

const app = new BareJS();

app.get('/ping', (ctx) => ctx.json({ message: 'pong' }));

app.listen('0.0.0.0', 3000);

```

### 2. Validation (Choose Your Weapon)

BareJS allows you to use different validators for different routes.

```typescript
import { BareJS } from 'barejs';
import { typebox, zod, native } from 'barejs/middleware';
import { Type } from '@sinclair/typebox';
import { z } from 'zod';

const app = new BareJS();

// High Performance: TypeBox
const UserSchema = Type.Object({ name: Type.String() });
app.post('/tb', typebox(UserSchema), (ctx) => ctx.json(ctx.body));

// Popular Choice: Zod
const ZodSchema = z.object({ age: z.number() });
app.post('/zod', zod(ZodSchema), (ctx) => ctx.json(ctx.body));

// No Dependencies: Native
app.post('/native', native({ properties: { id: { type: 'number' } } }), (ctx) => ctx.json(ctx.body));

```

---

## 🛠 Getting Started

### Prerequisites

* **Bun** v1.0.0 or higher

### Installation

```bash
bun install barejs

```

### Running Benchmarks Locally

```bash
bun run bench

```

## 🏗 Roadmap

* [x] Middleware Pattern Support (Chain Execution)
* [x] High-Speed Static Routing ( Lookup Table)
* [x] Schema Validation Integration
* [x] Modular Validator Support (TypeBox, Zod, Native)
* [ ] Full Plugin System

**Maintained by xarhang**

---