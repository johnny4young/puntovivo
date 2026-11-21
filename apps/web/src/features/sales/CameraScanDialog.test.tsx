import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import { CameraScanDialog } from './CameraScanDialog';
import { cameraErrorKind, isCameraScanSupported } from './cameraScan';

function stubCamera(getUserMedia: () => Promise<unknown>, detect: () => Promise<unknown[]>) {
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      detect = detect;
    }
  );
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('CameraScanDialog', () => {
  it('reports the first barcode it reads and releases the camera', async () => {
    const stop = vi.fn();
    stubCamera(
      () => Promise.resolve({ getTracks: () => [{ stop }] }),
      () => Promise.resolve([{ rawValue: '7701234567890' }])
    );
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
    const onDetected = vi.fn();
    render(<CameraScanDialog onDetected={onDetected} onClose={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Point the camera at the barcode.');
    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('7701234567890'));
    expect(stop).toHaveBeenCalled();
  });

  it('explains a refused camera instead of failing silently', async () => {
    stubCamera(
      () => Promise.reject(new DOMException('denied', 'NotAllowedError')),
      () => Promise.resolve([])
    );
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Allow camera access to scan.');
  });
});

describe('camera scan support', () => {
  it('needs a secure context, a camera and an on-device detector', () => {
    expect(isCameraScanSupported()).toBe(false);
    stubCamera(
      () => Promise.resolve({}),
      () => Promise.resolve([])
    );
    vi.stubGlobal('isSecureContext', true);
    expect(isCameraScanSupported()).toBe(true);
    vi.stubGlobal('isSecureContext', false);
    expect(isCameraScanSupported()).toBe(false);
  });

  it('maps camera errors to what the cashier can do about them', () => {
    expect(cameraErrorKind(new DOMException('x', 'NotAllowedError'))).toBe('permission-denied');
    expect(cameraErrorKind(new DOMException('x', 'NotFoundError'))).toBe('no-camera');
    expect(cameraErrorKind(new Error('boom'))).toBe('unavailable');
  });
});
