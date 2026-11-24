# BareJS Benchmarks

All numbers below are measured with [`mitata`](https://github.com/evanwash/mitata) on **Bun** using [`benchmarks/fair-suite.ts`](./benchmarks/fair-suite.ts) and [`benchmarks/production-bench.ts`](./benchmarks/production-bench.ts).

> **Scope & Limitations:** These are in-process micro-benchmarks of framework routing, middleware, validation, and serialization overhead (`app.fetch(req)` / `app.handle(req)`), **not** end-to-end network HTTP throughput. GitHub Actions shared runners (`ubuntu-latest`) also have higher variance than dedicated bare-metal hardware. Node.js and Deno use the `nodeDriver` / Web-Standard `fetch` path and will have different latency profiles.

---

## Full 7-Scenario Results (Bun)

Bold values indicate the fastest **mean** latency in each scenario.

<!-- MARKER: MULTI_BENCH_START -->

| Scenario | **BareJS** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`1.44 µs`**<br><sub>`p99: 8.80 µs`</sub> | `1.82 µs`<br><sub>`p99: 8.58 µs`</sub> | `3.72 µs`<br><sub>`p99: 13.94 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`1.28 µs`**<br><sub>`p99: 6.88 µs`</sub> | `1.78 µs`<br><sub>`p99: 7.88 µs`</sub> | `3.82 µs`<br><sub>`p99: 13.81 µs`</sub> |
| **3. POST JSON + Schema Validation** | **`3.85 µs`**<br><sub>`p99: 13.72 µs`</sub> | `4.61 µs`<br><sub>`p99: 14.54 µs`</sub> | `4.63 µs`<br><sub>`p99: 15.48 µs`</sub> |
| **4. Async Handler + Query Parsing** | **`2.11 µs`**<br><sub>`p99: 9.09 µs`</sub> | `2.27 µs`<br><sub>`p99: 9.93 µs`</sub> | `2.79 µs`<br><sub>`p99: 10.43 µs`</sub> |
| **5. Response Schema Secret Stripping** | **`1.11 µs`**<br><sub>`p99: 6.57 µs`</sub> | `1.52 µs`<br><sub>`p99: 6.81 µs`</sub> | — |
| **6. SQLite Report (`SUM`/`AVG`/`GROUP BY`)** | `22.64 µs`<br><sub>`p99: 44.09 µs`</sub> | **`21.84 µs`**<br><sub>`p99: 37.84 µs`</sub> | `27.42 µs`<br><sub>`p99: 53.19 µs`</sub> |
| **7. SQLite Write (`POST` + Validate + `INSERT`)** | **`13.78 µs`**<br><sub>`p99: 32.56 µs`</sub> | `17.42 µs`<br><sub>`p99: 41.14 µs`</sub> | `14.26 µs`<br><sub>`p99: 14.41 µs`</sub> |

> Last Updated: 2026-11-24 (github action — `linux`, AMD EPYC 7763 64-Core Processor, Bun `1.4.5`, Elysia `1.4.21`, Hono `4.11.4`)

<!-- MARKER: MULTI_BENCH_END -->

### Notes on the Results
- **Scenario 5 (`—` for Hono):** Hono does not ship built-in response schema filtering / secret-field stripping out of the box, so it is omitted (`—`) in this scenario.
- **Mean vs. p99:** Bold highlights the lowest **mean** latency. In scenarios where `p99` or `mean` differs by only 1–6% (e.g. Scenario 6 SQLite Read), the difference falls within runner noise and SQLite query execution time dominates framework overhead.
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
