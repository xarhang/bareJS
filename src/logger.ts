// All comments in English
import type { Context, Next } from './context';

/**
 * BareJS Professional Logger
 * Displays Method, Path, Status, and Response Time
 */
export const logger = async (ctx: Context, next: Next) => {
  const start = performance.now();
  const { method, url } = ctx.req;
  const path = new URL(url).pathname;

  // Execute the pipeline
  const response = await next();

  const duration = (performance.now() - start).toFixed(2);
  const status = response instanceof Response ? response.status : (ctx.res?.status || 200);

  // Status Color Logic
  let statusColor = '\x1b[32m'; // Green (2xx)
  if (status >= 400) statusColor = '\x1b[33m'; // Yellow (4xx)
  if (status >= 500) statusColor = '\x1b[31m'; // Red (5xx)

  // Modern Minimalist Format
  console.log(
    ` \x1b[90m${new Date().toLocaleTimeString()}\x1b[0m ` +
    `\x1b[1m\x1b[38;5;117m${method.padEnd(7)}\x1b[0m ` +
    `\x1b[38;5;250m${path}\x1b[0m ` +
    `${statusColor}${status}\x1b[0m ` +
    `\x1b[90m(${duration}ms)\x1b[0m`
  );

  return response;
};