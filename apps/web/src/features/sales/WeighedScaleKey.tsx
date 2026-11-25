import { useEffect, useRef, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthOwnerKey } from '@/features/auth/AuthContext';
import { scaleStatusKey } from '@/features/peripherals/scale';

interface WeighedScaleKeyProps {
  pressed: boolean;
  reading: boolean;
  buttonRef: Ref<HTMLButtonElement>;
  onReadingChange: (reading: boolean) => void;
  onWeight: (kilograms: number) => void;
  onError: (message: string) => void;
}

/** «Leer báscula»: only rendered by the panel inside the desktop app; hidden until a scale is saved. */
export function WeighedScaleKey({
  pressed,
  reading,
  buttonRef,
  onReadingChange,
  onWeight,
  onError,
}: WeighedScaleKeyProps) {
  const { t } = useTranslation('scale');
  const owner = useAuthOwnerKey();
  const mounted = useRef(true);
  const status = useQuery({
    queryKey: scaleStatusKey(owner),
    queryFn: () => window.electron!.getScaleStatus!(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!status.data?.configured) return null;

  const read = async () => {
    if (reading) return;
    onReadingChange(true);
    try {
      const result = await window.electron!.readScale!();
      // A closed panel must not put a late weight on the ticket.
      if (!mounted.current) return;
      if (result.status === 'ok') onWeight(result.kilograms);
      else onError(t(`errors.${result.code}`));
    } catch {
      if (mounted.current) onError(t('errors.failed'));
    } finally {
      if (mounted.current) onReadingChange(false);
    }
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className="weighed-key is-scale"
      aria-pressed={pressed}
      // Disabling would drop focus out of the panel, and Escape with it.
      aria-busy={reading || undefined}
      onClick={() => void read()}
      data-testid="weighed-item-scale"
    >
      <Scale className="h-5 w-5 shrink-0" aria-hidden="true" />
      {reading ? t('reading') : t('read')}
    </button>
  );
}
