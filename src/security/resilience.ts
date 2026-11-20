import type { Context, Middleware, Next } from '../core/context';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Cooldown in milliseconds before transitioning from OPEN to HALF_OPEN (default: 30000) */
  resetTimeoutMs?: number;
  /** Custom predicate to determine if a response or error counts as a failure */
  isFailure?: (res: any, err?: any) => boolean;
  /** Optional callback fired when circuit state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/**
 * Lightweight Circuit Breaker middleware.
 * Protects downstream databases and external APIs from cascading failures.
 */
export const circuitBreaker = (options: CircuitBreakerOptions = {}): Middleware => {
  const failureThreshold = options.failureThreshold ?? 5;
  const resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
  const isFailure = options.isFailure ?? ((res: any, err?: any) => Boolean(err) || (res instanceof Response && res.status >= 500));

  let state: CircuitState = 'CLOSED';
  let failures = 0;
  let openedAt = 0;
  let halfOpenInFlight = false;

  const setState = (nextState: CircuitState) => {
    if (state !== nextState) {
      const prev = state;
      state = nextState;
      try {
        options.onStateChange?.(prev, nextState);
      } catch {
        // Ignore user callback errors on state transition
      }
    }
  };

  const runWithBreaker = async (exec: () => any) => {
    if (state === 'OPEN') {
      const elapsed = Date.now() - openedAt;
      if (elapsed < resetTimeoutMs) {
        const retryAfterSec = Math.max(1, Math.ceil((resetTimeoutMs - elapsed) / 1000));
        return Response.json(
          { status: 'error', code: 'CIRCUIT_OPEN', message: 'Service temporarily unavailable' },
          { status: 503, headers: { 'Retry-After': String(retryAfterSec) } }
        );
      }
      setState('HALF_OPEN');
    }

    let isHalfOpenProbe = false;
    if (state === 'HALF_OPEN') {
      if (halfOpenInFlight) {
        return Response.json(
          { status: 'error', code: 'CIRCUIT_OPEN', message: 'Service temporarily unavailable' },
          { status: 503, headers: { 'Retry-After': '1' } }
        );
      }
      halfOpenInFlight = true;
      isHalfOpenProbe = true;
    }

    try {
      const res = await exec();
      if (isFailure(res)) {
        failures++;
        if (isHalfOpenProbe || failures >= failureThreshold) {
          openedAt = Date.now();
          setState('OPEN');
        }
      } else {
        failures = 0;
        if (isHalfOpenProbe) setState('CLOSED');
      }
      return res;
    } catch (err) {
      failures++;
      if (isHalfOpenProbe || failures >= failureThreshold) {
        openedAt = Date.now();
        setState('OPEN');
      }
      throw err;
    } finally {
      if (isHalfOpenProbe) halfOpenInFlight = false;
    }
  };

  const mw: Middleware = (_ctx: Context, next?: Next) => runWithBreaker(() => (next ? next() : undefined));
  (mw as any).__circuitBreaker = runWithBreaker;
  return mw;
};
