import type { RuntimeDriver } from './types';
import { bunDriver } from './bun';
import { nodeDriver } from './node';

export type {
  RuntimeDriver,
  RuntimeFileHandle,
  RuntimePasswordConfig,
  ServeOptions,
  ServerHandle
} from './types';
export { bunDriver } from './bun';
export { nodeDriver } from './node';

/**
 * Active runtime driver, resolved ONCE at module load.
 * Bun gets bunDriver with zero per-request overhead; Node.js / Deno get nodeDriver.
 */
export let runtime: RuntimeDriver =
  typeof (globalThis as any).Bun !== 'undefined' ? bunDriver : nodeDriver;

export function setRuntime(driver: RuntimeDriver): void {
  runtime = driver;
}
