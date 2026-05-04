/**
 * ENG-058 — In-app fiscal proof block for SaleDetailsModal.
 *
 * Per linked fiscal_document, renders:
 *   - Kind label + status badge + document number header
 *   - CUFE: full mono text + copy button when accepted+non-placeholder;
 *           "Pendiente de aceptación" copy in any other state.
 *   - "Verificar en DIAN/SAT/SII" link when qrPayload non-null.
 *   - "Ver XML" link when xmlRef present (admin-only).
 *
 * Status copy is the SINGLE source of truth — the UI never infers
 * "Aceptado" from CUFE presence.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ExternalLink, FileText } from 'lucide-react';
import {
  FiscalStatusBadge,
  type FiscalDocumentStatus,
} from '@/components/fiscal/FiscalStatusBadge';
import { FiscalDocumentXmlModal } from '@/features/fiscal/FiscalDocumentXmlModal';

export interface SaleFiscalDocumentSummary {
  id: string;
  source: 'sale' | 'void' | 'return';
  kind: 'DEE' | 'FEV' | 'NC' | 'ND';
  cufe: string;
  documentNumber: string;
  status: FiscalDocumentStatus;
  qrPayload: string | null;
  xmlRef: string | null;
  resolution: string | null;
  emittedAt: string;
  countryCode: string;
}

export interface SaleDetailsFiscalBlockProps {
  fiscalDocuments: SaleFiscalDocumentSummary[];
  isAdmin: boolean;
}

function isPlaceholderCufe(cufe: string | null | undefined): boolean {
  if (!cufe) return true;
  return cufe.startsWith('pending-');
}

/**
 * The CUFE display mirrors the QR builder's eligibility: only render the
 * real CUFE when the document is in a status the provider has acknowledged
 * AND the cufe is no longer the `pending-<nanoid>` placeholder. The
 * MockAdapter (and real DIAN PT after ENG-021) returns `sent` on the happy
 * path; widening the gate beyond `accepted` keeps real receipts from
 * rendering "Pendiente de aceptación" while a verifiable CUFE exists.
 */
const CUFE_ELIGIBLE_STATUSES: ReadonlySet<FiscalDocumentStatus> = new Set([
  'accepted',
  'sent',
]);

function normalizeCountryCode(countryCode: string): string {
  return countryCode.toUpperCase();
}

function getFiscalAuthorityLabel(
  t: TFunction,
  countryCode: string
): string {
  const normalized = normalizeCountryCode(countryCode);
  return t(`receipts:fiscal.authority.${normalized}`, {
    defaultValue: normalized,
  });
}

function getFiscalIdentifierLabelKey(countryCode: string): string {
  switch (normalizeCountryCode(countryCode)) {
    case 'MX':
      return 'receipts:fiscal.uuidLabel';
    case 'CL':
      return 'receipts:fiscal.tedLabel';
    default:
      return 'receipts:fiscal.cufeLabel';
  }
}

export function SaleDetailsFiscalBlock({
  fiscalDocuments,
  isAdmin,
}: SaleDetailsFiscalBlockProps) {
  const { t } = useTranslation(['receipts', 'fiscal']);
  const [selectedXmlDoc, setSelectedXmlDoc] =
    useState<SaleFiscalDocumentSummary | null>(null);

  return (
    <>
      <div className="mt-6 space-y-4">
        {fiscalDocuments.map(doc => {
          const showRealCufe =
            CUFE_ELIGIBLE_STATUSES.has(doc.status) && !isPlaceholderCufe(doc.cufe);
          const sourceLabel = t(`receipts:fiscal.source.${doc.source}`);
          const kindLabel = t(`fiscal:kind.${doc.kind}`, { defaultValue: doc.kind });
          const authorityLabel = getFiscalAuthorityLabel(t, doc.countryCode);

          return (
            <div
              key={doc.id}
              className="rounded-lg border border-border bg-surface-muted p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {t('receipts:fiscal.sectionTitle')}
                </span>
                <FiscalStatusBadge status={doc.status} />
                <span className="text-xs text-muted-foreground">{kindLabel}</span>
                <span className="ml-auto text-xs font-mono">
                  {doc.documentNumber}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t(getFiscalIdentifierLabelKey(doc.countryCode))}
                  </dt>
                  <dd
                    className={
                      showRealCufe
                        ? 'font-mono break-all text-right max-w-[60%]'
                        : 'italic text-right text-muted-foreground'
                    }
                  >
                    {showRealCufe
                      ? doc.cufe
                      : t('receipts:fiscal.cufePlaceholder')}
                  </dd>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">
                    {t('receipts:fiscal.sourceLabel')}
                  </dt>
                  <dd>{sourceLabel}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                {doc.qrPayload && (
                  <a
                    href={doc.qrPayload}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary-700 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    {t('receipts:fiscal.verifyLink', { authority: authorityLabel })}
                  </a>
                )}
                {isAdmin && doc.xmlRef && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => setSelectedXmlDoc(doc)}
                  >
                    <FileText className="h-3 w-3" aria-hidden="true" />
                    {t('receipts:fiscal.viewXml')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {selectedXmlDoc && (
        <FiscalDocumentXmlModal
          isOpen
          onClose={() => setSelectedXmlDoc(null)}
          xml={selectedXmlDoc.xmlRef}
          cufe={selectedXmlDoc.cufe}
          documentNumber={selectedXmlDoc.documentNumber}
        />
      )}
    </>
  );
}
