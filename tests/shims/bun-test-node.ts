export {
  describe,
  it,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { vi } from "vitest";

export const spyOn = vi.spyOn.bind(vi);
export const mock = Object.assign(
  (...args: any[]) => (vi.fn as any)(...args),
  {
    module: vi.mock.bind(vi),
    restore: vi.restoreAllMocks.bind(vi),
  }
);
