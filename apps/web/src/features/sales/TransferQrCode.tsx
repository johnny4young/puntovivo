import { useEffect, useState } from 'react';

import { qrModulesPath } from './transferQrPath';

interface QrMatrix {
  payload: string;
  size: number;
  path: string;
}

/**
 * Dark-on-white QR in both themes, since phone cameras read that contrast best.
 * The encoder loads on first use so registers that never charge a transfer skip it.
 * Renders nothing if encoding fails or while `pending`; the account text stays beside it.
 */
export function TransferQrCode({
  payload,
  label,
  className,
  testId,
  pending = false,
}: {
  payload: string;
  label: string;
  pending?: boolean;
  className?: string;
  testId?: string;
}) {
  const [matrix, setMatrix] = useState<QrMatrix | null>(null);
  const [failedPayload, setFailedPayload] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void import('qrcode')
      .then(({ create }) => {
        const { modules } = create(payload, { errorCorrectionLevel: 'M' });
        if (live) {
          setMatrix({
            payload,
            size: modules.size,
            path: qrModulesPath(modules.size, modules.data),
          });
        }
      })
      .catch(() => {
        if (live) setFailedPayload(payload);
      });
    return () => {
      live = false;
    };
  }, [payload]);

  if (failedPayload === payload) return null;
  const ready = !pending && matrix?.payload === payload;
  return (
    <div
      className={className ?? 'transfer-qr'}
      data-testid={testId}
      data-ready={ready || undefined}
    >
      {ready ? (
        <svg
          role="img"
          aria-label={label}
          viewBox={`-2 -2 ${matrix.size + 4} ${matrix.size + 4}`}
          shapeRendering="crispEdges"
        >
          <path d={matrix.path} fill="#0e2433" />
        </svg>
      ) : (
        <span className="transfer-qr-pending" aria-hidden="true" />
      )}
    </div>
  );
}
