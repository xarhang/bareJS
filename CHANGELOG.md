# Changelog

All notable changes to **BareJS** are documented in this file.

## [0.1.62] - 2026-11-24

### Fixed & Added
- **Node.js `app.listen()` Server Handle Parity** (`src/runtime/node.ts`):
  - Attached dynamic `.port` getter, `.stop(closeActiveConnections)`, and `.ready` promise onto the Node.js `http.Server` returned by `app.listen()`, matching Bun's `server.port` and `server.stop()` API.
- **Node.js `zstd` Compression Support** (`src/runtime/node.ts`):
  - Wired `zlib.zstdCompressSync` automatically when running on Node.js `>= 22.15`, falling back cleanly to `br`/`gzip` on Node.js 20.
- **`Hash.make()` & `Hash.needsRehash()` Consistency** (`src/security/hash.ts`):
  - Rejected empty passwords consistently in `Hash.make("")` across all runtimes and supported `$scrypt$` parameter checking in `Hash.needsRehash()`.
- **Full Multi-Runtime CI Test Suite** (`.github/workflows/ci.yml`, `vitest.config.ts`, `deno.test.json`):
  - Expanded CI so **Bun** (`bun test`), **Node.js 20 & 22** (`vitest run` + `tests/node-smoke.mjs`), and **Deno 2** (`deno test` + `tests/deno-smoke.ts`) all run the full test suite.
- **Benchmark Verification & Documentation**:
  - Added pre-flight `200` status/body checks and post-run SQLite `INSERT` row-count verification in `benchmarks/production-bench.ts`, raised the `BENCHMARKS.md`/`README.md` clear-winner threshold to `10%`, and expanded `README.md` and `llms.txt`.

## [0.1.61] - 2026-11-23

### Added
- **Node.js Built-in RFC 6455 WebSocket Fallback** (`src/runtime/node.ts`):
  - `app.ws()` now works out of the box on Node.js (`>= 20`) without installing `ws`, using a built-in `node:crypto` + `net.Socket` RFC 6455 handler (supporting handshake, text/binary frames, fragmented frames, ping/pong, and close frames). When `ws` is installed, `nodeDriver` continues to use `ws` automatically.
- **Tests**: Added live WebSocket E2E test on `nodeDriver` without `ws` in `tests/runtime-node.test.ts` (**425 tests / 6,257 assertions**).

## [0.1.60] - 2026-11-23

### Added
- **Deno Native WebSockets (`Deno.upgradeWebSocket`)** (`src/core/bare.ts`):
  - `app.ws()` routes now upgrade natively on Deno via `Deno.upgradeWebSocket(req)` with zero extra dependencies and zero overhead on Bun and Node.js.
- **Zero-Dependency Native `scrypt` Password Hashing on Node.js & Deno** (`src/runtime/node.ts`):
  - `Hash.make()` and `Hash.verify()` automatically fall back to `node:crypto.scrypt` + `timingSafeEqual` (`$scrypt$...`) when `@node-rs/argon2` is not installed.
- **Tests**: Added tests for native `scrypt` fallback and `Deno.upgradeWebSocket` (**424 tests / 6,253 assertions**).

### Documentation
- Restructured `README.md` for multi-runtime clarity (Bun, Node.js, Deno), moved deep guides to `docs/guide.md` and `docs/reference.md`, and created `BENCHMARKS.md` with full 7-scenario results and automated CI updates.

## [0.1.59] - 2026-11-23

### Added
- **Multi-Runtime Architecture (`Bun`, `Node.js >= 20`, `Deno`) & `barejs/node` Entrypoint** (`src/runtime/`, `src/node.ts`, `package.json`, `scripts/build.ts`):
  - Introduced pluggable startup runtime drivers (`src/runtime/bun.ts`, `src/runtime/node.ts`, `src/runtime/index.ts`, `src/runtime/types.ts`) selected once at boot so Bun retains 100% native zero-overhead performance while the same application runs on Node.js (`import { BareJS } from 'barejs/node'`) and Deno (`Deno.serve`).
  - Added conditional package exports (`"."` with `"bun"` / `"node"` conditions and `"./node"`) and dual-target build support in `scripts/build.ts`.
  - Implemented `nodeDriver` using `node:http`, `node:zlib` (`gzipSync`), streaming `fs.createReadStream` static file range handles, optional `ws` WebSocket upgrade bridging (`src/core/ws-match.ts`), and `@node-rs/argon2` / `bcryptjs` / `node:crypto` scrypt fallback for `Hash`.
