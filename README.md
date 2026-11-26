<div align="center">
<br />
<h1>Bare<span style="color: #F7DF1E;">JS</span></h1>
<p><strong>The batteries-included web framework for Bun, Node.js, and Deno, engineered for minimal overhead.</strong></p>
<p><i>Built-in TypeBox, Zod &amp; JSON Schema validation, end-to-end RPC client inference, OpenAPI 3.1, WebSockets, SSE, Streaming Uploads, JSON-RPC 2.0, Cron, Resilience, and Zero-Trust Security — powered by a JIT-compiled O(1) radix router and LIFO context pooling.</i></p>

<p>
<a href="https://www.npmjs.com/package/barejs"><img src="https://img.shields.io/npm/v/barejs?style=for-the-badge&logo=npm&color=CB3837" alt="NPM Version"></a>
<a href="https://github.com/xarhang/bareJS/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/xarhang/bareJS/ci.yml?branch=main&label=CI&style=for-the-badge&logo=github" alt="CI"></a>
<a href="https://github.com/xarhang/bareJS/actions/workflows/bench.yml"><img src="https://img.shields.io/github/actions/workflow/status/xarhang/bareJS/bench.yml?branch=main&label=Benchmarks&style=for-the-badge&logo=github" alt="Benchmarks"></a>
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

- **O(1) JIT Router, Bun Native Routes & Pooling:** Compiles static routes into an inline `switch` fast-path and dynamic routes into a radix jump-table (`:params`, `*` wildcards, `BareRouter` sub-app mounting) with a lazy LIFO `Context` pool (`0..65536`) and dev-mode Use-After-Free Proxy guard. On Bun, `app.listen()` also offloads eligible middleware-free routes to `Bun.serve({ routes })` (with pure-static `Response` and `isTrulyZeroArg` fast-paths in `NODE_ENV=production`) while keeping full `fetch()` fallback parity.
- **Unified Schema Validation:** Declarative `body`, `query`, `params`, `headers`, and `response` schemas with **TypeBox**, **Zod**, or **Native JSON Schema** — including auto-coercion, `stripUnknown` Mass-Assignment protection, `413` `maxBodySize` guards, and automatic secret-field stripping.
- **End-to-End Type Safety:** `bareClient(app)` provides compile-time route, param, query, body, and response inference over HTTP or zero-network in-memory calls.
- **Batteries Included:** Auto-generated **OpenAPI 3.1** (with automatic `bearerAuth`/`basicAuth` security schemes) + Scalar UI (`app.docs`), **JSON-RPC 2.0** (`app.rpc`), **WebSockets** (`app.ws`), **SSE** (`ctx.sse`), **Streaming Uploads** (`ctx.upload` / `ctx.uploadStream`), **Compression** (`compress` — `zstd`/`br`/`gzip`), **Static Files** (`staticFile` with ETag/`304`/Range `206`/`spa: true`), `app.derive`, `app.cron`, `app.useLog({ format: 'json' })`, `onRequest`/`onResponse` hooks, `app.listenCluster()`, and `healthcheck`.
- **Zero-Trust Security & Resilience:** Built-in `bareAuth` (HS256/RS256/ES256/JWKS + `revokeToken`), `basicAuth`, `hasRole`, `Hash` (Argon2id/bcrypt/scrypt), HMAC-signed cookies, `trustProxy` CIDR/IP allowlist, `cors`, `csrf`, `rateLimit`, `idempotency`, `circuitBreaker`, `createSingleflight`, `timeout`, `redisStore`, and `app.onDrain`.
- **Multi-Runtime & Web Standard Interop:** Zero-dep native drivers for **Bun** (`Bun.serve({ routes })`), **Node.js >= 20** (`barejs/node` with built-in RFC 6455 WebSockets & `scrypt`, plus optional `uWebSockets.js` auto-detection with streaming backpressure & WS pub/sub), and **Deno >= 2.0** (`Deno.upgradeWebSocket`). Standard `Request`/`Response` (`ctx.req`) works directly with **Better-Auth**, **Auth0**, **Clerk**, **GraphQL Yoga**, **Sentry**, and **OpenTelemetry**.

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
# Zero-dep native WebSockets (RFC 6455) & scrypt hashing work out of the box!
# Optional peer dependencies only if you prefer `ws` or Argon2id:
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
| **Compression (`compress` — `gzip` / `br` / `zstd`)** | ✅ | ✅ (`gzip` / `br`, + `zstd` on Node >= 22.15) | ✅ (`gzip` / `br`) |
| **WebSockets (`app.ws`)** | ✅ Native | ✅ Native (RFC 6455) · Optional `ws` | ✅ Native (`Deno.upgradeWebSocket`) |
| **Password Hashing (`Hash`)** | ✅ Native (`Argon2id` / `bcrypt`) | ✅ Native (`scrypt`) · Optional `Argon2id` | ✅ Native (`scrypt`) · Optional `Argon2id` |

