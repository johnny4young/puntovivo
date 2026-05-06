import { CompanySyncCard } from '@/features/company/CompanySyncCard';

/**
 * ENG-065a — Operations Center: Sync Health panel.
 *
 * Reuses `<CompanySyncCard />` directly. The card already covers
 * pending/retrying/failed counters, conflict surfacing, push/pull
 * actions, and the conflict-resolution flow. Mounting it here makes
 * the Operations Center the canonical home for sync health while
 * the existing /company mount stays for backward-compat with operator
 * bookmarks (a follow-up cleanup ticket retires the duplicate
 * mount once /operations is established).
 */
export function SyncHealthPanel() {
  return <CompanySyncCard />;
}
