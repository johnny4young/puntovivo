import type { ReactNode } from 'react';

const TONE = {
  neutral: 'bg-surface-3 text-fg2',
  ok: 'bg-success-50 text-success-700',
  info: 'bg-primary-50 text-primary-700',
  warn: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-700',
} as const;
export type SalesTagTone = keyof typeof TONE;

export function SalesTag({
  tone,
  testId,
  children,
  ...data
}: {
  tone: SalesTagTone;
  testId?: string | undefined;
  children: ReactNode;
  [dataAttribute: `data-${string}`]: string;
}) {
  return (
    <span className={`sales-tag gap-1 ${TONE[tone]}`} data-testid={testId} {...data}>
      {children}
    </span>
  );
}
