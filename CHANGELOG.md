# Changelog

All notable changes to **BareJS** are documented in this file.

## [Unreleased]

### Added
- **`logger()` Middleware** (`src/utils/logger.ts`): Lightweight structured (`json`) and `pretty` request logger with `X-Request-Id` header attachment, `skip` predicate, and custom `onLog` sink.
- **`healthcheck()` Plugin** (`src/utils/health.ts`): Built-in liveness (`/health`) and optional readiness (`/ready`) endpoints with async dependency `checks` (`200 ok` / `503 degraded`).
- **HTTP Methods**: Added `app.head()`, `app.all()`, and typed `app.options()` in `BareRouter` and `BareJS`.
- **Parameterized & Wildcard WebSockets**: `app.ws('/ws/:room', ...)` and `app.ws('/ws/files/*', ...)` with case-insensitive `Upgrade: websocket` header handling.
- **OpenAPI 3.1 Enhancements** (`src/utils/openapi.ts`): Added `servers`, `tags`, `components.securitySchemes`, and `security` support in `OpenAPIOptions`.
- **Zero-Trust Security Hardening**:
  - `app.trustProxy(false)` / `listen(..., { trustProxy })` to prevent `X-Forwarded-For` / `X-Real-IP` spoofing bypasses in `Context.ip` and `rateLimit()`.
  - Server-level `maxRequestBodySize` option in `BareJS.listen()` (default `10MB`).
  - JWT revocation support in `bareAuth()`: `revokeToken()`, `isTokenRevoked()`, and sync/async `isRevoked` hook.
  - Symlink-escape protection (`realpath` verification) in `staticFile()`.
- **Test Suites**: Added `tests/enhancements.test.ts`, `tests/bug-hunt.test.ts`, `tests/realworld-sim.test.ts`, and `tests/security-audit.test.ts` — reaching **268 tests (5,634 assertions)** and **100.00% Function & 100.00% Line Coverage**.

### Fixed
- **`bareClient` Type Inference & Edge Cases** (`src/client/index.ts`, `src/core/bare.ts`):
  - Fixed type collision when multiple HTTP methods share the same path (keyed by `` `${M} ${P}` ``).
  - Added `query` and `headers` type inference, `BareRouter` route type propagation via `app.use()`, and `replaceAll` for repeated path params.
  - Handled `204`/`205`/`304` and empty `application/json` responses safely without throwing `SyntaxError`.
- **`idempotency()` Scoping, Error Release & Pool Safety** (`src/security/idempotency.ts`, `src/core/bare.ts`):
  - Scoped idempotency keys by `${method}:${path}:${key}` so identical keys on different endpoints never collide.
  - Released `inFlight` keys on thrown errors, async rejections, and direct `Response` returns, and cleared `_idempotencyKey` across pooled `Context` reuse.
- **`circuitBreaker()` Concurrency** (`src/security/resilience.ts`): Tracked `isHalfOpenProbe` per invocation so unrelated `CLOSED` requests cannot prematurely close or clear `HALF_OPEN` state.
- **`compress()`** (`src/utils/compress.ts`): Skipped gzip compression on `HEAD` requests.
- **`Hash.verify()`** (`src/security/hash.ts`): Returned `false` safely on empty, malformed, or unsupported hash strings instead of throwing.
- **`compileHandler()`** (`src/core/bare.ts`): Passed `rFilter` and `idemCommit` in the single-handler (`len === 1`) JIT branch.

---

## [0.1.50] - 2026-11-17

### Added
- End-to-End `bareClient(app)` type inference, `stripUnknown` mass-assignment guard, `circuitBreaker()`, `compress()`, and `app.cron()`.
- Recursive JIT `response` projector, `idempotency()`, `createSingleflight()`, and `llms.txt` AI reference.
- 214 automated tests with 100% coverage.

## [0.1.49]

### Added
- `bareClient` RPC client, JSON-RPC 2.0 (`app.rpc`), OpenAPI 3.1 (`app.docs`), lazy query parsing, SSE (`ctx.sse`), `rateLimit()`, `securityHeaders()`, `onError()`, and 42 tests.
