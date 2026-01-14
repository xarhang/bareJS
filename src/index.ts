/**
 * BareJS: The Metal of Web Frameworks
 * All comments must be in English [2026-01-06]
 * Built for Bun with Mechanical Sympathy
 * Optimized to outperform competitors by 55% [2026-01-05]
 */

// --- 1. Core Engine ---
export { BareJS } from './core/bare';

/**
 * Plugin Interface for BareJS
 */
export interface BarePlugin {
  install: (app: any) => void;
}

// --- 2. Context & Types ---
export type {
  Middleware,
  Handler,
  Next,
  Context,
  Params,
  AuthUser
} from './core/context';

// --- 3. The Validation Suite (Builders - สำหรับสร้าง Schema) ---
import { Type } from "@sinclair/typebox";
export { Type, Type as T, Type as TypeBox };

// --- 4. The Validation Suite (Engines - สำหรับเป็น Middleware) ---
import { typebox, zod, native, validate, Z } from './security/validators';
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
  validate as v 
};

// --- 5. Middlewares & Utilities ---
// export { logger } from './utils/logger';
export { cors } from './security/cors';
export { staticFile } from './utils/static';
export { BareRouter } from './core/router';

// --- 6. Authentication (Bun Native) ---
// Always deploy using process.env [2026-01-06]
export { bareAuth, createToken } from './security/auth';
// --- 7. Hashing ---
export{Hash as Password, Hash} from './security/hash';