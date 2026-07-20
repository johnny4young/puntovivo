import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData } from '@tanstack/react-query';
import { Eye, FileCode2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import {
  FiscalStatusBadge,
  type FiscalDocumentStatus,
} from '@/components/fiscal/FiscalStatusBadge';
import { FiscalMaturityBadge } from '@/components/fiscal/FiscalMaturityBadge';
import { TablePagination } from '@/components/tables/TablePagination';
import type { FiscalDocumentListItem } from '@/types';
import { FiscalDocumentXmlModal } from './FiscalDocumentXmlModal';
import { FiscalDocumentDetailsDrawer } from './FiscalDocumentDetailsDrawer';

type FiscalKind = 'DEE' | 'FEV' | 'NC' | 'ND';
type FiscalSource = 'sale' | 'void' | 'return';

// server-side page size. The list page used to fetch a fixed
// 50-row window (`limit: 50, offset: 0`) and paginate it client-side, so a
// tenant with >50 fiscal documents could never reach the older rows. We now
// drive `reports.fiscal.list`'s `offset` from a page index so history is
// fully browsable.
const FISCAL_PAGE_SIZE = 20;

const KIND_OPTIONS: readonly FiscalKind[] = ['DEE', 'FEV', 'NC', 'ND'];
const STATUS_OPTIONS: readonly FiscalDocumentStatus[] = [
  'pending',
  'sent',
  'accepted',
  'rejected',
  'contingency',
  'voided',
  'notified_correction',
  'partial_send',
];
const SOURCE_OPTIONS: readonly FiscalSource[] = ['sale', 'void', 'return'];

/**
 * estado actual — read-only admin list of emitted fiscal documents.
 *
 * The page reads straight from the frozen `fiscal_documents` snapshot
 * columns (buyer name, total, CUFE) without ever joining `customers` /
 * `products` — that invariant is enforced by
 * `architectural-lint.test.ts` in the server package.  extends
 * this surface with a detail drawer, XML download, and contingency
 * retry actions.
 */
export function FiscalDocumentListPage() {
  const { t } = useTranslation('fiscal');

  const [kind, setKind] = useState<FiscalKind | ''>('');
  const [status, setStatus] = useState<FiscalDocumentStatus | ''>('');
  const [source, setSource] = useState<FiscalSource | ''>('');
  // zero-based server page. Any filter change resets it to 0 in the
  // same event (see the select handlers) so we never request an out-of-range
  // offset for a now-shorter result set.
  const [pageIndex, setPageIndex] = useState(0);
  // : documento seleccionado para mostrar el XML CFDI 4.0
  // del adapter MX en un modal admin-only.
  // : el modal ahora resuelve el XML body server-side via
  // `reports.fiscal.getXml` — el list page sólo necesita pasar el
  // `documentId` interno + metadata visible.
  const [xmlModalDoc, setXmlModalDoc] = useState<{
    documentId: string;
    cufe: string;
    documentNumber: string;
  } | null>(null);
  // row-detail Drawer holding the columns trimmed off the default
  // table (provider id, full CUFE) plus the full record.
  const [detailsDoc, setDetailsDoc] = useState<FiscalDocumentListItem | null>(null);

  const queryInput = useMemo(
    () => ({
      limit: FISCAL_PAGE_SIZE,
      offset: pageIndex * FISCAL_PAGE_SIZE,
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    }),
    [kind, status, source, pageIndex]
  );

  const listQuery = trpc.reports.fiscal.list.useQuery(queryInput, {
    staleTime: 30_000,
    // keep the current page rendered while the next page loads so
    // paging does not flash an empty table (also avoids a CLS jolt).
    placeholderData: keepPreviousData,
  });

  // `setKind` etc. must reset the page in the same event; doing it
  // in an effect would briefly query the old offset against the new filter.
  const resetPage = () => setPageIndex(0);

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / FISCAL_PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : pageIndex * FISCAL_PAGE_SIZE + 1;
  const rangeEnd = Math.min((pageIndex + 1) * FISCAL_PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-secondary-900">{t('page.title')}</h1>

      <div className="card p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block">
            <span className="label">{t('filters.kind')}</span>
            <select
              className="input mt-1"
              value={kind}
              onChange={event => {
                setKind(event.target.value as FiscalKind | '');
                resetPage();
              }}
              aria-label={t('filters.kind')}
            >
              <option value="">{t('filters.all')}</option>
              {KIND_OPTIONS.map(option => (
                <option key={option} value={option}>
                  {t(`kind.${option}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('filters.status')}</span>
            <select
              className="input mt-1"
              value={status}
              onChange={event => {
                setStatus(event.target.value as FiscalDocumentStatus | '');
                resetPage();
              }}
              aria-label={t('filters.status')}
            >
              <option value="">{t('filters.all')}</option>
              {STATUS_OPTIONS.map(option => (
                <option key={option} value={option}>
                  {t(`status.${option}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">{t('filters.source')}</span>
            <select
              className="input mt-1"
              value={source}
              onChange={event => {
                setSource(event.target.value as FiscalSource | '');
                resetPage();
              }}
              aria-label={t('filters.source')}
            >
              <option value="">{t('filters.all')}</option>
              {SOURCE_OPTIONS.map(option => (
                <option key={option} value={option}>
                  {t(`source.${option}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-4 space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">{t('list.title')}</h2>
          <p className="text-sm text-secondary-500">{t('list.description')}</p>
        </div>

        {listQuery.isLoading ? (
          <p className="text-sm text-secondary-500">{t('list.loading')}</p>
        ) : listQuery.error ? (
          <p className="text-sm text-state-danger">{t('list.error')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-secondary-500">{t('list.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.14em] text-secondary-500">
                <tr>
                  <th className="py-2 pr-4">{t('list.columns.emittedAt')}</th>
                  <th className="py-2 pr-4">{t('list.columns.kind')}</th>
                  <th className="py-2 pr-4">{t('list.columns.status')}</th>
                  <th className="py-2 pr-4">{t('list.columns.documentNumber')}</th>
                  <th className="py-2 pr-4">{t('list.columns.buyer')}</th>
                  <th className="py-2 pr-4 text-right">{t('list.columns.total')}</th>
                  {/* provider id + (truncated) CUFE trimmed into the
                      row-detail drawer; the drawer shows the full CUFE + XML. */}
                  <th className="py-2 text-right">
                    <span className="sr-only">{t('list.columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(row => (
                  <tr key={row.id} className="border-t border-line/60 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap text-secondary-700">
                      {formatDateTime(row.emittedAt)}
                    </td>
                    <td className="py-2 pr-4 text-secondary-800">
                      {t(`kind.${row.kind as FiscalKind}`)}
                    </td>
                    <td className="py-2 pr-4 text-secondary-800">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <FiscalStatusBadge status={row.status} />
                        {/* never let a mock/draft doc read as production. */}
                        <FiscalMaturityBadge maturity={row.maturity} />
                      </div>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-secondary-700">
                      {row.documentNumber}
                    </td>
                    <td className="py-2 pr-4 text-secondary-800">{row.buyerName}</td>
                    <td className="py-2 pr-4 text-right text-secondary-800">
                      {formatCurrency(row.totalAmount, row.currencyCode)}
                    </td>
                    <td className="py-2 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        {/* Details (eye) is the progressive-disclosure
                            affordance for the trimmed provider / CUFE columns. */}
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs inline-flex items-center gap-1"
                          onClick={() => setDetailsDoc(row)}
                          aria-label={t('list.details.viewAria')}
                          title={t('list.details.viewAria')}
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        {row.xmlRef ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs inline-flex items-center gap-1"
                            onClick={() =>
                              setXmlModalDoc({
                                documentId: row.id,
                                cufe: row.cufe,
                                documentNumber: row.documentNumber,
                              })
                            }
                            aria-label={t('document.xml.viewButton')}
                          >
                            <FileCode2 className="h-3.5 w-3.5" aria-hidden />
                            <span>{t('document.xml.viewButton')}</span>
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination
              page={pageIndex}
              pageCount={pageCount}
              total={total}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onPageChange={setPageIndex}
            />
          </div>
        )}
      </div>

      <FiscalDocumentDetailsDrawer
        item={detailsDoc}
        onClose={() => setDetailsDoc(null)}
        onViewXml={doc => {
          setDetailsDoc(null);
          setXmlModalDoc({
            documentId: doc.id,
            cufe: doc.cufe,
            documentNumber: doc.documentNumber,
          });
        }}
      />

      <FiscalDocumentXmlModal
        isOpen={xmlModalDoc !== null}
        onClose={() => setXmlModalDoc(null)}
        documentId={xmlModalDoc?.documentId ?? ''}
        cufe={xmlModalDoc?.cufe ?? ''}
        documentNumber={xmlModalDoc?.documentNumber ?? ''}
      />
    </div>
  );
}
