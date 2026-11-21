import { lazy, Suspense, type ComponentProps } from 'react';
import type { ReceiveHandoffSheet } from './ReceiveHandoffSheet';
import type { ShiftHandoffSheet } from './ShiftHandoffSheet';

const LazyShiftHandoffSheet = lazy(() =>
  import('./ShiftHandoffSheet').then(module => ({ default: module.ShiftHandoffSheet }))
);
const LazyReceiveHandoffSheet = lazy(() =>
  import('./ReceiveHandoffSheet').then(module => ({ default: module.ReceiveHandoffSheet }))
);

/** Loads each relevo sheet only when it opens. */
export function HandoffSheets({
  give,
  receive,
}: {
  give: ComponentProps<typeof ShiftHandoffSheet> | null;
  receive: ComponentProps<typeof ReceiveHandoffSheet> | null;
}) {
  return (
    <Suspense fallback={null}>
      {give && <LazyShiftHandoffSheet {...give} />}
      {receive && <LazyReceiveHandoffSheet key={receive.handoff.id} {...receive} />}
    </Suspense>
  );
}
