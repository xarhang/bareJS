# BareJS API & Configuration Reference

## `Context` (`ctx`) Reference

| Method / Property | Description |
| :--- | :--- |
| `ctx.req` | Raw incoming Web Standard `Request` object. |
| `ctx.params` | Route parameters (`:id` or `ctx.params['*']` for wildcard routes). |
| `ctx.query` / `ctx.getQuery(k)` / `ctx.queryAll(k)` | Lazy, prototype-pollution-safe parsed query parameters. |
| `await ctx.jsonBody(maxBytes?)` | Parses & caches JSON body (enforces `413` limit, default 1MB). |
| `await ctx.upload(options?)` | Safe `multipart/form-data` upload parser (`maxFileSize`, `maxFiles`, `allowedTypes`). |
| `ctx.uploadStream(options?)` | Streaming `multipart/form-data` async generator (`ReadableStream` per file part, $O(\text{chunk})$ memory). |
| `ctx.cookies` | Lazy parsed request cookies (`Record<string, string>`). |
| `await ctx.setCookie(k, v, opts?)` | Sets a cookie (`HttpOnly; SameSite=Lax` default, optional HMAC `secret`). |
| `await ctx.getSignedCookie(k, s)` | Verifies HMAC-SHA256 signed cookie in constant time. |
| `ctx.deleteCookie(k, opts?)` | Expires a cookie immediately. |
| `ctx.user` | Authenticated user payload from `bareAuth` or `basicAuth`. |
| `ctx.requestId` | Incoming `x-request-id` header or generated UUIDv4. |
| `ctx.ip` | Client IP from `x-forwarded-for`, `x-real-ip`, or `cf-connecting-ip` (when `trustProxy` is enabled), else peer IP. |
| `ctx.status(code)` | Sets HTTP response status code (chainable). |
| `ctx.setHeader(name, value)` | Sets response header (chainable, copy-on-write safe). |
| `ctx.json(data)` | Returns `application/json` response. |
| `ctx.send(msg, extra?)` | Returns standardized `{ status, msg, ...extra }` JSON response. |
| `ctx.html(html, status?)` | Returns `text/html; charset=utf-8` response. |
| `ctx.text(text, status?)` | Returns `text/plain; charset=utf-8` response. |
| `ctx.redirect(url, status?)` | Returns HTTP redirect response (default `302`). |
| `ctx.sse(source)` | Streams Server-Sent Events (`text/event-stream`). |
| `ctx.set(k, v)` / `ctx.get(k)` | Per-request key-value storage (cleared on pool release). |

---

## Performance & Environment Configuration

| Variable / File | Default | Description |
| :--- | :--- | :--- |
| `bare.config.ts` | Optional | Centralized config for `port` and Argon2/bcrypt `hash` parameters. |
| `poolSize` | `1024` | `new BareJS(poolSize)` — maximum number of released `Context` instances retained in the lazy bounded LIFO stack (`0..65536`; `0` disables retention). |
| `NODE_ENV` | `development` | Set to `production` to mask 500 stack traces, disable the startup banner, and disable the dev-mode Context Use-After-Free Proxy guard. |
