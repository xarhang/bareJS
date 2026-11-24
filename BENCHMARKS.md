# BareJS Benchmarks

All numbers below are measured with [`mitata`](https://github.com/evanwash/mitata) on **Bun** using [`benchmarks/fair-suite.ts`](./benchmarks/fair-suite.ts) and [`benchmarks/production-bench.ts`](./benchmarks/production-bench.ts).

> **Scope & Limitations:** These are in-process micro-benchmarks of framework routing, middleware, validation, and serialization overhead (`app.fetch(req)` / `app.handle(req)`), **not** end-to-end network HTTP throughput. GitHub Actions shared runners (`ubuntu-latest`) also have higher variance than dedicated bare-metal hardware. Node.js and Deno use the `nodeDriver` / Web-Standard `fetch` path and will have different latency profiles.

---

## Full 7-Scenario Results (Bun)

Bold values indicate the fastest **mean** latency in each scenario.

<!-- MARKER: MULTI_BENCH_START -->

| Scenario | **BareJS** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`1.54 µs`**<br><sub>`p99: 8.50 µs`</sub> | `1.88 µs`<br><sub>`p99: 8.86 µs`</sub> | `3.95 µs`<br><sub>`p99: 14.72 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`1.49 µs`**<br><sub>`p99: 7.59 µs`</sub> | `1.92 µs`<br><sub>`p99: 8.90 µs`</sub> | `4.10 µs`<br><sub>`p99: 15.39 µs`</sub> |
| **3. POST JSON + Schema Validation** | **`4.12 µs`**<br><sub>`p99: 14.45 µs`</sub> | `4.80 µs`<br><sub>`p99: 15.42 µs`</sub> | `4.77 µs`<br><sub>`p99: 15.54 µs`</sub> |
| **4. Async Handler + Query Parsing** | `2.45 µs`<br><sub>`p99: 11.07 µs`</sub> | `2.39 µs`<br><sub>`p99: 10.13 µs`</sub> | `3.16 µs`<br><sub>`p99: 12.01 µs`</sub> |
| **5. Response Schema Secret Stripping** | **`1.23 µs`**<br><sub>`p99: 7.71 µs`</sub> | `1.70 µs`<br><sub>`p99: 7.49 µs`</sub> | — |
| **6. SQLite Report (`SUM`/`AVG`/`GROUP BY`)** | `22.17 µs`<br><sub>`p99: 41.95 µs`</sub> | `22.13 µs`<br><sub>`p99: 45.13 µs`</sub> | `27.86 µs`<br><sub>`p99: 55.75 µs`</sub> |
| **7. SQLite Write (`POST` + Validate + `INSERT`)** | **`13.78 µs`**<br><sub>`p99: 34.05 µs`</sub> | `19.03 µs`<br><sub>`p99: 47.88 µs`</sub> | `14.66 µs`<br><sub>`p99: 15.19 µs`</sub> |

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
