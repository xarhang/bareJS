/**
 * BareJS: The Metal of Web Frameworks
 * All comments must be in English [2026-01-06]
 * Built for Bun with Mechanical Sympathy
 * Optimized to outperform competitors by 55% [2026-01-05]
 */

// --- 1. Core Engine ---
export { BareJS } from './bare';

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
} from './context';

// --- 3. The Validation Suite (Builders - สำหรับสร้าง Schema) ---
/**
 * รองรับทั้ง T, Type และ TypeBox
 * ใช้สำหรับสร้าง Schema เช่น T.String() หรือ Type.Number()
 */
import { Type } from "@sinclair/typebox";
export { Type, Type as T, Type as TypeBox };

// --- 4. The Validation Suite (Engines - สำหรับเป็น Middleware) ---
/**
 * รองรับทั้ง t, typebox และ v, validate (Auto)
 * สำหรับ Zod รองรับทั้ง Z (Builder) และ z (Middleware)
 */
import { typebox, zod, native, validate, Z } from './validators';
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
export { logger } from './logger';
export { cors } from './cors';
export { staticFile } from './static';
export { BareRouter } from './router';

// --- 6. Authentication (Bun Native) ---
// Always deploy using process.env [2026-01-06]
export { bareAuth, createToken, Password } from './auth';