# BareJS Benchmarks

All numbers below are measured with [`mitata`](https://github.com/evanwash/mitata) on **Bun** using [`benchmarks/fair-suite.ts`](./benchmarks/fair-suite.ts) and [`benchmarks/production-bench.ts`](./benchmarks/production-bench.ts).

> **Scope & Limitations:** These are in-process micro-benchmarks of framework routing, middleware, validation, and serialization overhead (`app.fetch(req)` / `app.handle(req)`), **not** end-to-end network HTTP throughput. GitHub Actions shared runners (`ubuntu-latest`) also have higher variance than dedicated bare-metal hardware. Node.js and Deno use the `nodeDriver` / Web-Standard `fetch` path and will have different latency profiles.

---

## Full 7-Scenario Results (Bun)

Bold values indicate a **mean** latency more than 10% faster than the runner-up; differences within ~10% vary between GitHub Actions runs and are unbolded (treated as ties).

<!-- MARKER: MULTI_BENCH_START -->

| Scenario | **BareJS** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`1.47 µs`**<br><sub>`p99: 8.16 µs`</sub> | `1.94 µs`<br><sub>`p99: 8.89 µs`</sub> | `3.83 µs`<br><sub>`p99: 14.60 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`1.44 µs`**<br><sub>`p99: 7.16 µs`</sub> | `1.98 µs`<br><sub>`p99: 8.89 µs`</sub> | `4.11 µs`<br><sub>`p99: 14.88 µs`</sub> |
| **3. POST JSON + Schema Validation** | `4.18 µs`<br><sub>`p99: 14.68 µs`</sub> | `4.54 µs`<br><sub>`p99: 14.16 µs`</sub> | `4.58 µs`<br><sub>`p99: 15.66 µs`</sub> |
| **4. Async Handler + Query Parsing** | **`2.00 µs`**<br><sub>`p99: 8.61 µs`</sub> | `2.30 µs`<br><sub>`p99: 9.53 µs`</sub> | `3.20 µs`<br><sub>`p99: 12.85 µs`</sub> |
| **5. Response Schema Secret Stripping** | **`1.21 µs`**<br><sub>`p99: 6.97 µs`</sub> | `2.14 µs`<br><sub>`p99: 9.87 µs`</sub> | — |
| **6. SQLite Report (`SUM`/`AVG`/`GROUP BY`)** | `20.23 µs`<br><sub>`p99: 20.60 µs`</sub> | `21.04 µs`<br><sub>`p99: 22.23 µs`</sub> | `28.14 µs`<br><sub>`p99: 55.92 µs`</sub> |
| **7. SQLite Write (`POST` + Validate + `INSERT`)** | **`8.28 µs`**<br><sub>`p99: 8.90 µs`</sub> | `20.12 µs`<br><sub>`p99: 51.76 µs`</sub> | `14.19 µs`<br><sub>`p99: 14.48 µs`</sub> |

> Last Updated: 2026-11-25 (github action — `linux`, AMD EPYC 7763 64-Core Processor, Bun `1.4.5`, Elysia `1.4.21`, Hono `4.11.4`)

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

View historical trends on the [Continuous Benchmark Dashboard](https://xarhang.github.io/bareJS/dev/benchmarks/).
