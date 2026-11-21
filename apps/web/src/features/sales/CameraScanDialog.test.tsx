import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/utils';
import { CameraScanDialog } from './CameraScanDialog';
import { cameraErrorKind, isCameraScanSupported } from './cameraScan';

const fallback = vi.hoisted(() => ({
  read: vi.fn<() => Promise<string | null>>(),
  fail: false,
}));

vi.mock('./cameraScanFallback', () => ({
  createFallbackCodeReader: () => {
    if (fallback.fail) throw new Error('decoder failed to load');
    return { read: fallback.read };
  },
}));

interface FakeTrack {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities?: () => Record<string, unknown>;
  applyConstraints?: ReturnType<typeof vi.fn>;
}

function fakeStream(track: FakeTrack = { stop: vi.fn() }) {
  return { getTracks: () => [track], getVideoTracks: () => [track] };
}

function stubMedia(getUserMedia: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
}

function stubDetector(detect: () => Promise<unknown[]>, formats?: string[]) {
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      static getSupportedFormats = formats ? () => Promise.resolve(formats) : undefined;
      detect = detect;
    }
  );
}

beforeEach(() => {
  fallback.read.mockReset().mockResolvedValue(null);
  fallback.fail = false;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('CameraScanDialog', () => {
  it('reports the first barcode it reads and releases the camera', async () => {
    const track = { stop: vi.fn() };
    stubDetector(() => Promise.resolve([{ rawValue: '7701234567890' }]));
    stubMedia(() => Promise.resolve(fakeStream(track)));
    const onDetected = vi.fn();
    render(<CameraScanDialog onDetected={onDetected} onClose={vi.fn()} />);

    expect(screen.getByTestId('sales-camera-scan-status')).toHaveTextContent(
      'Point the camera at the barcode.'
    );
    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('7701234567890'));
    expect(track.stop).toHaveBeenCalled();
    expect(fallback.read).not.toHaveBeenCalled();
  });

  it('decodes with the bundled reader where the browser has no detector', async () => {
    fallback.read.mockResolvedValueOnce(null).mockResolvedValue('7702010001017');
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
    stubMedia(getUserMedia);
    const onDetected = vi.fn();
    render(<CameraScanDialog onDetected={onDetected} onClose={vi.fn()} />);

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('7702010001017'));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('falls back when the detector reads no retail format', async () => {
    fallback.read.mockResolvedValue('7702010001024');
    const detect = vi.fn(() => Promise.resolve([]));
    stubDetector(detect, ['qr_code']);
    stubMedia(() => Promise.resolve(fakeStream()));
    const onDetected = vi.fn();
    render(<CameraScanDialog onDetected={onDetected} onClose={vi.fn()} />);

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('7702010001024'));
    expect(detect).not.toHaveBeenCalled();
  });

  it('releases the camera when no decoder can load', async () => {
    fallback.fail = true;
    const track = { stop: vi.fn() };
    stubMedia(() => Promise.resolve(fakeStream(track)));
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The camera could not open.');
    expect(track.stop).toHaveBeenCalled();
  });

  it('explains a refused camera and asks again on retry', async () => {
    const getUserMedia = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
      .mockResolvedValue(fakeStream());
    stubMedia(getUserMedia);
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Allow camera access to scan.');
    fireEvent.click(screen.getByTestId('sales-camera-scan-retry'));

    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('status')).toHaveTextContent('Point the camera at the barcode.');
    expect(screen.queryByTestId('sales-camera-scan-retry')).not.toBeInTheDocument();
  });

  it('turns the torch on and off when the camera has one', async () => {
    const applyConstraints = vi.fn(() => Promise.resolve());
    stubMedia(() =>
      Promise.resolve(
        fakeStream({ stop: vi.fn(), getCapabilities: () => ({ torch: true }), applyConstraints })
      )
    );
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    const torch = await screen.findByTestId('sales-camera-scan-torch');
    expect(torch).toHaveAccessibleName('Flashlight');
    expect(torch).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(torch);
    await waitFor(() => expect(torch).toHaveAttribute('aria-pressed', 'true'));
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: true }] });
    fireEvent.click(torch);
    await waitFor(() => expect(torch).toHaveAttribute('aria-pressed', 'false'));
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ torch: false }] });
  });

  it('shows no torch on a camera without one', async () => {
    stubMedia(() => Promise.resolve(fakeStream({ stop: vi.fn(), getCapabilities: () => ({}) })));
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => expect(fallback.read).toHaveBeenCalled());
    expect(screen.queryByTestId('sales-camera-scan-torch')).not.toBeInTheDocument();
  });
});

describe('camera scan support', () => {
  it('needs a secure browser context with a camera, not a detector', () => {
    expect(isCameraScanSupported()).toBe(false);
    stubMedia(() => Promise.resolve(fakeStream()));
    vi.stubGlobal('isSecureContext', true);
    expect(isCameraScanSupported()).toBe(true);
    vi.stubGlobal('isSecureContext', false);
    expect(isCameraScanSupported()).toBe(false);
  });

  it('never offers the camera in the desktop app', () => {
    stubMedia(() => Promise.resolve(fakeStream()));
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('electron', {});
    expect(isCameraScanSupported()).toBe(false);
  });

  it('maps camera errors to what the cashier can do about them', () => {
    expect(cameraErrorKind(new DOMException('x', 'NotAllowedError'))).toBe('permission-denied');
    expect(cameraErrorKind(new DOMException('x', 'NotFoundError'))).toBe('no-camera');
    expect(cameraErrorKind(new DOMException('x', 'NotReadableError'))).toBe('busy');
    expect(cameraErrorKind(new Error('boom'))).toBe('unavailable');
  });
});
