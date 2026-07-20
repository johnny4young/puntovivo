import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import { isSoundEnabled, playScanSuccess, setSoundEnabled } from '@/lib/sound';

/**
 * device-local checkout-sound toggle.
 *
 * Self-contained: owns its on/off state (backed by localStorage via
 * `lib/sound`) so it can sit anywhere in the POS chrome without threading
 * props through SalesScreen. Enabling plays the scan beep immediately —
 * instant proof the till speaker works, and the click satisfies the
 * autoplay gesture requirement.
 */
export function SoundToggleButton() {
  const { t } = useTranslation('sales');
  const [enabled, setEnabled] = useState(isSoundEnabled);

  const label = enabled ? t('sound.disable') : t('sound.enable');

  return (
    <button
      type="button"
      className="btn-outline flex items-center justify-center gap-2 whitespace-nowrap sm:flex-none"
      aria-label={label}
      title={label}
      aria-pressed={enabled}
      data-testid="sales-sound-toggle"
      onClick={() => {
        const next = !enabled;
        setSoundEnabled(next);
        setEnabled(next);
        if (next) playScanSuccess();
      }}
    >
      {enabled ? (
        <Volume2 className="h-4 w-4" aria-hidden="true" />
      ) : (
        <VolumeX className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}
