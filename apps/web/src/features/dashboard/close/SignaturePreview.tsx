import { PAD_HEIGHT, PAD_WIDTH } from './SignaturePad';

/** A stored signature drawn back at any size; the stroke scales with the pad's coordinates. */
export function SignaturePreview({
  path,
  className,
  strokeWidth = 3.5,
  testId,
}: {
  path: string;
  className: string;
  strokeWidth?: number;
  testId?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`}
      className={className}
      aria-hidden="true"
      data-testid={testId}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--fg1)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
