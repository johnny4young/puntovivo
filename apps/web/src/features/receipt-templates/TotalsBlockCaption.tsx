import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * pass 1 (item #4) — collapsible explainer shown above the
 * `totalsBlock` controls. Pulls each line's source from i18n so the
 * caption stays in sync with whatever the renderer shows.
 */
export function TotalsBlockCaption() {
  const { t } = useTranslation('receiptTemplates');
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded border border-info/30 bg-info/10 p-2 text-xs text-secondary-700"
      data-testid="totals-block-caption"
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left font-medium"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {t('editor.blockFields.totalsBlockCaption')}
      </button>
      {open ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t('editor.blockFields.totalsBlockBindings.subtotal')}</li>
          <li>{t('editor.blockFields.totalsBlockBindings.discount')}</li>
          <li>{t('editor.blockFields.totalsBlockBindings.taxTotal')}</li>
          <li>{t('editor.blockFields.totalsBlockBindings.tip')}</li>
          {/*  collateral —  added the serviceCharge
              toggle but never published its caption row, leaving the
              explainer out of sync with the checkbox grid. */}
          <li>{t('editor.blockFields.totalsBlockBindings.serviceCharge')}</li>
          <li>{t('editor.blockFields.totalsBlockBindings.grandTotal')}</li>
        </ul>
      ) : null}
    </div>
  );
}
