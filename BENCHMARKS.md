# BareJS Benchmarks

All numbers below are measured with [`mitata`](https://github.com/evanwash/mitata) on **Bun** using [`benchmarks/fair-suite.ts`](./benchmarks/fair-suite.ts) and [`benchmarks/production-bench.ts`](./benchmarks/production-bench.ts).

> **Scope & Limitations:** These are in-process micro-benchmarks of framework routing, middleware, validation, and serialization overhead (`app.fetch(req)` / `app.handle(req)`), **not** end-to-end network HTTP throughput. GitHub Actions shared runners (`ubuntu-latest`) also have higher variance than dedicated bare-metal hardware. Node.js and Deno use the `nodeDriver` / Web-Standard `fetch` path and will have different latency profiles.

---

## Full 7-Scenario Results (Bun)

Bold values indicate the fastest **mean** latency in each scenario.

<!-- MARKER: MULTI_BENCH_START -->

| Scenario | **BareJS** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`1.38 µs`**<br><sub>`p99: 8.51 µs`</sub> | `1.75 µs`<br><sub>`p99: 8.65 µs`</sub> | `3.89 µs`<br><sub>`p99: 15.40 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`1.38 µs`**<br><sub>`p99: 8.03 µs`</sub> | `1.88 µs`<br><sub>`p99: 8.24 µs`</sub> | `4.02 µs`<br><sub>`p99: 14.41 µs`</sub> |
| **3. POST JSON + Schema Validation** | **`3.95 µs`**<br><sub>`p99: 13.55 µs`</sub> | `4.80 µs`<br><sub>`p99: 16.24 µs`</sub> | `4.72 µs`<br><sub>`p99: 15.91 µs`</sub> |
| **4. Async Handler + Query Parsing** | **`2.31 µs`**<br><sub>`p99: 10.26 µs`</sub> | `2.59 µs`<br><sub>`p99: 11.97 µs`</sub> | `2.97 µs`<br><sub>`p99: 11.92 µs`</sub> |
| **5. Response Schema Secret Stripping** | **`1.15 µs`**<br><sub>`p99: 6.99 µs`</sub> | `1.63 µs`<br><sub>`p99: 7.52 µs`</sub> | — |
| **6. SQLite Report (`SUM`/`AVG`/`GROUP BY`)** | `22.50 µs`<br><sub>`p99: 41.60 µs`</sub> | `22.58 µs`<br><sub>`p99: 46.43 µs`</sub> | `28.97 µs`<br><sub>`p99: 64.14 µs`</sub> |
| **7. SQLite Write (`POST` + Validate + `INSERT`)** | `14.42 µs`<br><sub>`p99: 34.56 µs`</sub> | `19.19 µs`<br><sub>`p99: 51.62 µs`</sub> | `15.06 µs`<br><sub>`p99: 16.08 µs`</sub> |

> Last Updated: 2026-11-24 (github action — `linux`, AMD EPYC 7763 64-Core Processor, Bun `1.4.5`, Elysia `1.4.21`, Hono `4.11.4`)

<!-- MARKER: MULTI_BENCH_END -->

### Notes on the Results & Where Competitors Are Faster or Tied
- **Variance & Near-Ties (< 5%):** Bold highlights a **mean** latency that is more than 5% faster than the runner-up. Differences under ~5% (commonly **Scenario 4: Async Handler + Query Parsing** and **Scenario 6: SQLite Report**) vary between GitHub Actions runs and are treated as ties.
- **Where Elysia Is Faster or Tied:** In **Scenario 6 (SQLite Report)**, SQLite aggregation time dominates framework overhead so Elysia and BareJS are effectively tied (and Elysia often leads slightly on mean). On individual runs, Elysia can also show lower `p99` tail latency in **Scenario 1 (100 Routes + Dynamic Params)** and **Scenario 5 (Response Schema Secret Stripping)**.
- **Scenario 5 (`—` for Hono):** Hono does not ship built-in response schema filtering / secret-field stripping out of the box, so it is omitted (`—`) in this scenario.
- **Single-Run Consistency:** All three frameworks are benchmarked in the same process and run inside [`benchmarks/fair-suite.ts`](./benchmarks/fair-suite.ts) and [`benchmarks/production-bench.ts`](./benchmarks/production-bench.ts) using identical fresh `Request` objects.

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
