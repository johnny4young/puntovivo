import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  /** Drops the orange dot, the only piece that breaks single-colour rendering. */
  monochrome?: boolean;
  size?: number;
  /** Empty string marks the glyph decorative when a wordmark sits beside it. */
  label?: string;
}

/** Puntovivo mark: a horizon arc on its baseline with the orange "punto" rising at its left. */
export function BrandMark({ className, monochrome, size, label = 'Puntovivo' }: BrandMarkProps) {
  return (
    <svg
      role="img"
      aria-label={label || undefined}
      aria-hidden={label === '' ? true : undefined}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="geometricPrecision"
      className={cn('block', className)}
    >
      <rect width="48" height="48" rx="12" fill="var(--rail)" />
      <g transform="translate(7.3 7.3) scale(0.835)" strokeLinecap="round" strokeWidth="3.6">
        <path d="M5 27a15 15 0 0 1 30 0" fill="none" stroke="var(--rail-foreground)" />
        <path d="M3 33h34" stroke="var(--rail-foreground)" />
        {!monochrome && (
          <circle
            cx="12.5"
            cy="16.4"
            r="5"
            fill="var(--brand-accent-500)"
            data-testid="brand-mark-punto"
          />
        )}
      </g>
    </svg>
  );
}