---

## Benchmarks (Bun)

Measured in-process on **Bun** with [`mitata`](https://github.com/evanwash/mitata) (`benchmarks/fair-suite.ts`). Bold values indicate a **mean** latency more than 10% faster than the runner-up; differences under ~10% vary between GitHub Actions runs and are left unbolded (treated as ties). These micro-benchmarks measure framework overhead rather than end-to-end network HTTP throughput, and do not represent Node.js or Deno latency.

<!-- MARKER: MULTI_BENCH_SUMMARY_START -->

| Scenario | **BareJS** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`1.46 µs`**<br><sub>`p99: 8.20 µs`</sub> | `1.87 µs`<br><sub>`p99: 8.44 µs`</sub> | `4.45 µs`<br><sub>`p99: 18.55 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`1.48 µs`**<br><sub>`p99: 8.21 µs`</sub> | `1.89 µs`<br><sub>`p99: 8.90 µs`</sub> | `4.13 µs`<br><sub>`p99: 14.78 µs`</sub> |
| **3. POST JSON + Schema Validation** | **`4.08 µs`**<br><sub>`p99: 14.60 µs`</sub> | `4.65 µs`<br><sub>`p99: 15.04 µs`</sub> | `5.28 µs`<br><sub>`p99: 18.34 µs`</sub> |
| **4. Async Handler + Query Parsing** | `2.34 µs`<br><sub>`p99: 10.40 µs`</sub> | `2.30 µs`<br><sub>`p99: 9.53 µs`</sub> | `3.17 µs`<br><sub>`p99: 13.02 µs`</sub> |

> Last Updated: 2026-11-26 (github action — `linux`, AMD EPYC 7763 64-Core Processor, Bun `1.4.5`, Elysia `1.4.21`, Hono `4.11.4`)

<!-- MARKER: MULTI_BENCH_SUMMARY_END -->

See **[BENCHMARKS.md](./BENCHMARKS.md)** for all 7 scenarios (including the SQLite Report scenario where Elysia is slightly faster, plus SQLite Write and response secret stripping), methodology, notes, and local reproduction steps, or view the [Continuous Benchmark Dashboard](https://xarhang.github.io/bareJS/dev/benchmarks/).

---

## Full Capabilities & Built-In Modules

BareJS is a complete, zero-boilerplate backend platform—every module below ships in the core package with TypeScript types:

| Category | Built-In Capabilities |
| :--- | :--- |
| **Core & Routing** | $O(1)$ static `switch` fast-path + radix jump-table (`:params`, `*` wildcards), `BareRouter` sub-app mounting (`app.route()`, `app.use(prefix, router)`), lazy bounded LIFO `Context` pool (`0..65536`), dev-mode Use-After-Free Proxy guard, `app.request()` in-memory test helper |
| **Validation & Serialization** | Unified `RouteSchemas` (`body`, `query`, `params`, `headers`, `response`, `maxBodySize`) supporting **TypeBox** (`Type`/`t`), **Zod** (`Z`/`z`), and **Native JSON Schema** (`native()`), automatic `number`/`integer`/`boolean`/repeated-array coercion, `413` streaming body limit, `stripUnknown` Mass-Assignment protection, recursive response secret-field stripping |
| **Type-Safe RPC & Docs** | End-to-end compile-time type inference via `bareClient(app \| url)`, automatic **OpenAPI 3.1** spec (`/docs/json`) + Scalar UI (`/docs`) with `securitySchemes` & `tags`, **JSON-RPC 2.0** (`app.rpc()` with single, batch & notifications) |
| **Zero-Trust Security** | `bareAuth()` (constant-time HS256 JWT + asymmetric RS256/ES256/JWKS + `revokeToken()`/`isRevoked`), `basicAuth()`, `hasRole()`, `Hash` (Argon2id/bcrypt on Bun; zero-dep `scrypt` fallback on Node/Deno), HMAC-SHA256 signed `HttpOnly` cookies, `cors()`, `csrf()`, `securityHeaders()`, `rateLimit()` (flood-resistant), `trustProxy(false)` |
| **Resilience & State** | `idempotency()` (`409 IDEMPOTENT_IN_FLIGHT` + `X-Idempotent-Replayed`, caller-scoped), `createSingleflight()` cache-stampede coalescing, `circuitBreaker()` (`503 Retry-After`), `timeout()` (`408`), pluggable `redisStore()` (`Bun.redis` / `ioredis`), overlap-safe `app.cron()` |
| **Real-Time, Files & Ops** | Parameterized WebSockets (`app.ws('/ws/:room')`), Server-Sent Events (`ctx.sse()`), `ctx.upload()` & $O(\text{chunk})$ streaming `ctx.uploadStream()`, `staticFile()` (ETag, `304`, Range `206`, LRU metadata cache), `compress()` (`zstd`/`br`/`gzip`), `logger()` (`pretty`/`json` + `X-Request-Id`), `healthcheck()` (`/health` + `/ready`), `app.onDrain()` + IPC `DRAIN_REQUEST` |
| **External Integrations** | Web Standard `ctx.req`/`Response` works out of the box with **Better-Auth**, **GraphQL Yoga**, **Auth0** (JWKS), **Clerk**, **Sentry**, and **OpenTelemetry** — see [docs/integrations.md](./docs/integrations.md) |

---

## Documentation

- **[Comprehensive Guide](./docs/guide.md)** — Validation & auto-coercion, cookies & uploads, security suite, `app.derive()`, WebSockets, SSE, JSON-RPC 2.0, OpenAPI 3.1, and `bareClient`.
- **[External Integrations](./docs/integrations.md)** — Ready-to-use recipes for Better-Auth, GraphQL Yoga, Auth0, Clerk, Sentry, and OpenTelemetry.
- **[API & Configuration Reference](./docs/reference.md)** — Complete `Context` (`ctx`) API table, `poolSize`, `bare.config.ts`, and `NODE_ENV` settings.
- **[Benchmarks](./BENCHMARKS.md)** — Full 7-scenario results and reproduction instructions.
- **[Security Policy](./SECURITY.md)** — Vulnerability reporting and security hardening guidelines.
- **[Changelog](./CHANGELOG.md)** — Release history and migration notes.
- **[`llms.txt`](./llms.txt)** — Token-efficient API reference for AI coding assistants (Cursor, Copilot, Claude, Windsurf).

---

## Status, Contributing & License

- **Status:** Active `0.1.x` development. The test suite is verified in [CI](./.github/workflows/ci.yml) across **Bun** (`bun test`), **Node.js 20 & 22** (`vitest run` + `tests/node-smoke.mjs`; Node 20 skips `production-db.test.ts` which requires `node:sqlite`), and **Deno 2** (`deno test` + `tests/deno-smoke.ts`; skips `playwright.test.ts` and `production-db.test.ts`).
- **Security:** See [SECURITY.md](./SECURITY.md) for reporting vulnerabilities.
- **Contributing:** See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and release workflows.
- **License:** [MIT](./LICENSE) — Maintained by [xarhang](https://github.com/xarhang).
