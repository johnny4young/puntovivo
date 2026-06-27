// Puntovivo brand mark + the inline SVG icons the AI section ships with.
// Ported verbatim from the design's ai-section.jsx (PMark, Spark, ShieldAlert,
// MagGlass, CameraInvoice) into real ESM React components.

/**
 * PMark — the official Puntovivo logo (lowercase "p" + amber counter dot).
 *   variant="tile" (default) → filled-blue squircle with a white p.
 *   variant="flat"           → transparent bg, p inherits currentColor.
 * Mirror of logo/symbols.jsx SymbolPMark — keep in sync.
 */
export function PMark({ size = 30, variant = 'tile', color, style = {} }) {
  const baseStyle = { display: 'inline-block', lineHeight: 0, ...style };

  if (variant === 'flat') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        aria-hidden="true"
        style={{ color: color || 'var(--primary, #2F6BE0)', ...baseStyle }}
        shapeRendering="geometricPrecision"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M14 10 H26.5 A9.5 9.5 0 0 1 26.5 29 H19 V40 H14 Z M19 15 V24 H26.5 A4.5 4.5 0 0 0 26.5 15 Z"
          fill="currentColor"
        />
        <circle cx="25" cy="19.5" r="2.2" fill="var(--brand-accent-500, #E69323)" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      style={baseStyle}
      shapeRendering="geometricPrecision"
    >
      <rect x="0" y="0" width="48" height="48" rx="11" fill={color || 'var(--primary, #2F6BE0)'} />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14 10 H26.5 A9.5 9.5 0 0 1 26.5 29 H19 V40 H14 Z M19 15 V24 H26.5 A4.5 4.5 0 0 0 26.5 15 Z"
        fill="#fff"
      />
      <circle cx="25" cy="19.5" r="2.2" fill="var(--brand-accent-500, #E69323)" />
    </svg>
  );
}

export function Spark({ size = 16, stroke = 'currentColor', strokeWidth = 1.8 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </svg>
  );
}

export function ShieldAlert({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function MagGlass({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function CameraInvoice({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h3l2-2h4l2 2h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
