import { cn } from '@/lib/utils';

interface BrandMarkProps {
  className?: string;
  /**
   * Hide the orange "punto" accent (e.g. for monochrome contexts like the
   * favicon or a printed receipt). The dot is the only piece of the mark
   * that breaks single-color rendering, so this flag keeps the rest of the
   * artwork intact.
   */
  monochrome?: boolean;
  /**
   * Force the mark to render at a fixed pixel size. Without it the SVG
   * scales to fill its container via 100% width/height.
   */
  size?: number;
  /**
   * aria-label override. Defaults to "Puntovivo". Pass an empty string for
   * decorative-only contexts where the wordmark next to the glyph already
   * exposes the brand name.
   */
  label?: string;
}

/**
 * Puntovivo brand glyph — rounded blue tile with a stylized shopping-bag
 * outline and an orange accent dot ("el punto naranja característico").
 *
 * Rendered inline so the dot can inherit `--brand-accent-500` and the body
 * gradient can shift with the theme without rebuilding the asset.
 */
export function BrandMark({ className, monochrome, size, label = 'Puntovivo' }: BrandMarkProps) {
  const dimension = size ?? undefined;
  return (
    <svg
      role="img"
      aria-label={label || undefined}
      aria-hidden={label === '' ? true : undefined}
      width={dimension}
      height={dimension}
      viewBox="0 0 56 56"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('block', className)}
    >
      <defs>
        <linearGradient id="puntovivo-mark-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.67 0.12 244)" />
          <stop offset="100%" stopColor="oklch(0.53 0.12 244)" />
        </linearGradient>
      </defs>
      <rect width="56" height="56" rx="18" fill="url(#puntovivo-mark-body)" />
      {/* Shopping bag silhouette — 1.8px stroke, rounded joins. Matches the
        design system handoff (assets/logomark.svg). */}
      <path
        d="M19 22 V19 a9 9 0 0 1 18 0 V22"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 22 H40 L38 41 a3 3 0 0 1 -3 3 H21 a3 3 0 0 1 -3 -3 L16 22 Z"
        fill="none"
        stroke="white"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Punto naranja — the brand accent. r=2.6 reads at small sizes
        without overpowering the bag silhouette. */}
      {!monochrome && (
        <circle
          cx="25"
          cy="19.5"
          r="2.6"
          fill="var(--brand-accent-500)"
          data-testid="brand-mark-punto"
        />
      )}
    </svg>
  );
}
