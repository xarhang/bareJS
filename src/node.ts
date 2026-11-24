import { setRuntime } from './runtime';
import { nodeDriver } from './runtime/node';

setRuntime(nodeDriver);

export * from './index';
