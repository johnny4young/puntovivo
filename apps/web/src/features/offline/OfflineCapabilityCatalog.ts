import {
  Banknote,
  CreditCard,
  Mail,
  PackageCheck,
  ShoppingBag,
  Stars,
  type LucideIcon,
} from 'lucide-react';

export type OfflineCapabilityStatus = 'available' | 'limited' | 'pending' | 'blocked';

export interface OfflineCapabilityTile {
  /**
   * Stable, kebab-case identifier for the tile. Used as the i18n key
   * suffix under `common:offlineGrid.capabilities.<id>.{label,note}`
   * and as the row key in the capability catalog. Must not change once
   * a tile ships — renaming would silently drop the matching i18n keys.
   */
  id: string;
  icon: LucideIcon;
  status: OfflineCapabilityStatus;
  /** Optional follow-up note for "Limitado" / "Bloqueado" tiles. */
  note?: string;
}

/**
 * ENG-100 — single source of truth for the product's offline-capability
 * surface area. Renderable in `OfflineCapabilityGrid` AND consumable
 * by tests, by the website-copy audit, and by any future marketing
 * material that needs to declare what works without connectivity.
 *
 * Contract (enforced by review, see `OfflineCapabilityGrid.audit.test.ts`):
 *
 *   1. Each tile MUST correspond to a shipped feature, not a promise.
 *      `status='available'` requires a backing ENG ticket that delivered
 *      the offline behavior. `status='limited' | 'pending' | 'blocked'`
 *      requires the description to be honest about the constraint.
 *   2. `status` MUST be one of `'available' | 'limited' | 'pending' |
 *      'blocked'` and MUST reflect the real runtime behavior of the
 *      backing feature. Do not soften `'blocked'` to `'limited'` to
 *      make the grid look nicer — operators rely on it.
 *   3. Any change to this catalog (adding a tile, renaming an id,
 *      flipping a status) MUST keep the capability catalog in sync in
 *      the SAME commit. The website (when it ships) consumes that table
 *      as authoritative copy; drift between the array and the catalog
 *      produces marketing overstatement.
 *
 * The audit test pins this array's cardinality + id set + status enum
 * so a casual edit cannot land an overstatement silently.
 */
export const OFFLINE_CAPABILITY_CATALOG: readonly OfflineCapabilityTile[] = [
  { id: 'sell', icon: ShoppingBag, status: 'available' },
  { id: 'cash', icon: Banknote, status: 'available' },
  { id: 'card', icon: CreditCard, status: 'limited', note: 'card' },
  { id: 'receipt', icon: Mail, status: 'limited', note: 'receipt' },
  { id: 'loyalty', icon: Stars, status: 'pending', note: 'loyalty' },
  { id: 'inventory', icon: PackageCheck, status: 'blocked', note: 'inventory' },
];
