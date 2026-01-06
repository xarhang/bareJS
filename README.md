# 🚀 BareJS
### The Ultra-Low Latency JIT Web Engine for Bun

BareJS is a minimalist, high-performance web engine architected for the **Bun** ecosystem. By utilizing a **Just-In-Time (JIT) Route Compilation** strategy and an asynchronous **Onion-Model** pipeline, BareJS achieves near-native throughput, outperforming traditional frameworks by eliminating runtime routing overhead.

---

## 🏛 Architectural Engineering

Unlike traditional frameworks that iterate through arrays or regex patterns on every request, BareJS utilizes a **Static Compilation Phase**.

### The JIT Lifecycle

When `app.listen()` is invoked, the engine:

1. **Analyzes** the complete route tree and global middleware stack.
2. **Serializes** the execution logic into a flat, optimized JavaScript function.
3. **Binds** the function using `new Function()`, allowing the **JavaScriptCore (JSC)** engine to perform aggressive inline caching and speculative optimizations.

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

## 📦 Installation

```bash
bun add barejs

```

---

## ⚡ Quick Start (All-in-One)

BareJS provides everything you need in a single entry point. No more messy imports.

```typescript
import { 
  BareJS, 
  typebox, 
  logger, 
  cors, 
  staticFile, 
  bareAuth, 
  type Context 
} from 'barejs';
import * as TB from '@sinclair/typebox';

const app = new BareJS();

// 1. Global Middlewares
app.use(logger); // Beautiful terminal logs
app.use(cors());   // Enable CORS for all origins
app.use(staticFile('public')); // Serve images/css from /public

// 2. Schema Validation (TypeBox)
const UserSchema = TB.Type.Object({
  name: TB.Type.String(),
  age: TB.Type.Number()
});

// 3. Protected Route with Native Auth (Bun.crypto)
app.get('/admin', bareAuth('MY_SECRET'), (ctx: Context) => {
  return ctx.json({ 
    message: "Welcome Admin", 
    user: ctx.get('user') 
  });
});

// 4. Standard Route
app.post('/users', typebox(UserSchema), (ctx: Context) => {
  return ctx.status(201).json({ 
    message: "User Created", 
    data: ctx.body 
  });
});

app.listen(3000);

```

---

## 📖 Deep Dive: Full Option Manual

### 1. Essential Middlewares

BareJS comes with built-in high-performance middlewares:

* **`logger`**: Prints colored logs with response time (ms).
* **`cors(options?)`**: Configurable CORS headers.
* **`staticFile(root)`**: High-speed static file serving using `Bun.file()` (Zero-copy).

### 2. Native Authentication (`bareAuth`)

No need for `jsonwebtoken` or `jose`. BareJS uses **Bun's Native Crypto API** for signing and verifying tokens.

```typescript
import { bareAuth, createToken } from 'barejs';

// Generate a token (e.g., in a login route)
const token = await createToken({ id: 1, role: 'admin' }, 'SECRET_KEY');

// Protect routes
app.get('/secure', bareAuth('SECRET_KEY'), (ctx) => {
  const user = ctx.get('user'); // Access decoded payload
  return { hello: user.role };
});

```

### 3. Schema Validation Tiers

Choose the validator that fits your needs. `typebox` is recommended for maximum performance.

```typescript
import { typebox, zod, native } from 'barejs';

app.post('/tb', typebox(Schema), handler); // JIT-Compiled (Fastest)
app.post('/zod', zod(ZodSchema), handler); // Industry Standard
app.post('/native', native(Schema), handler); // Zero dependencies

```

### 4. Direct Response Control

BareJS context provides a chainable and intuitive API:

```typescript
app.get('/custom', (ctx) => {
  ctx.setResHeader('X-Powered-By', 'BareJS');
  return ctx.status(418).json({ message: "I'm a teapot" });
});

```

---

## 🏗 Roadmap

* [x] **Middleware Onion Model**: Async execution chain.
* [x] **JIT Static Routing**: Zero-overhead route lookup.
* [x] **Native Auth**: HMAC-SHA256 signing via Bun.crypto.
* [x] **Zero-Copy Static Server**: Direct `sendfile` via Bun.file.
* [x] **Full Plugin System**: Modular extensibility.
* [ ] **Auto-Generated Swagger**: OpenAPI documentation support.
* [ ] **Native Database Drivers**: Optimized Drizzle/Prisma integration.

---

## 💎 Credits & Dependencies

* **[Bun](https://bun.sh/)**: The foundational runtime.
* **[TypeBox](https://github.com/sinclairzx81/typebox)**: High-speed validation.
* **[Inspiration]**: Architectural patterns from **Koa** and **ElysiaJS**.

**Maintained by [xarhang**](https://www.google.com/search?q=https://github.com/xarhang)
**License: MIT**

---