import 'vitest';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  /**
   * Bridge jest-dom 7's matcher signatures into Vitest 5's extension point.
   * R preserves void versus Promise<void> for ordinary and async assertions;
   * T is the received value type. The upstream Jest augmentation is no longer
   * read by Vitest, and its Vitest entry still declares the old Assertion shape.
   */
  interface Matchers<R, T> extends TestingLibraryMatchers<T, R> {
    /** The core DOM assertion must preserve Vitest's sync/async return contract. */
    toBeInTheDocument(): R;
  }
}
