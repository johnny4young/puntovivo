import { useRef, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { strokesToPath } from './closeModel';

export type Stroke = Array<{ x: number; y: number }>;

export const PAD_WIDTH = 600;
export const PAD_HEIGHT = 160;
// Skip points closer than this so a slow hand does not flood the path.
const MIN_STEP = 2.5;
// Stay under the server's path limit with room for the stroke in progress.
const MAX_PATH_CHARS = 22_000;

interface SignaturePadProps {
  strokes: Stroke[];
  onChange: (strokes: Stroke[]) => void;
  label: string;
  disabled?: boolean;
}

/** Finger, pen or mouse; the strokes become the path data stored with the close. */
export function SignaturePad({ strokes, onChange, label, disabled }: SignaturePadProps) {
  const surfaceRef = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  const path = strokesToPath(strokes);
  const full = path.length > MAX_PATH_CHARS;

  const toPoint = (event: PointerEvent<SVGSVGElement>) => {
    const box = surfaceRef.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * PAD_WIDTH,
      y: ((event.clientY - box.top) / box.height) * PAD_HEIGHT,
    };
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || full) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = true;
    onChange([...strokes, [toPoint(event)]]);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing.current || strokes.length === 0) return;
    const point = toPoint(event);
    const current = strokes[strokes.length - 1]!;
    const last = current[current.length - 1]!;
    if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return;
    if (full) return;
    onChange([...strokes.slice(0, -1), [...current, point]]);
  };

  const stop = () => {
    drawing.current = false;
  };

  return (
    <svg
      ref={surfaceRef}
      role="img"
      aria-label={label}
      data-testid="day-close-signature-pad"
      data-strokes={strokes.length}
      viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`}
      className={cn(
        'block h-auto w-full touch-none select-none rounded-2xl border-[1.5px] border-dashed border-line-strong bg-surface-2',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair'
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
    >
      <line
        x1={24}
        x2={PAD_WIDTH - 24}
        y1={PAD_HEIGHT - 30}
        y2={PAD_HEIGHT - 30}
        stroke="var(--line-strong)"
        strokeDasharray="3 5"
      />
      {path && (
        <path
          d={path}
          fill="none"
          stroke="var(--fg1)"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
