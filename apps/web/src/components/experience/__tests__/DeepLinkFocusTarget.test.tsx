import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { DeepLinkFocusTarget } from '../DeepLinkFocusTarget';

const scrollIntoView = vi.fn();
const observe = vi.fn();
const disconnect = vi.fn();
let resizeCallback: ResizeObserverCallback;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView'
);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

describe('DeepLinkFocusTarget', () => {
  it('scrolls and focuses an active handoff destination', () => {
    render(
      <DeepLinkFocusTarget
        active
        id="registered-devices"
        label="Registered devices"
        testId="registered-devices-target"
      >
        <p>Device list</p>
      </DeepLinkFocusTarget>
    );

    const target = screen.getByTestId('registered-devices-target');
    expect(target).toHaveFocus();
    expect(target).toHaveAttribute('role', 'region');
    expect(target).toHaveAccessibleName('Registered devices');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('does not move focus for an ordinary tab visit', () => {
    render(
      <DeepLinkFocusTarget
        active={false}
        id="registered-devices"
        label="Registered devices"
        testId="registered-devices-target"
      >
        <p>Device list</p>
      </DeepLinkFocusTarget>
    );

    expect(screen.getByTestId('registered-devices-target')).not.toHaveFocus();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('realigns after the first painted frame when the initial layout is not ready', () => {
    let firstPaint: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      firstPaint = callback;
      return 42;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');

    const { unmount } = render(
      <DeepLinkFocusTarget
        active
        id="backup-restore"
        label="Restore backup"
        testId="backup-restore-target"
      >
        <p>Restore controls</p>
      </DeepLinkFocusTarget>
    );

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    firstPaint?.(0);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(42);
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });

  it('reframes an active target after lazy content moves it below the viewport', () => {
    const { unmount } = render(
      <DeepLinkFocusTarget
        active
        id="backup-restore"
        label="Restore backup"
        testId="backup-restore-target"
      >
        <p>Restore controls</p>
      </DeepLinkFocusTarget>
    );

    const target = screen.getByTestId('backup-restore-target');
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      bottom: window.innerHeight + 220,
      height: 120,
      left: 0,
      right: 400,
      top: window.innerHeight + 100,
      width: 400,
      x: 0,
      y: window.innerHeight + 100,
      toJSON: () => undefined,
    });

    resizeCallback([], {} as ResizeObserver);

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledWith(target.parentElement);
    expect(observe).toHaveBeenCalledWith(document.body);

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
