/**
 * In-app fiscal proof block for SaleDetailsModal.
 *
 * Per linked fiscal_document, renders:
 * - Kind label + status badge + document number header
 * - CUFE: full mono text + copy button when accepted+non-placeholder;
 * "Pendiente de aceptación" copy in any other state.
 * - "Verificar en DIAN/SAT/SII" link when qrPayload non-null.
 * - "Ver XML" link when xmlRef present (admin-only).
 *
 * Status copy is the SINGLE source of truth — the UI never infers
 * "Aceptado" from CUFE presence.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ExternalLink, FileText } from 'lucide-react';
import { FiscalMaturityBadge, type FiscalMaturity } from '@/components/fiscal/FiscalMaturityBadge';
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
  maturity: FiscalMaturity;
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
 * Certified packs show the authority identifier only in an acknowledged
 * status. Mock and draft packs may show their finalized local identifier for
 * diagnostics, but the maturity notice makes clear that it was not transmitted.
 */
const CUFE_ELIGIBLE_STATUSES: ReadonlySet<FiscalDocumentStatus> = new Set(['accepted', 'sent']);

function normalizeCountryCode(countryCode: string): string {
  return countryCode.toUpperCase();
}

function getFiscalAuthorityLabel(t: TFunction, countryCode: string): string {
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

export function SaleDetailsFiscalBlock({ fiscalDocuments, isAdmin }: SaleDetailsFiscalBlockProps) {
  const { t } = useTranslation(['receipts', 'fiscal']);
  const [selectedXmlDoc, setSelectedXmlDoc] = useState<SaleFiscalDocumentSummary | null>(null);

  return (
    <>
      <div className="mt-6 space-y-4">
        {fiscalDocuments.map(doc => {
          const sourceLabel = t(`receipts:fiscal.source.${doc.source}`);
          const kindLabel = t(`fiscal:kind.${doc.kind}`, { defaultValue: doc.kind });
          const authorityLabel = getFiscalAuthorityLabel(t, doc.countryCode);
          const isCertified = doc.maturity === 'certified';
          const hasFinalIdentifier = !isPlaceholderCufe(doc.cufe);
          const showIdentifier =
            hasFinalIdentifier && (!isCertified || CUFE_ELIGIBLE_STATUSES.has(doc.status));
          const identifierLabel = isCertified
            ? t(getFiscalIdentifierLabelKey(doc.countryCode))
            : t('receipts:fiscal.localIdentifierLabel');

          return (
            <div key={doc.id} className="rounded-lg border border-border bg-surface-muted p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-foreground">
                  {t('receipts:fiscal.sectionTitle')}
                </span>
                <FiscalStatusBadge status={doc.status} />
                <FiscalMaturityBadge maturity={doc.maturity} />
                <span className="text-xs text-muted-foreground">{kindLabel}</span>
                <span className="ml-auto text-xs font-mono">{doc.documentNumber}</span>
              </div>

              {!isCertified && (
                <p
                  className="mt-3 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs text-warning-900"
                  data-testid="fiscal-non-certified-notice"
                >
                  {t(`receipts:fiscal.nonCertifiedNotice.${doc.maturity}`, {
                    authority: authorityLabel,
                  })}
                </p>
              )}

              <dl className="mt-3 grid grid-cols-1 gap-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <dt className="text-muted-foreground">{identifierLabel}</dt>
                  <dd
                    className={
                      showIdentifier
                        ? 'font-mono break-all text-right max-w-[60%]'
                        : 'italic text-right text-muted-foreground'
                    }
                  >
                    {showIdentifier ? doc.cufe : t('receipts:fiscal.cufePlaceholder')}
                  </dd>
                </div>

                {doc.resolution && (
                  <div className="flex items-start justify-between gap-2">
                    <dt className="text-muted-foreground">{t('receipts:fiscal.resolution')}</dt>
                    <dd className="max-w-[65%] text-right">{doc.resolution}</dd>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">{t('receipts:fiscal.sourceLabel')}</dt>
                  <dd>{sourceLabel}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                {isCertified && doc.qrPayload && (
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
          documentId={selectedXmlDoc.id}
          cufe={selectedXmlDoc.cufe}
          documentNumber={selectedXmlDoc.documentNumber}
        />
      )}
    </>
  );
}
