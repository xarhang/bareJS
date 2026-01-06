import type { Middleware } from './context';

export const cors = (options: { origin?: string; methods?: string } = {}) => {
  const origin = options.origin || '*';
  const methods = options.methods || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';

  const mw: Middleware = async (req, params, next) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { 
        status: 204, 
        headers: { 
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': methods,
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        } 
      });
    }

    const res = await next();
    if (res instanceof Response) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.set('Access-Control-Allow-Methods', methods);
    }
    return res;
  };
  return mw;
};