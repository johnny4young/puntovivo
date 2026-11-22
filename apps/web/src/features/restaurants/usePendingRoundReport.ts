import { useEffect, useRef } from 'react';
import { trpc } from '@/lib/trpc';

const REPORT_DELAY_MS = 800;
// The server drops an entry after five minutes without a report.
const HEARTBEAT_MS = 2 * 60_000;

/**
 * Tells the floor map how many plates this device holds unsent for the picked
 * table, repeating it while any plate waits. The round lives only in this
 * screen's memory, so switching tables or leaving the screen clears the
 * marker, and a closed or crashed screen stops refreshing it.
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
    const unchanged = previous?.tableId === tableId && previous.itemCount === itemCount;
    const timer = unchanged
      ? undefined
      : setTimeout(() => report(tableId, itemCount), REPORT_DELAY_MS);
    const heartbeat =
      itemCount > 0 ? setInterval(() => report(tableId, itemCount), HEARTBEAT_MS) : undefined;
    return () => {
      clearTimeout(timer);
      clearInterval(heartbeat);
    };
  }, [tableId, itemCount, hasService]);

  useEffect(
    () => () => {
      const last = reported.current;
      if (last && last.itemCount > 0) mutateRef.current({ tableId: last.tableId, itemCount: 0 });
    },
    []
  );
}
