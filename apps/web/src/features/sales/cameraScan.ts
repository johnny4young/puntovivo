import { mediaDeviceErrorKind, type MediaDeviceErrorKind } from '@/lib/mediaDeviceError';

/** The slice of the Shape Detection API the camera scan uses; TypeScript's DOM lib omits it. */
interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/** Retail symbologies only: a QR here would be a payment or a link, never a product. */
const CAMERA_SCAN_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
] as const;

/** Reads at most one code from the current video frame. */
export interface CameraCodeReader {
  read(video: HTMLVideoElement): Promise<string | null>;
}

function detectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  return typeof candidate === 'function' ? candidate : null;
}

/** Camera access needs a secure browser context with a camera API; decoding has a fallback. */
export function isCameraScanSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    // The desktop register scans with a wedge reader and never asks for the camera.
    !window.electron &&
    window.isSecureContext === true &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** Some builds ship the API without an on-device model, so it reads no retail format. */
async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Detector = detectorConstructor();
  if (!Detector) return null;
  const supported = Detector.getSupportedFormats
    ? await Detector.getSupportedFormats().catch(() => [] as string[])
    : CAMERA_SCAN_FORMATS;
  const formats = CAMERA_SCAN_FORMATS.filter(format => supported.includes(format));
  return formats.length > 0 ? new Detector({ formats }) : null;
}

/**
 * Prefers the on-device detector and otherwise loads the bundled decoder, so
 * Safari and Firefox scan too. Rejects when neither can load.
 */
export async function createCameraCodeReader(): Promise<CameraCodeReader> {
  const detector = await nativeDetector();
  if (detector) {
    return {
      async read(video) {
        const found = await detector.detect(video);
        return found.find(item => item.rawValue)?.rawValue ?? null;
      },
    };
  }
  const { createFallbackCodeReader } = await import('./cameraScanFallback');
  return createFallbackCodeReader();
}

export type CameraScanError = 'permission-denied' | 'no-camera' | 'unavailable' | 'busy';

const CAMERA_ERRORS: Record<MediaDeviceErrorKind, CameraScanError> = {
  'permission-denied': 'permission-denied',
  'no-device': 'no-camera',
  busy: 'busy',
  unknown: 'unavailable',
};

export function cameraErrorKind(error: unknown): CameraScanError {
  return CAMERA_ERRORS[mediaDeviceErrorKind(error)];
}

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

/** Only rear cameras with a flash report a torch; front cameras and laptops do not. */
export function trackHasTorch(track: MediaStreamTrack | undefined): track is MediaStreamTrack {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  return (track.getCapabilities() as TorchCapabilities).torch === true;
}

export function setTorch(track: MediaStreamTrack, on: boolean): Promise<void> {
  return track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}
