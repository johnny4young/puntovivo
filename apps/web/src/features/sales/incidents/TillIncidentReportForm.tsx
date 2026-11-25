import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerDownLeft } from 'lucide-react';
import { ChipRadioGroup } from '@/features/sales/ChipRadioGroup';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatNumber } from '@/lib/utils';
import {
  tillIncidentTile,
  type TillIncidentReportKind,
} from '@/features/sales/incidents/tillIncidentTiles';
import {
  TillIncidentProductField,
  type TillIncidentProduct,
} from '@/features/sales/incidents/TillIncidentProduct';
import { useReportTillIncident } from '@/features/sales/incidents/useReportTillIncident';

const STOCKOUT_REASONS = ['not_on_shelf', 'system_zero', 'expired'] as const;
type StockoutReason = (typeof STOCKOUT_REASONS)[number];
/** Mirrors the server's shelfPrice bound. */
const MAX_SHELF_PRICE = 1_000_000_000;

const SERVER_KIND = {
  stockout: 'stockout',
  noBarcode: 'no_barcode',
  priceMismatch: 'price_mismatch',
} as const;

interface ReportFormProps {
  kind: TillIncidentReportKind;
  initialProduct: TillIncidentProduct | null;
  onSent: () => void;
}

/** Reports a product incident and confirms where the manager will see it. */
export function TillIncidentReportForm({ kind, initialProduct, onSent }: ReportFormProps) {
  const { t } = useTranslation('tillIncidents');
  const report = useReportTillIncident();
  const utils = trpc.useUtils();
  // An item that could not be scanned is rarely the last line on the sale.
  const [product, setProduct] = useState(kind === 'noBarcode' ? null : initialProduct);
  const [reason, setReason] = useState<StockoutReason>('not_on_shelf');
  const [shelfPrice, setShelfPrice] = useState('');
  const [note, setNote] = useState('');
  const [linkProduct, setLinkProduct] = useState(false);

  const stock = trpc.registerIncidents.productStock.useQuery(
    { productId: product?.id ?? '' },
    { enabled: kind === 'stockout' && product !== null }
  );

  const trimmedNote = note.trim();
  const shelfValue = Number(shelfPrice);
  const reportProduct = kind === 'noBarcode' && !linkProduct ? null : product;
  const ready = {
    stockout: product !== null,
    noBarcode: trimmedNote !== '' || reportProduct !== null,
    priceMismatch:
      product !== null && shelfPrice !== '' && shelfValue >= 0 && shelfValue <= MAX_SHELF_PRICE,
  }[kind];
  const canSend = ready && !report.isPending;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    // G then Enter can beat the stock read; the confirmation must still name the transfer.
    let hasTransfer = false;
    if (kind === 'stockout' && product) {
      const stockData =
        stock.data ??
        (await utils.registerIncidents.productStock
          .ensureData({ productId: product.id })
          .catch(() => undefined));
      hasTransfer = (stockData?.otherSites.length ?? 0) > 0;
    }
    report.send(
      {
        kind: SERVER_KIND[kind],
        ...(reportProduct ? { productId: reportProduct.id } : {}),
        ...(kind === 'stockout' ? { reason } : {}),
        ...(kind === 'priceMismatch' ? { shelfPrice: shelfValue } : {}),
        ...(kind === 'noBarcode' && trimmedNote ? { note: trimmedNote } : {}),
      },
      hasTransfer ? 'sent.transfer' : 'sent.default',
      onSent
    );
  };

  let productDetail: ReactNode = null;
  if (kind === 'stockout' && stock.data) {
    const best = stock.data.otherSites[0];
    productDetail = [
      t('product.stockHere', { count: formatNumber(stock.data.onHand), site: stock.data.siteName }),
      best &&
        t('product.stockElsewhere', { site: best.siteName, count: formatNumber(best.onHand) }),
    ]
      .filter(Boolean)
      .join(' · ');
  } else if (kind === 'priceMismatch' && product?.price != null) {
    productDetail = t('product.price', { price: formatCurrency(product.price) });
  }

  const productField = (
    <TillIncidentProductField
      product={product}
      onChange={setProduct}
      detail={productDetail}
      icon={tillIncidentTile(kind).icon}
      testId="till-incident-product"
    />
  );

  return (
    <form
      className="till-incident-form"
      onSubmit={event => void submit(event)}
      data-testid={`till-incident-form-${kind}`}
    >
      {kind === 'noBarcode' ? (
        <>
          <label className="till-incident-field">
            <span>{t('noBarcode.note')}</span>
            <input
              className="input min-h-12"
              value={note}
              maxLength={500}
              onChange={event => setNote(event.target.value)}
              autoFocus
              data-testid="till-incident-note"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-fg1">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={linkProduct}
              onChange={event => setLinkProduct(event.target.checked)}
              data-testid="till-incident-link-product"
            />
            {t('noBarcode.linkProduct')}
          </label>
          {linkProduct && productField}
        </>
      ) : (
        productField
      )}

      {kind === 'stockout' && (
        <ChipRadioGroup
          name="till-incident-reason"
          legend={t('stockout.reasons')}
          showLegend
          options={STOCKOUT_REASONS}
          value={reason}
          onChange={setReason}
          labelFor={option => t(`stockout.reason.${option}`)}
          testIdPrefix="till-incident-reason"
        />
      )}

      {kind === 'priceMismatch' && (
        <label className="till-incident-field">
          <span>{t('priceMismatch.shelfPrice')}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            max={MAX_SHELF_PRICE}
            step="any"
            className="input min-h-12 font-numeric text-lg"
            value={shelfPrice}
            onChange={event => setShelfPrice(event.target.value)}
            autoFocus={initialProduct !== null}
            data-testid="till-incident-shelf-price"
          />
        </label>
      )}

      <button
        type="submit"
        className="btn-primary till-incident-submit"
        disabled={!canSend}
        // G then Enter: the stockout of the product just read is two keys.
        autoFocus={kind === 'stockout' && initialProduct !== null}
        data-testid="till-incident-submit"
      >
        {t('submit')}
        <kbd className="pv-kbd" aria-hidden="true">
          <CornerDownLeft className="h-3.5 w-3.5" />
        </kbd>
      </button>
    </form>
  );
}
