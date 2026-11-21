import { useState } from 'react';
import { PIN_LENGTH } from '@/features/sales/handoff/handoffModel';
import { strokesToPath } from './closeModel';
import type { Stroke } from './SignaturePad';

/** What the manager is signing with, before it is sent. */
export function useSignatureDraft() {
  const [mode, setModeState] = useState<'draw' | 'pin'>('draw');
  const [pin, setPinState] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [invalid, setInvalid] = useState(false);
  return {
    mode,
    pin,
    strokes,
    invalid,
    ready: mode === 'pin' ? pin.length === PIN_LENGTH : strokes.length > 0,
    setMode: (next: 'draw' | 'pin') => {
      setModeState(next);
      setInvalid(false);
    },
    setPin: (next: string) => {
      setPinState(next);
      setInvalid(false);
    },
    setStrokes,
    setInvalid,
    clearPin: () => setPinState(''),
    payload: () =>
      mode === 'pin'
        ? { method: 'pin' as const, pin }
        : { method: 'drawn' as const, path: strokesToPath(strokes) },
  };
}

export type SignatureDraft = ReturnType<typeof useSignatureDraft>;
