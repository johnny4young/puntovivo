import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@/test/utils';
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

function fakeStream(fields: FakeTrack = { stop: vi.fn() }) {
  const track = Object.assign(new EventTarget(), fields);
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
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

  it('falls back when the detector refuses to construct', async () => {
    fallback.read.mockResolvedValue('7702010001031');
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        static getSupportedFormats = () => Promise.resolve(['ean_13']);
        constructor() {
          throw new TypeError('unsupported');
        }
      }
    );
    stubMedia(() => Promise.resolve(fakeStream()));
    const onDetected = vi.fn();
    render(<CameraScanDialog onDetected={onDetected} onClose={vi.fn()} />);

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('7702010001031'));
  });

  it('never opens the camera when no decoder can load', async () => {
    fallback.fail = true;
    const getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));
    stubMedia(getUserMedia);
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The camera could not open.');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('explains a camera taken mid-scan and releases it', async () => {
    const stream = fakeStream();
    stubMedia(() => Promise.resolve(stream));
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    await waitFor(() => expect(fallback.read).toHaveBeenCalled());
    act(() => {
      stream.track.dispatchEvent(new Event('ended'));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Another app is using the camera.');
    expect(stream.track.stop).toHaveBeenCalled();
    expect(screen.getByTestId('sales-camera-scan-retry')).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

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

  it('keeps the torch button when the light will not turn off', async () => {
    const applyConstraints = vi.fn(({ advanced }: { advanced: { torch: boolean }[] }) =>
      advanced[0]!.torch ? Promise.resolve() : Promise.reject(new Error('busy'))
    );
    stubMedia(() =>
      Promise.resolve(
        fakeStream({ stop: vi.fn(), getCapabilities: () => ({ torch: true }), applyConstraints })
      )
    );
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    const torch = await screen.findByTestId('sales-camera-scan-torch');
    fireEvent.click(torch);
    await waitFor(() => expect(torch).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(torch);
    await waitFor(() => expect(applyConstraints).toHaveBeenCalledTimes(2));

    expect(screen.getByTestId('sales-camera-scan-torch')).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores a second torch tap while the first is pending', async () => {
    let finish: () => void = () => undefined;
    const applyConstraints = vi.fn(() => new Promise<void>(resolve => (finish = resolve)));
    stubMedia(() =>
      Promise.resolve(
        fakeStream({ stop: vi.fn(), getCapabilities: () => ({ torch: true }), applyConstraints })
      )
    );
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    const torch = await screen.findByTestId('sales-camera-scan-torch');
    fireEvent.click(torch);
    fireEvent.click(torch);
    act(() => finish());

    await waitFor(() => expect(torch).toHaveAttribute('aria-pressed', 'true'));
    expect(applyConstraints).toHaveBeenCalledTimes(1);
  });

  it('releases the camera when it fails after opening', async () => {
    const stream = fakeStream({
      stop: vi.fn(),
      getCapabilities: () => {
        throw new Error('capabilities unavailable');
      },
    });
    stubMedia(() => Promise.resolve(stream));
    render(<CameraScanDialog onDetected={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The camera could not open.');
    expect(stream.track.stop).toHaveBeenCalled();
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
