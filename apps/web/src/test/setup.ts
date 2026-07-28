import '@testing-library/jest-dom';
import { vi } from 'vitest';
import '../i18n'; // initialize i18next so useTranslation works in tests
import { registerAllNamespacesForTest } from './i18nTestResources';

function throwUnexpectedConsole(method: 'error' | 'warn', args: unknown[]): never {
  const detail = args
    .map(value => {
      if (value instanceof Error) return `${value.name}: ${value.message}`;
      return typeof value === 'string' ? value : String(value);
    })
    .join(' ');
  throw new Error(`Unexpected console.${method} in web test: ${detail}`);
}

// A passing Vitest process must also be diagnostics-clean. Tests that exercise
// an expected warning/error path install and assert a scoped console spy; every
// unclaimed React act warning or application diagnostic fails immediately.
Object.defineProperties(console, {
  error: {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => throwUnexpectedConsole('error', args),
  },
  warn: {
    configurable: true,
    writable: true,
    value: (...args: unknown[]) => throwUnexpectedConsole('warn', args),
  },
});

// production lazy-loads every non-bootstrap namespace through a
// resourcesToBackend glob loader; unit tests assert strings synchronously, so
// eager-load every namespace into the (test-only) i18next instance up front.
registerAllNamespacesForTest();

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
  // `scrollMargin` was added to the DOM IntersectionObserver interface in
  // the TS 6 lib update (see tsconfig `lib` pulling the new DOM types).
  // The value is unused by the mock, it just has to satisfy the contract.
  readonly scrollMargin: string = '';

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

// axe-core measures icon-ligature text through a 2D canvas. jsdom deliberately
// omits the canvas implementation and otherwise emits a misleading
// "Not implemented" diagnostic for every accessibility test. This deterministic
// in-memory surface provides only the methods axe reads; feature tests that need
// real canvas behavior install their own element-level mock.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: vi.fn(function (this: HTMLCanvasElement, contextId: string) {
    if (contextId !== '2d') return null;
    return {
      canvas: this,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      measureText: (text: string) => ({ width: Math.max(text.length, 1) * 10 }),
      fillText: vi.fn(),
      clearRect: vi.fn(),
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        const pixelWidth = Math.max(Math.ceil(width), 1);
        const pixelHeight = Math.max(Math.ceil(height), 1);
        const data = new Uint8ClampedArray(pixelWidth * pixelHeight * 4);
        // A transparent buffer makes axe classify every text node as an icon
        // ligature and silently bypass contrast checks. One stable opaque pixel
        // models ordinary rendered text while keeping this jsdom shim minimal.
        data[3] = 255;
        return { data, width: pixelWidth, height: pixelHeight };
      },
    };
  }),
});

// axe-core also asks for ::before/::after computed styles. jsdom returns the
// same element style but emits a not-implemented diagnostic for the optional
// pseudo-element argument, so normalize that unsupported argument here.
const getComputedStyle = window.getComputedStyle.bind(window);
Object.defineProperty(window, 'getComputedStyle', {
  configurable: true,
  value: (element: Element) => getComputedStyle(element),
});

// CodeMirror measures DOM Range rectangles in requestAnimationFrame. jsdom
// intentionally omits these layout APIs and otherwise reports an asynchronous
// TypeError after an editor test has already completed. A zero-size rectangle
// matches jsdom's layout model while preserving CodeMirror's measurement path.
const zeroDomRect = () => new DOMRect(0, 0, 0, 0);
Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: zeroDomRect,
});
Object.defineProperty(Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => {
    const rects = [zeroDomRect()] as DOMRect[] & { item(index: number): DOMRect | null };
    rects.item = (index: number) => rects[index] ?? null;
    return rects;
  },
});

// A real anchor click asks jsdom to navigate to another document on a later
// task, which it cannot implement and reports as an asynchronous error even
// though the download contract passed. Individual download tests can spy on
// this method to assert the filename without triggering fake navigation.
Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
  configurable: true,
  value: vi.fn(),
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
