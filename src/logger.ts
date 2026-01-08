import type { Middleware } from './context';

export const logger: Middleware = async (ctx, next) => {
  const start = performance.now();
  const path = new URL(ctx.req.url).pathname;

  const response = await next?.();

  const duration = (performance.now() - start).toFixed(2);
  const status = response instanceof Response ? response.status : 200;

  let statusColor = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';

  console.log(
    ` \x1b[90m${new Date().toLocaleTimeString()}\x1b[0m ` +
    `\x1b[1m\x1b[38;5;117m${ctx.req.method.padEnd(7)}\x1b[0m ` +
    `\x1b[38;5;250m${path}\x1b[0m ` +
    `${statusColor}${status}\x1b[0m ` +
    `\x1b[90m(${duration}ms)\x1b[0m`
  );

  return response;
};