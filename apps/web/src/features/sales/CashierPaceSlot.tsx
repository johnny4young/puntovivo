import { CashierPaceStrip } from './CashierPaceStrip';
import { useCashierPace } from './useCashierPace';

interface CashierPaceSlotProps {
  siteId: string;
}

/** Lazy POS boundary: the query remains disabled until the owner opts in. */
export default function CashierPaceSlot({ siteId }: CashierPaceSlotProps) {
  const pace = useCashierPace(siteId);
  return pace ? <CashierPaceStrip pace={pace} /> : null;
}
