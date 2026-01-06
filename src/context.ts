
/**
 * High-performance Middleware signature
 * Arguments are passed directly to avoid object allocation overhead.
 */
export type Middleware = (
  req: Request, 
  params: Record<string, string>, 
  next: Next
) => any;

export type Next = () => any;

/**
 * The Elysia-style Context
 * Extends the native Request with params and high-speed state
 */
export type Context = Request & {
  params: Record<string, string>;
  set: (key: string, value: any) => void;
  get: <T>(key: string) => T;
  // Metadata for internal use
  store: Map<string, any>;
};

/**
 * Unified Handler type for auto-inference
 */
export type Handler = (c: Context, next: Next) => any;

export interface WSHandlers {
  open?: (ws: any) => void;
  message?: (ws: any, message: string | Buffer) => void;
  close?: (ws: any, code: number, reason: string) => void;
  drain?: (ws: any) => void;
}