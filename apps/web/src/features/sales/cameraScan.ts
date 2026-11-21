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

function detectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  return typeof candidate === 'function' ? candidate : null;
}

/** Camera access needs a secure context, a camera API and an on-device barcode detector. */
export function isCameraScanSupported(): boolean {
  return (
    detectorConstructor() !== null &&
    window.isSecureContext === true &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

export function createBarcodeDetector(): BarcodeDetectorLike | null {
  const Detector = detectorConstructor();
  return Detector ? new Detector({ formats: [...CAMERA_SCAN_FORMATS] }) : null;
}

/** Some builds ship the API without an on-device model, so it reads no retail format. */
export async function detectsRetailCodes(): Promise<boolean> {
  const Detector = detectorConstructor();
  if (!Detector) return false;
  if (typeof Detector.getSupportedFormats !== 'function') return true;
  const formats = await Detector.getSupportedFormats().catch(() => [] as string[]);
  return CAMERA_SCAN_FORMATS.some(format => formats.includes(format));
}

export type CameraScanError = 'permission-denied' | 'no-camera' | 'unavailable';

export function cameraErrorKind(error: unknown): CameraScanError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-camera';
  return 'unavailable';
}
