/** Navigation intent only: this never authorizes a sale read or triggers checkout. */
export interface ExternalSaleEntry {
  id: string;
  draft: boolean;
}

/** History state is untrusted; accept only the exact fields needed to open the owned read UI. */
export function readExternalSaleEntry(state: unknown): ExternalSaleEntry | null {
  if (!state || typeof state !== 'object' || !('externalOrderSale' in state)) return null;
  const entry = state.externalOrderSale;
  if (
    !entry ||
    typeof entry !== 'object' ||
    !('id' in entry) ||
    typeof entry.id !== 'string' ||
    !entry.id.trim() ||
    !('draft' in entry) ||
    typeof entry.draft !== 'boolean'
  )
    return null;
  return { id: entry.id, draft: entry.draft };
}
