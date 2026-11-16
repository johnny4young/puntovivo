import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Severity = 'blocks' | 'beforeClose' | 'whenPossible' | 'ready';

const SHAPES: Record<Severity, { color: string; shape: ReactNode }> = {
  blocks: { color: 'var(--danger-500)', shape: <path d="M10 1l9 9-9 9-9-9z" fill="currentColor" /> },
  beforeClose: {
    color: 'var(--warning-500)',
    shape: (
      <>
        <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M10 2.5a7.5 7.5 0 0 0 0 15z" fill="currentColor" />
      </>
    ),
  },
  whenPossible: {
    color: 'var(--fg3)',
    shape: <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />,
  },
  ready: {
    color: 'var(--success-500)',
    shape: (
      <>
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <path
          d="M6 10.2l2.6 2.6L14 7.4"
          fill="none"
          stroke="var(--surface)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </>
    ),
  },
};

interface SeverityMarkProps {
  severity: Severity;
  /** Accessible name; omit when adjacent text already names the severity. */
  label?: string;
  size?: number;
  className?: string;
}

/** Severity is carried by shape and colour together, so it survives colour-blindness and print. */
export function SeverityMark({ severity, label, size = 14, className }: SeverityMarkProps) {
  const { color, shape } = SHAPES[severity];
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-severity={severity}
      className={cn('inline-block shrink-0', className)}
      style={{ color }}
    >
      {shape}
    </svg>
  );
}
