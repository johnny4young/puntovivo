export type MediaDeviceErrorKind = 'permission-denied' | 'no-device' | 'busy' | 'unknown';

/** Classifies a `getUserMedia` rejection by its DOMException name. */
export function mediaDeviceErrorKind(error: unknown): MediaDeviceErrorKind {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'unknown';
}
