/**
 * BareJS: The Metal of Web Frameworks
 * All comments must be in English [2026-01-06]
 * Built for Bun with Mechanical Sympathy
 * Optimized to outperform competitors by 55% [2026-01-05]
 */

// --- 1. Core Engine ---
export { BareJS, type WebSocketRouteHandler, type CronOptions } from './core/bare';
export { BareRouter, type InferSchema } from './core/router';

/**
 * Plugin Interface for BareJS
 */
export interface BarePlugin {
  install: (app: any) => void;
}

// --- 2. Context & Types ---
export { Context } from './core/context';
export type {
  Middleware,
  Handler,
  Next,
  Params,
  AuthUser,
  CookieOptions,
  UploadOptions,
  UploadedFile,
  UploadResult
} from './core/context';

// --- 3. The Validation Suite (Builders - สำหรับสร้าง Schema) ---
import { Type } from "@sinclair/typebox";
export { Type, Type as T, Type as TypeBox };

// --- 4. The Validation Suite (Engines - สำหรับเป็น Middleware) ---
import { typebox, zod, native, validate, schemaValidator, createResponseFilter, Z, type RouteSchemas, type RouteDetail } from './security/validators';
export { 
  // TypeBox Engine
  typebox, 
  typebox as t, 
  // Zod Engine & Builder
  zod, 
  zod as z, 
  Z, 
  Z as Zod,
  // Native Engine
  native, 
  native as n,
  // Auto-Detect Engine
  validate, 
  validate as v,
  // Unified Route Schema Engine (body, query, params, headers, response, detail, maxBodySize)
  schemaValidator,
  createResponseFilter,
  type RouteSchemas,
  type RouteDetail
};

// --- 5. Middlewares & Utilities ---
export { logger, type LoggerOptions, type LogEntry } from './utils/logger';
export { healthcheck, type HealthcheckOptions, type HealthCheckFn } from './utils/health';
export { cors } from './security/cors';
export { csrf, type CsrfOptions } from './security/csrf';
export { timeout, type TimeoutOptions } from './security/timeout';
export { rateLimit, type RateLimitOptions } from './security/rateLimit';
export { idempotency, createSingleflight, type IdempotencyOptions } from './security/idempotency';
export { circuitBreaker, type CircuitBreakerOptions, type CircuitState } from './security/resilience';
export { securityHeaders, type SecurityHeadersOptions } from './security/headers';
export { staticFile, type StaticOptions } from './utils/static';
export { compress, type CompressOptions } from './utils/compress';
export { generateOpenAPISpec, renderDocsHTML, type OpenAPIOptions } from './utils/openapi';

// --- 6. Authentication (Bun Native) ---
// Always deploy using process.env [2026-01-06]
export { bareAuth, createToken, basicAuth, hasRole, revokeToken, isTokenRevoked, type BareAuthOptions } from './security/auth';
// --- 7. Hashing ---
export { Hash as Password, Hash } from './security/hash';

// --- 8. Type-Safe RPC Client ---
export {
  bareClient,
  type BareClient,
  type BareClientOptions,
  type ClientRequestOptions,
  type RouteEndpoint,
  type RouteSchema
} from './client/index';