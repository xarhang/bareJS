# BareJS Benchmarks

All numbers below are measured with [`mitata`](https://github.com/evanwash/mitata) on **Bun** using [`benchmarks/fair-suite.ts`](./benchmarks/fair-suite.ts) and [`benchmarks/production-bench.ts`](./benchmarks/production-bench.ts).

> **Scope & Limitations:** These are in-process micro-benchmarks of framework routing, middleware, validation, and serialization overhead (`app.fetch(req)` / `app.handle(req)`), **not** end-to-end network HTTP throughput. GitHub Actions shared runners (`ubuntu-latest`) also have higher variance than dedicated bare-metal hardware. Node.js and Deno use the `nodeDriver` / Web-Standard `fetch` path and will have different latency profiles.

---

## Full 7-Scenario Results (Bun)

Bold values indicate a **mean** latency more than 10% faster than the runner-up; differences within ~10% vary between GitHub Actions runs and are unbolded (treated as ties).

<!-- MARKER: MULTI_BENCH_START -->

| Scenario | **BareJS** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`581 ns`**<br><sub>`p99: 3.17 µs`</sub> | `838 ns`<br><sub>`p99: 3.78 µs`</sub> | `1.80 µs`<br><sub>`p99: 7.25 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`543 ns`**<br><sub>`p99: 2.66 µs`</sub> | `824 ns`<br><sub>`p99: 3.60 µs`</sub> | `2.05 µs`<br><sub>`p99: 7.38 µs`</sub> |
| **3. POST JSON + Schema Validation** | **`1.71 µs`**<br><sub>`p99: 7.02 µs`</sub> | `2.06 µs`<br><sub>`p99: 7.48 µs`</sub> | `2.10 µs`<br><sub>`p99: 8.00 µs`</sub> |
| **4. Async Handler + Query Parsing** | **`917 ns`**<br><sub>`p99: 3.42 µs`</sub> | `1.01 µs`<br><sub>`p99: 3.61 µs`</sub> | `1.05 µs`<br><sub>`p99: 1.55 µs`</sub> |
| **5. Response Schema Secret Stripping** | **`479 ns`**<br><sub>`p99: 2.44 µs`</sub> | `729 ns`<br><sub>`p99: 3.05 µs`</sub> | — |
| **6. SQLite Report (`SUM`/`AVG`/`GROUP BY`)** | `13.42 µs`<br><sub>`p99: 13.67 µs`</sub> | `13.59 µs`<br><sub>`p99: 13.76 µs`</sub> | `15.90 µs`<br><sub>`p99: 17.21 µs`</sub> |
| **7. SQLite Write (`POST` + Validate + `INSERT`)** | **`4.92 µs`**<br><sub>`p99: 5.24 µs`</sub> | `5.84 µs`<br><sub>`p99: 7.09 µs`</sub> | `7.11 µs`<br><sub>`p99: 7.27 µs`</sub> |

> Last Updated: 2026-11-26 (github action — `linux`, Intel(R) Xeon(R) 6973P-C, Bun `1.4.5`, Elysia `1.4.21`, Hono `4.11.4`)

<!-- MARKER: MULTI_BENCH_END -->

### Notes on the Results & Where Competitors Are Faster or Tied
- **Variance & Ties (< 10%):** Shared CI runners exhibit up to ~10% run-to-run variance on micro-benchmarks. Any unbolded row is within the 10% threshold and should be treated as a tie.
- **Where Elysia Is Faster or Tied:** In **Scenario 6 (SQLite Report)**, SQLite aggregation time dominates framework overhead so Elysia and BareJS are effectively tied (and Elysia often leads slightly on mean). On individual runs, Elysia can also show lower `p99` tail latency in routing/stripping scenarios or tie within variance on **Scenario 4 (Async Handler + Query Parsing)**.
- **Scenario 5 (`—` for Hono):** Hono does not ship built-in response schema filtering / secret-field stripping out of the box, so it is omitted (`—`) in this scenario.
- **Single-Run Consistency & Verification:** All three frameworks are benchmarked in the same process inside [`benchmarks/fair-suite.ts`](./benchmarks/fair-suite.ts) and [`benchmarks/production-bench.ts`](./benchmarks/production-bench.ts) using identical fresh `Request` objects, with pre-flight 200 status checks and post-run SQLite `INSERT` row-count verification.

---

## Scenario Descriptions

1. **100 Routes + Dynamic Params (`fair-suite.ts`)**: Registers 100 parameterized routes (`/api/v1/resource{i}/:id/sub/:subId`) and dispatches to route #77. Tests radix/router scaling.
2. **10 Middlewares + Deep Path (`fair-suite.ts`)**: Chains 10 pass-through middlewares before a parameterized route (`/api/v1/user/:id/profile/settings/:category`).
3. **POST JSON + Schema Validation (`fair-suite.ts`)**: Sends a fresh `POST /users` JSON `Request` and validates `{ name: string, age: number }` (TypeBox on BareJS/Elysia, manual type checks on Hono).
4. **Async Handler + Query Parsing (`fair-suite.ts`)**: Async handler parsing multiple query parameters (`?page=2&limit=25&sort=desc`).
5. **Response Schema Secret Stripping (`fair-suite.ts`)**: Returns an object containing undeclared internal fields (`password_hash`, `internal_secret`) and strips them via the declared response schema.
6. **SQLite Report (`production-bench.ts`)**: In-memory `bun:sqlite` `SUM`/`AVG`/`GROUP BY` aggregation query.
7. **SQLite Write (`production-bench.ts`)**: `POST` JSON validation + parameterized `INSERT` into `bun:sqlite`.

---

## Reproducing Locally

```bash
bun install
bun run benchmarks/fair-suite.ts
bun run benchmarks/production-bench.ts
```

---

## End-to-End HTTP Throughput (`v0.2.1` — `Bun.serve({ routes })` & Optional `uWebSockets.js`)

Measured on the same Linux x64 cloud VM (single process, 32 concurrent HTTP/1.1 keep-alive connections, 16-request pipeline, `NODE_ENV=production`):

| Endpoint | **BareJS `0.2.1` (Bun)** | Elysia `1.4.32` (Bun) | **BareJS `0.2.1` (Node + uWS)** | Fulmine.js (Node + uWS) |
| :--- | ---: | ---: | ---: | ---: |
| `GET /ping` (`() => 'pong'`) | **118,993 – 131,141 req/s** | 57,891 req/s | **322,529 req/s** | 134,712 req/s |
| `GET /json` | **52,739 – 53,004 req/s** | 44,905 req/s | **259,470 req/s** | 123,838 req/s |
| `GET /user/:id` | **54,646 – 57,142 req/s** | 43,705 req/s | **252,401 req/s** | 124,870 req/s |

- **Bun:** Eligible middleware-free routes offload to `Bun.serve({ routes })` with pure-static `Response` and `isTrulyZeroArg` fast-paths in `NODE_ENV=production`.
- **Node.js (`>= 22`):** When `uWebSockets.js` is installed (or `{ engine: 'uws' }`), `nodeDriver` offloads eligible bodyless routes directly to `uWS.HttpResponse` via pooled `UwsContext` while falling back to `app.fetch()` for `POST`/middlewares/SSE/404.


View historical trends on the [Continuous Benchmark Dashboard](https://xarhang.github.io/bareJS/dev/benchmarks/).
