import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';

const REPORT_DELAY_MS = 800;

/**
 * Tells the floor map how many plates this device holds unsent for the picked
 * table. The round lives only in this screen's memory, so switching tables or
 * leaving the screen clears the marker it set.
 */
export function usePendingRoundReport(
  tableId: string | null,
  itemCount: number,
  hasService: boolean
) {
  const { mutate } = trpc.restaurantServices.setPendingRound.useMutation();
  const mutateRef = useRef(mutate);
  const reported = useRef<{ tableId: string; itemCount: number } | null>(null);

  useEffect(() => {
    mutateRef.current = mutate;
  }, [mutate]);

  useEffect(() => {
    // Best effort: a missed hint never blocks ordering.
    const report = (target: string, count: number) => {
      reported.current = { tableId: target, itemCount: count };
      mutateRef.current({ tableId: target, itemCount: count });
    };
    const previous = reported.current;
    if (previous && previous.tableId !== tableId && previous.itemCount > 0) {
      report(previous.tableId, 0);
    }
    if (!tableId || !hasService) return;
    if (previous?.tableId === tableId && previous.itemCount === itemCount) return;
    const timer = setTimeout(() => report(tableId, itemCount), REPORT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tableId, itemCount, hasService]);

  useEffect(
    () => () => {
      const last = reported.current;
      if (last && last.itemCount > 0) mutateRef.current({ tableId: last.tableId, itemCount: 0 });
    },
    []
  );
}
