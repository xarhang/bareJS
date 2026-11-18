import type { BarePlugin } from '../index';

export type HealthCheckFn = () => boolean | Promise<boolean>;

export interface HealthcheckOptions {
  /** Liveness endpoint path (default: '/health') */
  path?: string;
  /** Optional readiness endpoint path (e.g. '/ready') */
  readyPath?: string;
  /** Optional version string to include in response */
  version?: string;
  /** Named dependency checks (e.g. { db: () => pingDb() }) */
  checks?: Record<string, HealthCheckFn>;
}

/**
 * Built-in Healthcheck & Readiness plugin for BareJS.
 * Registers /health (and optional /ready) returning 200 OK or 503 Service Unavailable.
 */
export const healthcheck = (options: HealthcheckOptions = {}): BarePlugin => {
  const path = options.path ?? '/health';
  const readyPath = options.readyPath;
  const checks = options.checks;
  const startedAt = Date.now();

  const evaluate = async () => {
    const checkResults: Record<string, 'ok' | 'fail'> = {};
    let healthy = true;

    if (checks) {
      const entries = Object.entries(checks);
      await Promise.all(
        entries.map(async ([name, fn]) => {
          try {
            const ok = await fn();
            checkResults[name] = ok ? 'ok' : 'fail';
            if (!ok) healthy = false;
          } catch {
            checkResults[name] = 'fail';
            healthy = false;
          }
        })
      );
    }

    const payload: Record<string, any> = {
      status: healthy ? 'ok' : 'degraded',
      uptimeMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    };
    if (options.version) payload.version = options.version;
    if (checks) payload.checks = checkResults;

    return Response.json(payload, { status: healthy ? 200 : 503 });
  };

  return {
    install(app: any) {
      app.get(path, evaluate);
      if (readyPath && readyPath !== path) {
        app.get(readyPath, evaluate);
      }
    }
  };
};
