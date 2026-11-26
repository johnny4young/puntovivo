import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, Printer } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { formatCurrency } from '@/lib/utils';
import { openHtmlInPrintWindow } from '@/lib/printWindow';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import {
  buildShelfLabelsPrintHtml,
  buildTsplLabels,
  buildZplLabels,
  renderBarcodeSvg,
  resolveLabelBarcode,
  shelfLabelPrice,
  type ShelfLabelGrid,
  type ShelfLabelPaper,
  type ShelfLabelProduct,
} from './shelfLabels';

type OutputTab = 'sheet' | 'zpl' | 'tspl';

interface ShelfLabelsModalProps {
  isOpen: boolean;
  products: readonly ShelfLabelProduct[];
  onClose: () => void;
}

export function ShelfLabelsModal({ isOpen, products, onClose }: ShelfLabelsModalProps) {
  const { t } = useTranslation('shelfLabels');
  const toast = useToast();
  const priceIncludesTax = usePriceIncludesTax();
  const [paper, setPaper] = useState<ShelfLabelPaper>('letter');
  const [grid, setGrid] = useState<ShelfLabelGrid>('3x8');
  const [tab, setTab] = useState<OutputTab>('sheet');
  const [copiesById, setCopiesById] = useState<Record<string, number>>({});

  const items = useMemo<ShelfLabelProduct[]>(
    () =>
      products.map(product => ({
        ...product,
        price: shelfLabelPrice(product, priceIncludesTax),
        copies: copiesById[product.id] ?? 1,
      })),
    [products, copiesById, priceIncludesTax]
  );

  const totalLabels = useMemo(
    () => items.reduce((sum, item) => sum + (item.copies ?? 1), 0),
    [items]
  );

  const zplText = useMemo(() => buildZplLabels(items, { formatPrice: formatCurrency }), [items]);

  const tsplText = useMemo(() => buildTsplLabels(items, { formatPrice: formatCurrency }), [items]);

  const handlePrintSheet = async () => {
    const html = buildShelfLabelsPrintHtml(items, {
      paper,
      grid,
      formatPrice: formatCurrency,
      title: t('labels.title'),
    });
    if (window.electron?.printDocument) {
      const result = await window.electron.printDocument(html);
      if (!result.success && result.errorCode !== 'PRINT_CANCELLED') {
        toast.warning({ title: result.error || t('labels.printError') });
      }
      return;
    }
    const autoPrint =
      "<script>window.addEventListener('load',function(){window.print();});</script>";
    const printWindow = openHtmlInPrintWindow(html.replace('</body>', `${autoPrint}</body>`), {
      features: 'noopener,noreferrer,width=900,height=720',
    });
    if (!printWindow) {
      toast.warning({ title: t('labels.popupBlocked') });
    }
  };

  const handleCopyThermal = async () => {
    const text = tab === 'zpl' ? zplText : tsplText;
    try {
      await navigator.clipboard.writeText(text);
      toast.success({ title: t('labels.copied') });
    } catch {
      toast.warning({ title: t('labels.copyError') });
    }
  };

  const handleDownloadThermal = () => {
    const text = tab === 'zpl' ? zplText : tsplText;
    const ext = tab === 'zpl' ? 'zpl' : 'tspl';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `etiquetas-gondola.${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('labels.title')}
      size="xl"
      footer={
        <>
          <ModalButton onClick={onClose}>{t('labels.close')}</ModalButton>
          {tab === 'sheet' ? (
            <ModalButton
              variant="primary"
              onClick={() => void handlePrintSheet()}
              disabled={items.length === 0}
            >
              <span className="inline-flex items-center gap-2">
                <Printer className="h-4 w-4" aria-hidden="true" />
                {t('labels.printSheet', { count: totalLabels })}
              </span>
            </ModalButton>
          ) : (
            <>
              <ModalButton onClick={() => void handleCopyThermal()}>
                <span className="inline-flex items-center gap-2">
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  {t('labels.copyCommands')}
                </span>
              </ModalButton>
              <ModalButton variant="primary" onClick={handleDownloadThermal}>
                <span className="inline-flex items-center gap-2">
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {t('labels.downloadCommands', { format: tab.toUpperCase() })}
                </span>
              </ModalButton>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4" data-testid="shelf-labels-modal">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('labels.formatLabel')}>
            {(['sheet', 'zpl', 'tspl'] as const).map(option => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                data-testid={`shelf-labels-tab-${option}`}
                className={tab === option ? 'btn-primary' : 'btn-secondary'}
                onClick={() => setTab(option)}
              >
                {t(`labels.tabs.${option}`)}
              </button>
            ))}
          </div>
          {tab === 'sheet' && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input w-auto"
                aria-label={t('labels.paper')}
                data-testid="shelf-labels-paper"
                value={paper}
                onChange={event => setPaper(event.target.value as ShelfLabelPaper)}
              >
                <option value="letter">{t('labels.papers.letter')}</option>
                <option value="a4">{t('labels.papers.a4')}</option>
              </select>
              <select
                className="input w-auto"
                aria-label={t('labels.grid')}
                data-testid="shelf-labels-grid"
                value={grid}
                onChange={event => setGrid(event.target.value as ShelfLabelGrid)}
              >
                <option value="3x8">{t('labels.grids.3x8')}</option>
                <option value="3x10">{t('labels.grids.3x10')}</option>
                <option value="2x6">{t('labels.grids.2x6')}</option>
              </select>
            </div>
          )}
        </div>

        <div className="max-h-40 overflow-auto rounded-xl border border-line divide-y divide-line">
          {items.map(item => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{item.name}</p>
                <p className="text-xs text-fg3">
                  {item.sku} · {formatCurrency(item.price)}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-fg3">
                <span>{t('labels.copies')}</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  className="input w-20 py-1 text-center"
                  data-testid={`shelf-labels-copies-${item.sku}`}
                  value={item.copies ?? 1}
                  onChange={event => {
                    const next = Math.max(1, Math.min(99, Number(event.target.value) || 1));
                    setCopiesById(current => ({ ...current, [item.id]: next }));
                  }}
                />
              </label>
            </div>
          ))}
        </div>

        {tab === 'sheet' ? (
          <div
            className="grid gap-3 rounded-xl border border-line bg-surface-2 p-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="shelf-labels-preview"
          >
            {items.map(item => {
              const code = resolveLabelBarcode(item);
              const rendered = renderBarcodeSvg(code, { height: 34, moduleWidth: 1.4 });
              return (
                <article
                  key={item.id}
                  data-testid="shelf-label-card"
                  className="flex flex-col justify-between rounded-lg border border-dashed border-line bg-white p-3 text-secondary-900"
                >
                  <p className="line-clamp-2 text-xs font-semibold leading-tight">{item.name}</p>
                  <p className="my-1.5 text-lg font-extrabold tracking-tight">
                    {formatCurrency(item.price)}
                  </p>
                  <div
                    className="w-full overflow-hidden"
                    // Safe: SVG is generated locally from validated barcode digits/ASCII with XML escaping.
                    dangerouslySetInnerHTML={{ __html: rendered.svg }}
                  />
                  <div className="mt-1 flex items-center justify-between text-[10px] text-secondary-500">
                    <span>{rendered.symbology.toUpperCase()}</span>
                    <span>
                      {item.sku} · ×{item.copies ?? 1}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <textarea
            readOnly
            rows={12}
            data-testid={`shelf-labels-code-${tab}`}
            className="input font-mono text-xs"
            value={tab === 'zpl' ? zplText : tsplText}
          />
        )}
      </div>
    </Modal>
  );
}
