import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';

interface ResourcePageProps<TData> {
  title: string;
  /**
   * descripción opcional. Las páginas estándar dejaron de
   * renderizarla por la pasada minimalista; la prop se conserva
   * opcional para que un caller que sí necesite contexto pueda
   * pasarla puntualmente.
   */
  description?: string;
  action: ReactNode;
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading: boolean;
  error: string | null;
  /**
   * Column filtered client-side. Correct only when `data` holds every row
   * the user could match; with a paged query use {@link searchValue}
   * instead (). Optional since  so a controlled-search caller
   * can omit it entirely.
   */
  searchKey?: string;
  searchPlaceholder: string;
  /**
   * controlled (server-side) search, forwarded to DataTable. When
   * set, the search box is rendered but nothing is filtered locally: the
   * caller feeds `data` from a query that already applied the term.
   */
  searchValue?: string;
  /** Required with {@link searchValue}. */
  onSearchChange?: (value: string) => void;
  enableRowSelection?: boolean;
  pageSize?: number;
  loadingMessage: string;
  onRetry?: () => void;
  /**
   * Forwarded to the underlying DataTable. When set, the
   * keyboard user pressing Enter or Space on the focused row fires
   * this callback with the row data, mirroring the primary action
   * button (Edit / View) on each row.
   */
  onRowActivate?: (row: TData) => void;
  /**
   * densidad del DataTable subyacente. Las páginas CRUD
   * canónicas adoptan `dense` (.pv-table: cabecera sticky, cebra, filas
   * 48-52px, primera columna ancla) de forma uniforme. Un caller puede
   * forzar `default` si necesita el chrome legacy.
   */
  variant?: 'default' | 'dense';
}

export function ResourcePage<TData>({
  title,
  description,
  action,
  columns,
  data,
  isLoading,
  error,
  searchKey,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  enableRowSelection = true,
  pageSize = 10,
  loadingMessage,
  onRetry,
  onRowActivate,
  variant = 'dense',
}: ResourcePageProps<TData>) {
  const { t } = useTranslation('common');
  return (
    <div className="space-y-6">
      <div className="page-header-row">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-secondary-900">{title}</h1>
          {description && <p className="mt-1 text-sm text-secondary-500">{description}</p>}
        </div>
        <div className="page-header-actions">{action}</div>
      </div>

      <div className="card p-6">
        {isLoading && <TableLoadingState message={loadingMessage} />}
        {error && (
          <TableErrorState
            /* was `Unable to load ${title}`, hardcoded. Not a
               default a caller could override: it rendered for every locale,
               so a Spanish operator hitting a network error read
               "Unable to load clientes" — half a sentence in a language the
               product does not ship in. */
            title={t('table.loadError', { resource: title.toLowerCase() })}
            message={error}
            onRetry={onRetry}
          />
        )}
        {!isLoading && !error && (
          <DataTable
            variant={variant}
            columns={columns}
            data={data}
            searchKey={searchKey}
            searchPlaceholder={searchPlaceholder}
            searchValue={searchValue}
            onSearchChange={onSearchChange}
            enableRowSelection={enableRowSelection}
            pageSize={pageSize}
            onRowActivate={onRowActivate}
          />
        )}
      </div>
    </div>
  );
}
