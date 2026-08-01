import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { useTenant } from '@/features/tenant/TenantProvider';
import { ReceiptSharePanel } from './ReceiptSharePanel';

interface ReceiptShareSectionProps {
  saleId: string;
}

export function ReceiptShareSection({ saleId }: ReceiptShareSectionProps) {
  const { t } = useTranslation('receiptShare');
  const { currentSite } = useTenant();
  const [isOpen, setIsOpen] = useState(false);

  if (!currentSite) return null;

  if (isOpen) {
    return (
      <ReceiptSharePanel saleId={saleId} siteId={currentSite.id} onClose={() => setIsOpen(false)} />
    );
  }

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-secondary-200 bg-secondary-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-secondary-950">{t('action')}</p>
        <p className="mt-0.5 text-sm text-secondary-600">{t('description')}</p>
      </div>
      <Button type="button" variant="outline" className="shrink-0" onClick={() => setIsOpen(true)}>
        <MessageCircle aria-hidden="true" />
        {t('action')}
      </Button>
    </div>
  );
}
