import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { cameraErrorKind, createBarcodeDetector, type CameraScanError } from './cameraScan';

const DETECT_INTERVAL_MS = 200;

interface CameraScanDialogProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

/** Reads one barcode with the device camera; frames never leave the device. */
export function CameraScanDialog({ onDetected, onClose }: CameraScanDialogProps) {
  const { t } = useTranslation('sales');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [detector] = useState(createBarcodeDetector);
  const [error, setError] = useState<CameraScanError | null>(detector ? null : 'unavailable');
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    if (!detector) return;

    const stop = () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
    };

    const tick = async () => {
      const video = videoRef.current;
      if (cancelled || !video) return;
      if (!document.hidden && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const code = (await detector.detect(video)).find(item => item.rawValue)?.rawValue;
          if (code && !cancelled) {
            stop();
            onDetectedRef.current(code);
            return;
          }
        } catch {
          // A frame the detector cannot read is not an error; the next one may be.
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), DETECT_INTERVAL_MS);
    };

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      .then(async media => {
        stream = media;
        if (cancelled) return stop();
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        await video.play().catch(() => undefined);
        void tick();
      })
      .catch(reason => {
        if (!cancelled) setError(cameraErrorKind(reason));
      });

    return stop;
  }, [detector]);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('scanner.camera.title')}
      size="sm"
      footer={<ModalButton onClick={onClose}>{t('scanner.camera.cancel')}</ModalButton>}
    >
      <div className="sales-camera-frame" data-testid="sales-camera-scan">
        <video ref={videoRef} muted playsInline aria-hidden="true" />
        <span className="sales-camera-target" aria-hidden="true" />
      </div>
      <p
        className={error ? 'mt-3 text-sm text-danger-700' : 'mt-3 text-sm text-fg2'}
        role={error ? 'alert' : 'status'}
        data-testid="sales-camera-scan-status"
      >
        {error ? t(`scanner.camera.error.${error}`) : t('scanner.camera.aim')}
      </p>
    </Modal>
  );
}
