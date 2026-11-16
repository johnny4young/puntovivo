import { useEffect, useRef, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

const WIDTH = 560;
const HEIGHT = 150;

interface SignaturePadProps {
  /** PNG data URL once something is drawn, null after clearing. */
  onChange: (image: string | null) => void;
  label: string;
  disabled?: boolean;
}

/** A finger or mouse signature, exported as a PNG data URL. */
export function SignaturePad({ onChange, label, disabled = false }: SignaturePadProps) {
  const { t } = useTranslation('closeGuide');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = useRef(false);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#14202B';
  }, []);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * WIDTH,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * HEIGHT,
    };
  };

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.beginPath();
    context.moveTo(x, y);
  };

  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y);
    context.stroke();
    drawn.current = true;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (drawn.current) onChange(canvasRef.current?.toDataURL('image/png') ?? null);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    drawn.current = false;
    onChange(null);
  };

  return (
    <div className="relative rounded-[14px] border-2 border-dashed border-line-strong bg-white">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={label}
        className="block h-[150px] w-full touch-none"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        data-testid="close-guide-signature-pad"
      />
      <button
        type="button"
        onClick={clear}
        disabled={disabled}
        className="absolute top-1.5 right-2 min-h-9 rounded-lg px-2 text-[13px] font-semibold text-[#4A5560]"
        data-testid="close-guide-signature-clear"
      >
        {t('signature.clear')}
      </button>
    </div>
  );
}
