<div align="center">
<br />
<h1>Bare<span style="color: #F7DF1E;">JS</span></h1>
<p><strong>The batteries-included web framework for Bun, Node.js, and Deno, engineered for minimal overhead.</strong></p>
<p><i>Built-in TypeBox &amp; Zod validation, end-to-end RPC client inference, OpenAPI 3.1, WebSockets, JSON-RPC 2.0, and zero-trust security — powered by a JIT-compiled O(1) radix router and LIFO context pooling.</i></p>

<p>
<a href="https://www.npmjs.com/package/barejs"><img src="https://img.shields.io/npm/v/barejs?style=for-the-badge&logo=npm&color=CB3837" alt="NPM Version"></a>
<a href="https://github.com/xarhang/bareJS/actions/workflows/bench.yml"><img src="https://img.shields.io/github/actions/workflow/status/xarhang/bareJS/bench.yml?branch=main&label=CI%20%26%20Bench&style=for-the-badge&logo=github" alt="CI & Benchmarks"></a>
<a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-%3E%3D1.1.0-black?style=for-the-badge&logo=bun" alt="Bun"></a>
<a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?style=for-the-badge&logo=nodedotjs" alt="Node.js"></a>
<a href="https://deno.com"><img src="https://img.shields.io/badge/Deno-%3E%3D2.0-000000?style=for-the-badge&logo=deno" alt="Deno"></a>
<a href="https://github.com/xarhang/bareJS/blob/main/LICENSE"><img src="https://img.shields.io/github/license/xarhang/bareJS?style=for-the-badge&color=blue" alt="License"></a>
</p>
</div>

---

```typescript
import { BareJS, Type, type Context } from 'barejs';

const app = new BareJS();

app.get('/', () => ({ hello: 'world' }));

app.post('/orders/:id', {
  params: Type.Object({ id: Type.Integer() }),
  body: Type.Object({ item: Type.String({ minLength: 1 }), qty: Type.Integer({ minimum: 1 }) }),
  response: Type.Object({ id: Type.Number(), item: Type.String(), qty: Type.Number() })
}, (ctx: Context) => ({ id: ctx.params.id, ...ctx.body, internal_cost: 9999 })); // internal_cost is stripped

app.listen(3000);
```

---

## Why BareJS?

- **O(1) JIT Router & Pooling:** Compiles static routes into an inline `switch` fast-path and dynamic routes into a radix jump-table with a lazy LIFO `Context` pool (`0..65536`) and dev-mode Use-After-Free Proxy guard.
- **Unified Schema Validation:** Declarative `body`, `query`, `params`, `headers`, and `response` schemas with **TypeBox**, **Zod**, or **Native JSON Schema** — including auto-coercion, `413` `maxBodySize` guards, and automatic secret-field stripping.
- **End-to-End Type Safety:** `bareClient(app)` provides compile-time route, param, query, body, and response inference over HTTP or zero-network in-memory calls.
- **Batteries Included:** Auto-generated **OpenAPI 3.1** + Scalar UI (`app.docs`), **JSON-RPC 2.0** (`app.rpc`), **WebSockets** (`app.ws`), **SSE** (`ctx.sse`), **Compression** (`compress`), and **Static Files** (`staticFile`).
- **Zero-Trust Security & Resilience:** Built-in `bareAuth` (HS256/RS256/ES256/JWKS), `Hash` (Argon2id/bcrypt), HMAC-signed cookies, `cors`, `csrf`, `rateLimit`, `idempotency`, `circuitBreaker`, `createSingleflight`, and `app.onDrain`.
- **Multi-Runtime:** Startup driver selection (`bunDriver` / `nodeDriver`) keeps Bun native performance untouched while running the same app on Node.js (`>=20`) and Deno (`>=2.0`).

---

## Installation & Quick Start

<details open>
<summary><strong>Bun (&gt;= 1.1.0)</strong></summary>

```bash
bun add barejs
```

```typescript
import { BareJS } from 'barejs';

const app = new BareJS();
app.get('/', () => ({ runtime: 'bun' }));
app.listen(3000);
```

</details>

<details>
<summary><strong>Node.js (&gt;= 20.0.0)</strong></summary>

```bash
npm install barejs
# Optional peer dependencies if using WebSockets or password hashing:
npm install ws @node-rs/argon2
```

```typescript
import { BareJS } from 'barejs/node';

const app = new BareJS();
app.get('/', () => ({ runtime: 'node' }));
app.listen(3000);
```

</details>

<details>
<summary><strong>Deno (&gt;= 2.0)</strong></summary>

```bash
deno add npm:barejs
```

