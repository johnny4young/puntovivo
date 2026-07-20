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
  // official P-mark shape lifted verbatim from the design
  // system handoff (`ui_kits/pos/shell.jsx`). The path renders a
  // stylized lowercase "p" with the counter (the bowl) carved out via
  // fillRule="evenodd"; the punto naranja sits inside that counter at
  // (25, 19.5). The bag silhouette I shipped originally was a wrong
  // inference — this path is what the bundle actually specifies.
  //
  // The 48×48 viewBox matches the handoff (shell.jsx renders the same
  // glyph at h-9/10/11 sizing). The drop-shadow filter sits at the
  // call site so the mark can render flat inside printed receipts
  // and color-bound icons without bringing the glow along.
  return (
    <svg
      role="img"
      aria-label={label || undefined}
      aria-hidden={label === '' ? true : undefined}
      width={dimension}
      height={dimension}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="geometricPrecision"
      className={cn('block', className)}
    >
      <rect x="0" y="0" width="48" height="48" rx="11" fill="var(--primary)" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14 10 H26.5 A9.5 9.5 0 0 1 26.5 29 H19 V40 H14 Z M19 15 V24 H26.5 A4.5 4.5 0 0 0 26.5 15 Z"
        fill="#fff"
      />
      {!monochrome && (
        <circle
          cx="25"
          cy="19.5"
          r="2.2"
          fill="var(--brand-accent-500)"
          data-testid="brand-mark-punto"
        />
      )}
    </svg>
  );
}
