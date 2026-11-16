import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { trpc } from '@/lib/trpc';

interface SaleTransferPanelProps {
  isAdmin: boolean;
}

/** Module matrix of a QR code, drawn locally; nothing leaves the till. */
function useQrMatrix(source: string | null): boolean[][] | null {
  const [encoded, setEncoded] = useState<{ source: string; rows: boolean[][] | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!source) return;
    const setMatrix = (rows: boolean[][] | null) => setEncoded({ source, rows });
    void import('qrcode')
      .then(({ default: QRCode }) => {
        const { modules } = QRCode.create(source, { errorCorrectionLevel: 'M' });
        const rows: boolean[][] = [];
        for (let row = 0; row < modules.size; row += 1) {
          const cells: boolean[] = [];
          for (let column = 0; column < modules.size; column += 1) {
            cells.push(modules.get(row, column) === 1);
          }
          rows.push(cells);
        }
        if (!cancelled) setMatrix(rows);
      })
      .catch(() => {
        // Too long to encode: the handles below still tell the customer where to pay.
        if (!cancelled) setMatrix(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);
  // A matrix encoded for an earlier source must never be shown for this one.
  return encoded && encoded.source === source ? encoded.rows : null;
}

const QUIET_ZONE = 2;

/**
 * The store's transfer handle as a QR plus its readable keys. Payment rails
 * are not connected, so this only helps the customer pay: the cashier still
 * confirms the money arrived.
 */
export function SaleTransferPanel({ isAdmin }: SaleTransferPanelProps) {
  const { t } = useTranslation('sales');
  const handlesQuery = trpc.paymentSettings.transferHandles.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const handles = handlesQuery.data?.handles ?? [];
  const qrSource = handlesQuery.data?.qrSource ?? null;
  const matrix = useQrMatrix(qrSource);

  if (handlesQuery.isLoading) return null;

  if (!qrSource) {
    return (
      <div
        className="rounded-[15px] border-[1.5px] border-line bg-background p-4 text-sm text-fg2"
        data-testid="sale-transfer-unconfigured"
      >
        <p>{t(isAdmin ? 'payment.transferPanel.missingAdmin' : 'payment.transferPanel.missing')}</p>
        {isAdmin && (
          <Link
            to="/company?tab=payments"
            className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary-700 underline underline-offset-4"
            data-testid="sale-transfer-configure"
          >
            {t('payment.transferPanel.configure')}
          </Link>
        )}
      </div>
    );
  }

  const size = matrix ? matrix.length + QUIET_ZONE * 2 : 0;
  const path = (matrix ?? [])
    .flatMap((cells, row) =>
      cells.map((dark, column) =>
        dark ? `M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z` : ''
      )
    )
    .join('');

  return (
    <div className="flex flex-col gap-4 sm:flex-row" data-testid="sale-transfer-panel">
      <div className="flex h-[172px] w-[172px] shrink-0 items-center justify-center self-center rounded-[16px] border-[1.5px] border-line-strong bg-white p-2 sm:self-start">
        {matrix && (
          // A QR is always dark on white, whatever the theme, so phones can read it.
          <svg
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={t('payment.transferPanel.qrLabel')}
            className="h-full w-full"
            shapeRendering="crispEdges"
            data-testid="sale-transfer-qr"
          >
            <path d={path} fill="#0e2433" />
          </svg>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-lg font-semibold text-foreground">{t('payment.transferPanel.title')}</p>
        <p className="mt-1 text-sm text-fg2">
          {t(
            handlesQuery.data?.qrPayload
              ? 'payment.transferPanel.scanWallet'
              : 'payment.transferPanel.scanKey'
          )}
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {handles.map(handle => (
            <li
              key={`${handle.kind}:${handle.value}`}
              className="inline-flex max-w-full items-center rounded-full bg-surface-3 px-3 py-1 text-sm font-semibold text-fg2"
              data-testid="sale-transfer-handle"
            >
              <span className="wrap-anywhere">
                {t(`payment.transferPanel.kinds.${handle.kind}`)} {handle.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