```typescript
import { BareJS } from 'barejs';

const app = new BareJS();
app.get('/', () => ({ runtime: 'deno' }));
Deno.serve({ port: 3000 }, (req, info) => app.fetch(req, info.remoteAddr.hostname));
```

</details>

---

## Runtime Support

| Feature | Bun (`barejs`) | Node.js >= 20 (`barejs/node`) | Deno (`app.fetch`) |
| :--- | :---: | :---: | :---: |
| **Router, Validation, OpenAPI, JSON-RPC, `bareClient`** | ✅ | ✅ | ✅ |
| **Security Middlewares (`cors`, `csrf`, `rateLimit`, `bareAuth`, `idempotency`)** | ✅ | ✅ | ✅ |
| **Streaming (`ctx.sse`, `ctx.upload`, `ctx.uploadStream`)** | ✅ | ✅ | ✅ |
| **Static Files (`staticFile`)** | ✅ | ✅ | ✅ |
| **Compression (`compress` — `gzip` / `br` / `zstd`)** | ✅ | ✅ (`gzip` / `br`) | ✅ (`gzip` / `br`) |
| **WebSockets (`app.ws`)** | ✅ Native | ⚠️ Requires `ws` | ✅ Native (`Deno.upgradeWebSocket`) |
| **Password Hashing (`Hash`)** | ✅ Native (`Argon2id` / `bcrypt`) | ✅ Native (`scrypt`) · Optional `Argon2id` | ✅ Native (`scrypt`) · Optional `Argon2id` |

---

## Benchmarks (Bun)

Measured in-process on **Bun** with [`mitata`](https://github.com/evanwash/mitata) (`benchmarks/fair-suite.ts`). Bold values indicate the fastest **mean** latency. These micro-benchmarks measure framework overhead rather than end-to-end network HTTP throughput, and do not represent Node.js or Deno latency.

<!-- MARKER: MULTI_BENCH_SUMMARY_START -->

| Scenario | **BareJS** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`1.71 µs`**<br><sub>`p99: 10.38 µs`</sub> | `2.08 µs`<br><sub>`p99: 10.00 µs`</sub> | `4.57 µs`<br><sub>`p99: 18.29 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`1.68 µs`**<br><sub>`p99: 8.94 µs`</sub> | `2.42 µs`<br><sub>`p99: 11.72 µs`</sub> | `4.61 µs`<br><sub>`p99: 19.55 µs`</sub> |
| **3. POST JSON + Schema Validation** | **`5.39 µs`**<br><sub>`p99: 20.60 µs`</sub> | `5.76 µs`<br><sub>`p99: 18.14 µs`</sub> | `5.65 µs`<br><sub>`p99: 20.73 µs`</sub> |
| **4. Async Handler + Query Parsing** | **`2.56 µs`**<br><sub>`p99: 11.55 µs`</sub> | `2.75 µs`<br><sub>`p99: 12.13 µs`</sub> | `3.63 µs`<br><sub>`p99: 13.92 µs`</sub> |

> Last Updated: 2026-11-24 (github action — `linux`, AMD EPYC 7763 64-Core Processor, Bun `1.4.5`, Elysia `1.4.21`, Hono `4.11.4`)

<!-- MARKER: MULTI_BENCH_SUMMARY_END -->

See **[BENCHMARKS.md](./BENCHMARKS.md)** for all 7 scenarios (including SQLite read/write and response secret stripping), methodology, notes, and local reproduction steps, or view the [Continuous Benchmark Dashboard](https://xarhang.github.io/bareJS/dev/benchmarks/).

---

## Documentation

- **[Comprehensive Guide](./docs/guide.md)** — Validation & auto-coercion, cookies & uploads, security suite, `app.derive()`, WebSockets, SSE, JSON-RPC 2.0, OpenAPI 3.1, and `bareClient`.
- **[API & Configuration Reference](./docs/reference.md)** — Complete `Context` (`ctx`) API table, `poolSize`, `bare.config.ts`, and `NODE_ENV` settings.
- **[Benchmarks](./BENCHMARKS.md)** — Full 7-scenario results and reproduction instructions.
- **[Changelog](./CHANGELOG.md)** — Release history and migration notes.
- **[`llms.txt`](./llms.txt)** — Token-efficient API reference for AI coding assistants (Cursor, Copilot, Claude, Windsurf).

---

## Status, Contributing & License

- **Status:** Active `0.1.x` development. Core HTTP routing, validation, security middlewares, and Bun runtime APIs are stable and verified in CI (`bun test`); the Node.js and Deno runtime drivers (`barejs/node`) are newly introduced in `v0.1.59`.
- **Contributing:** See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and release workflows.
- **License:** [MIT](./LICENSE) — Maintained by [xarhang](https://github.com/xarhang).
