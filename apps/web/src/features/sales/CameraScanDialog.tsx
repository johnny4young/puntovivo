import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flashlight, FlashlightOff } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui/Button';
import {
  cameraErrorKind,
  createCameraCodeReader,
  setTorch,
  trackHasTorch,
  type CameraScanError,
} from './cameraScan';

const DETECT_INTERVAL_MS = 200;

interface TorchControl {
  track: MediaStreamTrack;
  on: boolean;
}

interface CameraScanDialogProps {
  onDetected: (code: string) => void;
  onClose: () => void;
}

/** Reads one barcode with the device camera; frames never leave the device. */
export function CameraScanDialog({ onDetected, onClose }: CameraScanDialogProps) {
  const { t } = useTranslation('sales');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<CameraScanError | null>(null);
  const [torch, setTorchControl] = useState<TorchControl | null>(null);
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

    const stop = () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach(track => track.stop());
    };

    const start = async () => {
      // The decoder loads while the cashier answers the camera prompt.
      const readerReady = createCameraCodeReader().catch(() => null);
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      stream = media;
      // A grant that lands after close still has to release the camera.
      if (cancelled) return stop();
      const reader = await readerReady;
      if (!reader) {
        if (!cancelled) setError('unavailable');
        return stop();
      }
      const video = videoRef.current;
      if (!video) return;
      const track = media.getVideoTracks()[0];
      if (trackHasTorch(track)) setTorchControl({ track, on: false });
      video.srcObject = media;
      await video.play().catch(() => undefined);

      const tick = async () => {
        if (cancelled) return;
        if (!document.hidden && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          const code = await reader.read(video).catch(() => null);
          if (code && !cancelled) {
            stop();
            onDetectedRef.current(code);
            return;
          }
        }
        if (!cancelled) timer = window.setTimeout(() => void tick(), DETECT_INTERVAL_MS);
      };
      void tick();
    };

    start().catch(reason => {
      if (!cancelled) setError(cameraErrorKind(reason));
    });

    return stop;
  }, [attempt]);

  const retry = () => {
    setError(null);
    setTorchControl(null);
    setAttempt(value => value + 1);
  };

  const toggleTorch = (control: TorchControl) => {
    setTorch(control.track, !control.on).then(
      () => setTorchControl({ ...control, on: !control.on }),
      () => setTorchControl(null)
    );
  };

  const TorchIcon = torch?.on ? Flashlight : FlashlightOff;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('scanner.camera.title')}
      size="sm"
      footer={
        <>
          <ModalButton onClick={onClose}>{t('scanner.camera.cancel')}</ModalButton>
          {error && (
            <ModalButton variant="primary" onClick={retry} testId="sales-camera-scan-retry">
              {t('scanner.camera.retry')}
            </ModalButton>
          )}
        </>
      }
    >
      <div className="sales-camera-frame" data-testid="sales-camera-scan">
        <video ref={videoRef} muted playsInline aria-hidden="true" />
        {!error && (
          <>
            <span className="sales-camera-target" aria-hidden="true" />
            {torch && (
              <Button
                size="icon"
                variant="ghost"
                className="sales-camera-torch"
                aria-pressed={torch.on}
                aria-label={t('scanner.camera.torch')}
                onClick={() => toggleTorch(torch)}
                data-testid="sales-camera-scan-torch"
              >
                <TorchIcon className="h-5 w-5" aria-hidden="true" />
              </Button>
            )}
          </>
        )}
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
