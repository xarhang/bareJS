# Changelog

All notable changes to **BareJS** are documented in this file.

## [0.1.54] - 2026-11-19

### Fixed
- **Dynamic `cors()` Raw Response Headers** (`src/security/cors.ts`): Attached CORS headers (`Vary`, `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials`, `Access-Control-Expose-Headers`) to raw `Response` objects returned directly by downstream handlers or middleware in dynamic origin mode.
- **Static Fallback Middleware Chain** (`src/core/bare.ts`): Dispatched `staticFallback` through the full `groupMiddleware` pipeline so `cors()`, `securityHeaders()`, and `rateLimit()` apply to served static files.
- **Typed Client Path Param Replacement** (`src/client/index.ts`): Replaced substring `replaceAll` with boundary-aware single-pass regex replacement so overlapping param names (e.g. `:id` and `:id_sub`) never collide.
- **Tests**: Expanded `tests/security-hardening.test.ts` (**297 tests / 5,775 assertions**).

---

## [0.1.53] - 2026-11-19

### Security
- **JWKS Hardening & Claims Validation** (`src/security/auth.ts`):
  - Added `15s` cooldown for unknown-`kid` JWKS force-refresh, concurrent fetch coalescing (`inFlightJwks`), and `5s` fetch timeout to prevent cache-busting outbound DoS.
  - Filtered out encryption keys (`use === 'enc'`) and mismatched `alg` entries when selecting JWKs.
  - Added `issuer` (`iss`) and `audience` (`aud`) claim validation and rejected non-object JWT payloads.
- **Static File Symlink Defense** (`src/utils/static.ts`): Opened verified `realFile` (resolved via `realpath()`) instead of raw `filePath`, including on `cacheMetadata` hits.
- **Distributed Idempotency Lock Ordering** (`src/security/idempotency.ts`): Awaited `externalStore.set()` completion before releasing the distributed lock in `finally`.
- **Redis Rate-Limit TTL Recovery** (`src/security/store.ts`): Automatically repaired missing TTLs (`PTTL === -1`) to prevent permanent lockouts.
- **Body Size & Cookie Hardening** (`src/core/context.ts`):
  - Ignored non-numeric or negative `Content-Length` headers in `ctx.jsonBody(maxBytes)` so payloads fall back to exact `Buffer.byteLength` enforcement.
  - Rejected control characters (`\r`, `\n`) and `;` in `ctx.setCookie()` `name`, `path`, and `domain`.
- **Constant-Time CSRF Token Check** (`src/security/csrf.ts`): Used `timingSafeEqual` for double-submit CSRF token comparison.
- **Projector Prototype Guard** (`src/security/validators.ts`): Skipped `__proto__`, `constructor`, and `prototype` keys in `buildProjectorExpr()`.

### Fixed
- **Radix JIT Empty Param Matching** (`src/core/radix.ts`): Guarded `:param` matching with `slash > idxPrefix` so `/users` and `/users/` no longer falsely match `/users/:id` with an empty parameter.
- **Response `Set-Cookie` Consistency** (`src/core/context.ts`): Applied and consumed `Set-Cookie` headers across `html()`, `text()`, `redirect()`, `sse()`, and `json()` without duplication.
- **`ctx.getQuery()` Prototype Safety** (`src/core/context.ts`): Used `Object.hasOwn()` so `Object.prototype` keys like `toString` return `undefined`.
- **Compression `q=0` Negotiation** (`src/utils/compress.ts`): Respected `;q=0` in `Accept-Encoding` headers.
- **Redis Empty Body Replay** (`src/security/store.ts`): Checked `typeof parsed.rawBodyBase64 === 'string'` so empty cached responses replay accurately.
- **Docs** (`llms.txt`): Fixed `createSingleflight()` example invocation (`sf(...)`).
- **Tests**: Added `tests/security-hardening.test.ts` (**294 tests / 5,767 assertions**).

---

## [0.1.52] - 2026-11-19

### Added
- **Pluggable External Store & Redis Adapter** (`src/security/store.ts`, `rateLimit.ts`, `idempotency.ts`, `auth.ts`):
  - Exported `redisStore(client)` adapter (compatible with `Bun.redis` via `client.send()` and `ioredis`) implementing `RateLimitStore`, `IdempotencyStore`, and `RevocationStore`.
  - Added optional `store` support to `rateLimit()`, `idempotency()`, and `bareAuth()` token revocation while preserving the zero-overhead in-memory fast path by default.
- **Asymmetric JWT & JWKS in `bareAuth()`** (`src/security/auth.ts`):
  - Added `algorithms` (`HS256`, `RS256`, `ES256`), `publicKey`, and `jwksUri` (with `kid` caching and `crypto.subtle.verify`) while keeping the synchronous `HS256` fast path untouched.
- **Testing Helper `app.request(path, init?)`** (`src/core/bare.ts`):
  - Added ergonomic in-memory request helper normalizing relative paths to `http://localhost` and delegating directly to `app.fetch()`.
- **Prefix Mounting & End-to-End Type Inference** (`src/core/router.ts`, `src/core/bare.ts`):
  - Added `app.route(prefix, router)` and `app.use(prefix, router)` with `PrefixRoutes<P, R2>` type-level path prefixing so `bareClient(app)` preserves full type inference for mounted sub-routers.
- **Multi-Encoding Compression (`zstd`, `br`, `gzip`)** (`src/utils/compress.ts`):
  - Added `Accept-Encoding` negotiation supporting `zstd` (`Bun.zstdCompressSync`), Brotli (`br`), and `gzip` with configurable `encodings` priority.
- **Static File Metadata Cache** (`src/utils/static.ts`):
  - Added optional `cacheMetadata` (LRU + TTL) in `staticFile()` to cache `realpath`, `stat`, and `ETag` and avoid repeated filesystem syscalls.
- **Test Suites**: Added `tests/audit-fixes.test.ts` and `tests/enhancements-v2.test.ts`.

### Performance
- Used 1-arg `Response.json(data)` fast path for default 200 responses (`src/core/bare.ts`, `src/core/context.ts`).
- Pre-checked `+` and `%` before decoding in query string parsing (`src/core/context.ts`).
- Skipped `validateSyncParts` when routes define no `params`, `query`, or `headers` schemas (`src/security/validators.ts`).
- Cached immutable `ResponseInit` objects and guarded frozen headers (`src/core/bare.ts`, `src/core/context.ts`).
- Automated multi-scenario and head-to-head benchmarks in CI (`benchmarks/fair-suite.ts`, `benchmarks/production-bench.ts`, `scripts/update-readme.ts`).

### Fixed
- **`trustProxy(false)` Overflow & `_peerIp`** (`src/core/bare.ts`, `src/core/context.ts`): Propagated `_trustProxy` to overflow `Context` instances and wired `server.requestIP(req)?.address` into `ctx._peerIp`.
- **Error Response Headers & CRLF Guard** (`src/core/bare.ts`): Applied `ctx._headers` and `Set-Cookie` to error and `404` responses via `applyCtxHeaders` with `try/catch` protection against invalid CRLF header values.
- **`async onError()` Support** (`src/core/bare.ts`): Awaited async custom error handlers before serializing plain objects/strings into responses.
- **`idempotency()` Response Caching** (`src/security/idempotency.ts`): Cloned and cached direct `Response` returns (e.g. `ctx.status(201).json(...)`) for faithful replay.

---

## [0.1.51] - 2026-11-18

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
