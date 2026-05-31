import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCode2 } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import {
  FiscalStatusBadge,
  type FiscalDocumentStatus,
} from '@/components/fiscal/FiscalStatusBadge';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { TablePagination } from '@/components/tables/TablePagination';
import { FiscalDocumentXmlModal } from './FiscalDocumentXmlModal';

type FiscalKind = 'DEE' | 'FEV' | 'NC' | 'ND';
type FiscalSource = 'sale' | 'void' | 'return';

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
 * ENG-020 Fase A — read-only admin list of emitted fiscal documents.
 *
 * The page reads straight from the frozen `fiscal_documents` snapshot
 * columns (buyer name, total, CUFE) without ever joining `customers` /
 * `products` — that invariant is enforced by
 * `architectural-lint.test.ts` in the server package. ENG-021 extends
 * this surface with a detail drawer, XML download, and contingency
 * retry actions.
 */
export function FiscalDocumentListPage() {
  const { t } = useTranslation('fiscal');

  const [kind, setKind] = useState<FiscalKind | ''>('');
  const [status, setStatus] = useState<FiscalDocumentStatus | ''>('');
  const [source, setSource] = useState<FiscalSource | ''>('');
  // ENG-035b: documento seleccionado para mostrar el XML CFDI 4.0
  // del adapter MX en un modal admin-only.
  // ENG-103: el modal ahora resuelve el XML body server-side via
  // `reports.fiscal.getXml` — el list page sólo necesita pasar el
  // `documentId` interno + metadata visible.
  const [xmlModalDoc, setXmlModalDoc] = useState<{
    documentId: string;
    cufe: string;
    documentNumber: string;
  } | null>(null);

  const queryInput = useMemo(
    () => ({
      limit: 50,
      offset: 0,
      ...(kind ? { kind } : {}),
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    }),
    [kind, status, source]
  );

  const listQuery = trpc.reports.fiscal.list.useQuery(queryInput, {
    staleTime: 30_000,
  });

  const items = listQuery.data?.items ?? [];
  const { pageRows, ...pagination } = usePaginatedRows(items, 8);

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
              onChange={event => setKind(event.target.value as FiscalKind | '')}
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
              onChange={event =>
                setStatus(event.target.value as FiscalDocumentStatus | '')
              }
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
              onChange={event => setSource(event.target.value as FiscalSource | '')}
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
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('list.title')}
          </h2>
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
                  <th className="py-2 pr-4">{t('list.columns.provider')}</th>
                  <th className="py-2 pr-4">{t('list.columns.cufe')}</th>
                  <th className="py-2 text-right">
                    <span className="sr-only">{t('list.columns.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(row => (
                  <tr key={row.id} className="border-t border-line/60 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap text-secondary-700">
                      {formatDateTime(row.emittedAt)}
                    </td>
                    <td className="py-2 pr-4 text-secondary-800">
                      {t(`kind.${row.kind as FiscalKind}`)}
                    </td>
                    <td className="py-2 pr-4 text-secondary-800">
                      <FiscalStatusBadge status={row.status} />
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-secondary-700">
                      {row.documentNumber}
                    </td>
                    <td className="py-2 pr-4 text-secondary-800">{row.buyerName}</td>
                    <td className="py-2 pr-4 text-right text-secondary-800">
                      {formatCurrency(row.totalAmount, row.currencyCode)}
                    </td>
                    <td className="py-2 pr-4 text-secondary-700">{row.providerId}</td>
                    <td className="py-2 pr-4 font-mono text-[0.7rem] text-secondary-500">
                      {row.cufe.slice(0, 12)}…{row.cufe.slice(-6)}
                    </td>
                    <td className="py-2 text-right">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <TablePagination {...pagination} onPageChange={pagination.setPage} />
          </div>
        )}
      </div>

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
