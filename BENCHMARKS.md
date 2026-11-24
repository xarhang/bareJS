# BareJS Benchmarks

All numbers below are measured with [`mitata`](https://github.com/evanwash/mitata) on **Bun** using [`benchmarks/fair-suite.ts`](./benchmarks/fair-suite.ts) and [`benchmarks/production-bench.ts`](./benchmarks/production-bench.ts).

> **Scope & Limitations:** These are in-process micro-benchmarks of framework routing, middleware, validation, and serialization overhead (`app.fetch(req)` / `app.handle(req)`), **not** end-to-end network HTTP throughput. GitHub Actions shared runners (`ubuntu-latest`) also have higher variance than dedicated bare-metal hardware. Node.js and Deno use the `nodeDriver` / Web-Standard `fetch` path and will have different latency profiles.

---

## Full 7-Scenario Results (Bun)

Bold values indicate the fastest **mean** latency in each scenario.

<!-- MARKER: MULTI_BENCH_START -->

| Scenario | **BareJS** | **ElysiaJS** | **Hono** |
| :--- | :---: | :---: | :---: |
| **1. 100 Routes + Dynamic Params** | **`840 ns`**<br><sub>`p99: 5.14 µs`</sub> | `1.08 µs`<br><sub>`p99: 5.68 µs`</sub> | `2.22 µs`<br><sub>`p99: 10.76 µs`</sub> |
| **2. 10 Middlewares + Deep Path** | **`769 ns`**<br><sub>`p99: 4.30 µs`</sub> | `1.10 µs`<br><sub>`p99: 5.48 µs`</sub> | `2.46 µs`<br><sub>`p99: 11.15 µs`</sub> |
| **3. POST JSON + Schema Validation** | **`2.09 µs`**<br><sub>`p99: 8.99 µs`</sub> | `2.52 µs`<br><sub>`p99: 9.64 µs`</sub> | `2.65 µs`<br><sub>`p99: 10.97 µs`</sub> |
| **4. Async Handler + Query Parsing** | **`1.32 µs`**<br><sub>`p99: 6.52 µs`</sub> | `1.40 µs`<br><sub>`p99: 6.71 µs`</sub> | `1.83 µs`<br><sub>`p99: 8.79 µs`</sub> |
| **5. Response Schema Secret Stripping** | **`803 ns`**<br><sub>`p99: 5.86 µs`</sub> | `986 ns`<br><sub>`p99: 4.28 µs`</sub> | — |
| **6. SQLite Report (`SUM`/`AVG`/`GROUP BY`)** | `12.70 µs`<br><sub>`p99: 21.52 µs`</sub> | **`12.64 µs`**<br><sub>`p99: 20.67 µs`</sub> | `15.65 µs`<br><sub>`p99: 33.22 µs`</sub> |
| **7. SQLite Write (`POST` + Validate + `INSERT`)** | **`4.79 µs`**<br><sub>`p99: 15.30 µs`</sub> | `6.33 µs`<br><sub>`p99: 20.52 µs`</sub> | `8.41 µs`<br><sub>`p99: 30.16 µs`</sub> |

> Last Updated: 2026-11-24 (github action — `ubuntu-latest`, Bun `1.3.x`, Elysia `latest`, Hono `latest`)

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
