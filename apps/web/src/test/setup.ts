import '@testing-library/jest-dom';
import { vi, beforeAll, afterAll } from 'vitest';
import '../i18n'; // initialize i18next so useTranslation works in tests

const localStorageState = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return localStorageState.size;
  },
  clear() {
    localStorageState.clear();
  },
  getItem(key: string) {
    return localStorageState.get(key) ?? null;
  },
  key(index: number) {
    return Array.from(localStorageState.keys())[index] ?? null;
  },
  removeItem(key: string) {
    localStorageState.delete(key);
  },
  setItem(key: string, value: string) {
    localStorageState.set(key, String(value));
  },
};

Object.defineProperty(window, 'localStorage', {
  writable: true,
  configurable: true,
  value: localStorageMock,
});

Object.defineProperty(globalThis, 'localStorage', {
  writable: true,
  configurable: true,
  value: localStorageMock,
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '';
  readonly thresholds: ReadonlyArray<number> = [];

  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn().mockReturnValue([]);
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

Object.defineProperty(global, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: MockIntersectionObserver,
});

// Mock ResizeObserver
class MockResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

Object.defineProperty(global, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: MockResizeObserver,
});

// Mock window.scrollTo
Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

// Mock crypto.randomUUID
Object.defineProperty(crypto, 'randomUUID', {
  value: vi.fn(() => '12345678-1234-1234-1234-123456789abc'),
});

// Suppress console errors during tests (optional - can be removed if needed)
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Filter out expected React testing library warnings
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning: ReactDOM.render is no longer supported') ||
        args[0].includes('Warning: An update to') ||
        args[0].includes('act(...)'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