- **Tests**: Added `tests/runtime-node.test.ts` and `tests/node-smoke.mjs` verifying Node.js HTTP, streaming, static files, compression, WebSocket routing, and password hashing (**423 tests / 6,249 assertions**).

### Performance
- **Exact Static Route `switch (rawPath)` Fast-Path** (`src/core/bare.ts`):
  - Emitted a top-level `switch (rawPath)` dispatch table for non-parameterized static routes ahead of radix traversal in `compile()`, accelerating exact static route lookups to a single V8/JSC string-switch jump.

## [0.1.58] - 2026-11-23

### Added
- **Graceful Drain Lifecycle & IPC `DRAIN_REQUEST`** (`src/core/bare.ts`):
  - Added `app.onDrain(fn)` and idempotent `app.drain(closeActiveConnections?)` to run drain hooks before stopping the server (`stop(false)`).
  - Registered an IPC `process.on('message')` listener in `app.listen()` for `'DRAIN_REQUEST'` / `{ type: 'DRAIN_REQUEST' }` messages (automatically cleaned up in `app.stop()`).
- **True Streaming Multipart Upload (`ctx.uploadStream()`)** (`src/core/context.ts`, `src/index.ts`):
  - Added `ctx.uploadStream(options?)` async generator yielding text fields and backpressure-driven `ReadableStream<Uint8Array>` file parts with $O(\text{chunk})$ memory usage.
  - Enforces `maxFileSize`, `maxFiles`, `maxFieldSize`, `allowedTypes` (`415`), `safeName` sanitization, and safe skipping of unconsumed streams.
  - Exported `UploadStreamOptions` and `UploadStreamPart` types from `src/index.ts`.
- **Dev-Mode Context Use-After-Free Guard** (`src/core/bare.ts`):
  - Added a conditional Proxy guard in `compile()` when `NODE_ENV === 'development'` or unset that warns (`[BareJS] Use-after-free detected`) if a `Context` reference is accessed after response completion and pool release (even across subsequent pool reuse).
  - Emits zero guard code in `NODE_ENV === 'production'` or `test` (0 ns production overhead).
- **Tests**: Added `tests/enterprise-features.test.ts` (6 tests, 20 assertions) covering `onDrain()`/`DRAIN_REQUEST`, dev/prod UAF guard behavior, and `ctx.uploadStream()` (**419 tests / 6,231 assertions**).

### Fixed
- **Disturbed Response Idempotency Lock Release** (`src/security/idempotency.ts`):
  - Checked `resVal.bodyUsed` before `resVal.clone()` in `__idempotencyCommit()` so disturbed responses release the in-flight lock synchronously without leaving subsequent requests stuck at `409`.

## [0.1.57] - 2026-11-20

### Performance
- **Lazy Bounded LIFO Context Pool & Shared Recompilation State** (`src/core/bare.ts`, `src/core/router.ts`):
  - Replaced power-of-two ring-buffer pre-allocation with `normalizePoolSize(poolSize, 1024, 65_536)` and a lazy bounded LIFO stack (`0..65536`, where `new BareJS(0)` disables retention).
  - Cleared acquired pool slots (`pool[slot] = undefined`) while requests are in-flight so the backing array never retains references to active or timed-out/detached `Context` instances.
  - Moved the LIFO stack pointer into a shared mutable `_poolState = { top: 0 }` object captured across all JIT handler generations and added automatic recompilation invalidation (`_onRouteMutate`) when routes or middleware are registered after initial requests.
  - Removed `public get poolTop()` and ensured zero test instrumentation appears in emitted public `.d.ts` declarations.
