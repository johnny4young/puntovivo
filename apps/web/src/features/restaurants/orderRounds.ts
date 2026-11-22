import type { TFunction } from 'i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import type { RestaurantModifierGroupKind } from './restaurantDraft';

type TableState = inferRouterOutputs<AppRouter>['restaurantServices']['getTableState'];

interface SummaryModifier {
  name: string;
  quantity: number;
  unitPriceDelta: number;
  groupKind?: RestaurantModifierGroupKind | null | undefined;
}

/** «tres cuartos · sin chicharrón · + aguacate», the way the kitchen reads a plate. */
export function modifierSummary(t: TFunction, modifiers: readonly SummaryModifier[]): string {
  return modifiers
    .map(modifier => {
      const name = modifier.quantity > 1 ? `${modifier.quantity}× ${modifier.name}` : modifier.name;
      if (modifier.groupKind === 'without') return t('restaurants:rail.without', { name });
      // An ungrouped free instruction is not an extra the kitchen adds.
      if (modifier.groupKind === 'extra' || modifier.unitPriceDelta > 0)
        return t('restaurants:rail.extra', { name });
      return name;
    })
    .join(' · ');
}

export interface RailLine {
  key: string;
  quantity: number;
  productName: string;
  total: number;
  /** Null shares the plate with the table. */
  seatNumber: number | null;
  modifiers: readonly SummaryModifier[];
  note: string | null;
}

export interface SentRound {
  key: string;
  sequence: number;
  sentAt: string;
  checkLabel: string | null;
  lines: RailLine[];
}

/** Rounds already sent, oldest first; each check opened so far is one or more rounds. */
export function sentRoundsFromTableState(state: TableState | undefined): SentRound[] {
  if (!state?.service) return [];
  const seatByDiner = new Map(state.diners.map(diner => [diner.id, diner.seatNumber]));
  const rounds: Omit<SentRound, 'sequence'>[] = [];
  for (const check of state.checks) {
    const buckets = new Map<string, Omit<SentRound, 'sequence'>>();
    for (const round of check.rounds) {
      buckets.set(round.id, {
        key: round.id,
        sentAt: round.submittedAt ?? round.createdAt,
        checkLabel: check.label,
        lines: [],
      });
    }
    for (const line of check.lines) {
      const bucketKey = line.roundId ?? `check:${check.id}`;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = { key: bucketKey, sentAt: check.openedAt, checkLabel: check.label, lines: [] };
        buckets.set(bucketKey, bucket);
      }
      bucket.lines.push({
        key: line.id,
        quantity: line.quantity,
        productName: line.productName,
        total: line.total,
        seatNumber: line.dinerId ? (seatByDiner.get(line.dinerId) ?? null) : null,
        modifiers: line.modifiers,
        note: line.notes,
      });
    }
    rounds.push(...[...buckets.values()].filter(bucket => bucket.lines.length > 0));
  }
  // A split copies a round into each check it reaches; one send is one round.
  const bySend = new Map<string, Omit<SentRound, 'sequence'>>();
  for (const round of rounds) {
    const sent = bySend.get(round.sentAt);
    if (sent) sent.lines.push(...round.lines);
    else bySend.set(round.sentAt, { ...round, lines: [...round.lines] });
  }
  return [...bySend.values()]
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    .map((round, index) => ({ ...round, sequence: index + 1 }));
}
