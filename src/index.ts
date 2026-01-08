// Core Class & Plugin Interface
export { BareJS } from './bare';
// export type { BarePlugin } from './bare';
export interface BarePlugin {
  install: (app: any) => void;
}

// Context, Types & WebSocket
export type {
  Middleware,
  Handler,
  Next,
  Context,
  Params,
  AuthUser
} from './context';

// Validation Middlewares
export { typebox, native, zod } from './validators';

// Utilities & Standard Middlewares
export { logger } from './logger';
export { cors } from './cors';
export { staticFile } from './static';
export { BareRouter } from './router';
// Authentication & Security (Bun Native)
export { bareAuth, createToken, Password } from './auth';