- **Zero-Allocation Sync-Peek JSON Body & Validator Fast Path** (`src/core/context.ts`, `src/security/validators.ts`):
  - Added `ctx.jsonBodySyncOrAsync()` using `Bun.peek(req.text())` for in-memory/buffered requests while preserving streaming `readBodyWithLimit()` for `Transfer-Encoding: chunked` and pull-based `ReadableStream` bodies.
  - Updated `schemaValidator` (`body`) to execute synchronously without Promise allocation when the JSON body is already buffered and validated via TypeBox or Native JSON Schema (**2.17x faster** on POST JSON + Schema Validation: `8.44 µs -> 3.89 µs`, beating Elysia's `5.11 µs`).
- **Radix JIT Subtree Coalescing & Compact Release Helpers** (`src/core/radix.ts`, `src/core/bare.ts`):
  - Coalesced structurally identical static child subtrees in `RadixNode.jitCompile()` (when `staticKeys.length > 8`) and hoisted shared `_rel`/`_onErr` helpers (when `routes.length > 16`), shrinking 100-route compiled codegen by **96.3%** (`319 KB -> 11.8 KB`) and accelerating 100-route dynamic dispatch by **1.86x** (`3.50 µs -> 1.88 µs`, beating Elysia's `2.52 µs`).

### Security
- **Caller-Scoped Idempotency & Header Replay** (`src/security/idempotency.ts`, `src/security/store.ts`):
  - Scoped idempotency cache & lock keys by caller identity (SHA-256 of `Authorization` and `Cookie` headers by default, or custom `keyScope(ctx)`) so one user can never replay another user's cached response.
  - Preserved and replayed `Location`, `Content-Location`, and `ETag` headers on idempotent hits (in-memory and `redisStore`).
  - Added per-request lock ownership tokens (`acquireToken` / `release(key, token)`) and double-release guards so a timed-out request cannot release a newer request's lock.
- **ES256 Signature Malleability & Canonical JWT/Cookie Verification** (`src/security/auth.ts`, `src/core/context.ts`):
  - Computed and checked the ECDSA P-256 `(r, n - s)` low/high-S twin signature (`getEs256TwinToken`) during token revocation so revoked ES256 tokens cannot be bypassed via signature malleability.
  - Enforced canonical base64url encoding check (rejecting non-zero trailing bits) on JWT signatures and `ctx.getSignedCookie()`.
  - Replaced recursive JWT payload sanitization with an iterative `stripProtoKeys` traversal stripping `__proto__`, `constructor`, and `prototype` at any depth.
- **Streaming Body Size Enforcement** (`src/core/context.ts`):
  - Added streaming `readBodyWithLimit()` to `ctx.jsonBody()` and `ctx.upload()` so chunked requests without `Content-Length` (or with spoofed `Content-Length`) abort immediately with `413` once bytes exceed `maxBytes`.
  - Sanitized `constructor` and `prototype` keys in `ctx.jsonBody()` and enforced multipart field/file size limits on string and binary parts.
- **Flood-Resistant Rate Limiting** (`src/security/rateLimit.ts`):
  - Stopped evicting live rate-limit buckets when `maxEntries` is reached under key-flooding; overflow keys now share a bounded overflow bucket so an attacker cannot reset a victim's counter.
- **Radix Router & Request-ID Hardening** (`src/core/radix.ts`, `src/core/bare.ts`, `src/utils/requestId.ts`):
  - Replaced post-compile regex replacement on `rawRouterCode` with an `emitCall` callback in `RadixNode.jitCompile()`, eliminating codegen corruption when route paths contain handler call substrings.
  - Used `Object.create(null)` for Radix `children`/`handlers`, per-method `handlerParams`, block-scoped `{ const _p = ... }` emission, and safe `Object.defineProperty` handling for `:__proto__` parameters.
  - Stripped ASCII control characters (`\x00-\x1f`, `\x7f`) from incoming `X-Request-Id` headers.

### Added
- **Repeated Query Key Support (`ctx.queryAll`)** (`src/core/context.ts`, `src/security/validators.ts`):
  - Added `ctx.queryAll(key)` returning all values for repeated query parameters (`?a=1&a=2`) and auto-coerced repeated keys into array-typed `query` schema fields across JSON Schema, TypeBox, and Zod (including `.optional()`, `.default()`, and `.nullable()` wrappers).
- **Extended JSON Schema & OpenAPI Support** (`src/security/validators.ts`, `src/utils/openapi.ts`):
  - Added deep structural equality for `const`/`enum`, plus `multipleOf`, `uniqueItems`, `not`, `minProperties`, `maxProperties`, `patternProperties` (alongside `additionalProperties`), `dependentRequired`, and tuple `items: [...]` validation in `native()`.
  - Extended `stripUnknown` / `createResponseFilter` (`projectWithSchema`) to combine `properties`, `patternProperties`, and schema-valued `additionalProperties`, as well as TypeBox/JSON Schema tuples, `Type.Record`, `Type.Union`, and `Type.Intersect`.
  - Enhanced OpenAPI generation for Zod `nullable`, `int`, `min`/`max`, `email`/`uuid` checks, and wildcard routes (`/{wildcard}`).

### Fixed
- **Resilience & Timer Hardening** (`src/security/timeout.ts`, `src/security/resilience.ts`):
  - Clamped `timeout(ms)` delay to `[0, 2^31 - 1]` so large or `Infinity` timeouts never trigger Bun `TimeoutOverflowWarning` (1ms immediate timeout).
  - Added a probe deadline (`resetTimeoutMs`) in `circuitBreaker()` so a hung `HALF_OPEN` probe transitions back to `OPEN` instead of wedging the circuit indefinitely.
- **CORS, Compression, SSE & Bootstrap Fixes** (`src/security/cors.ts`, `src/utils/compress.ts`, `src/core/bare.ts`, `src/core/loader.ts`, `src/client/index.ts`):
  - Merged `Vary` headers without overwriting existing values, synthesized scoped `OPTIONS` preflight handlers using the most specific mounted `cors()`, and applied global CORS headers to `404` responses.
  - Made `compress()` SSE `Content-Type: text/event-stream` detection case-insensitive.
  - Fixed `app.listen(0)` ephemeral port selection (`??`), synchronous `bootstrapConfig()` loading via `createRequire`, `ctx.sse()` sync callback lifecycle, and `bareClient` `FormData` `Content-Type` boundary handling.
- **Tests**: Expanded `tests/production-signoff.test.ts` to 68 end-to-end production, pool boundary, & security sign-off tests (**413 tests / 6,205 assertions**).

---

## [0.1.55] - 2026-11-19

### Fixed
- **Short-Circuit & Timeout Headers** (`src/core/bare.ts`): Middleware that short-circuits with a `Response` (`rateLimit` 429, `bareAuth` 401, `csrf` 403) and `timeout()` 408 responses now retain `ctx._headers` (CORS, security headers, `x-request-id`) and `Set-Cookie`. Empty pipelines no longer crash `compileHandler`; replaced `require('./config')` with an ESM import.
- **`next?.()` Safety** (`auth.ts`, `csrf.ts`, `logger.ts`, `static.ts`): Prevented `TypeError` when middleware runs as the terminal handler (e.g. `OPTIONS` fallback).
- **Validators** (`src/security/validators.ts`): Standalone `typebox`/`zod`/`native` now return `413` on oversized bodies; `native()` correctly checks `array`/`integer`/`object`; response/body projector no longer emits `undefined` keys; `coerceFields` unwraps `ZodOptional`/`ZodDefault`/`ZodNullable`.
- **Idempotency** (`src/security/idempotency.ts`): Whitespace-only keys ignored; SSE streams are never cached.
- **`Hash.needsRehash`**: Guards `null`/non-string input.

### Security
- **SSE Injection** (`src/core/context.ts`): Strip CR/LF from `id`/`event`, validate `retry`, and emit `data:` per line for multi-line payloads.
- **`ctx.ip`**: Skips empty `X-Forwarded-For` segments and falls back correctly.
- **`ctx.upload()`**: `allowedTypes` matched case-insensitively/trimmed. `deleteCookie()` accepts `secure`/`sameSite`.
- **Tests**: Added `tests/qa-audit.test.ts` (**316 tests / 5,833 assertions**).

---

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
