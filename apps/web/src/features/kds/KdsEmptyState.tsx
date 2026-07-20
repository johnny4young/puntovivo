/**
 * quiet empty state for the kitchen board.
 *
 * The kitchen display is mounted on a TV that runs unattended for
 * hours. The empty state intentionally avoids marketing copy or
 * call-to-action prompts; a cook glancing at the screen only needs
 * to know there's nothing to cook.
 */

import { ChefHat } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function KdsEmptyState() {
  const { t } = useTranslation('kds');
  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-secondary-200"
      data-testid="kds-empty-state"
    >
      <ChefHat className="h-12 w-12 opacity-60" aria-hidden="true" />
      <p className="text-xl font-medium">{t('empty.title')}</p>
      <p className="text-sm text-secondary-300">{t('empty.description')}</p>
    </div>
  );
}
