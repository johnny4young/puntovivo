/**
 * ENG-185 — Fiscal pack maturity chip (the "truth guard" label).
 *
 * Orthogonal to `FiscalStatusBadge` (which carries a document's lifecycle
 * status). This badge tells the operator HOW REAL a pack's emission is, so
 * a mock/draft document never reads as production/accepted:
 *   - `mock`      -> "Demo"     (computes a CUFE but never transmits — CO).
 *   - `draft`     -> "Draft"    (structurally-valid but unsigned XML — MX/CL).
 *   - `certified` -> renders NOTHING (a genuinely production-ready pack; no
 *                    pack ships this yet, so the chip is reserved).
 *
 * Display-only: it never blocks anything. Reused on the fiscal config cards,
 * the fiscal document views, and the Operations diagnostics panel.
 *
 * @module components/fiscal/FiscalMaturityBadge
 */
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

/** Mirrors `FiscalAdapterMaturity` on the server — keep in lockstep. */
export type FiscalMaturity = 'mock' | 'draft' | 'certified';

export interface FiscalMaturityBadgeProps {
  maturity: FiscalMaturity;
  className?: string;
}

export function FiscalMaturityBadge({
  maturity,
  className,
}: FiscalMaturityBadgeProps) {
  const { t } = useTranslation('fiscal');
  // A certified pack is genuinely production-ready — no demo label needed.
  if (maturity === 'certified') return null;
  return (
    <Badge
      variant="warning"
      className={cn('uppercase tracking-wide', className)}
      title={t('maturity.hint')}
      aria-label={t(`maturity.${maturity}`)}
      data-testid="fiscal-maturity-badge"
    >
      {t(`maturity.${maturity}`)}
    </Badge>
  );
}
