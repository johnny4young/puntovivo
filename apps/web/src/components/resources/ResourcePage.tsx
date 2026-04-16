import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';

interface ResourcePageProps<TData> {
  title: string;
  description: string;
  action: ReactNode;
  columns: ColumnDef<TData>[];
  data: TData[];
  isLoading: boolean;
  error: string | null;
  searchKey: string;
  searchPlaceholder: string;
  enableRowSelection?: boolean;
  pageSize?: number;
  loadingMessage: string;
  onRetry?: () => void;
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
  enableRowSelection = true,
  pageSize = 10,
  loadingMessage,
  onRetry,
}: ResourcePageProps<TData>) {
  return (
    <div className="space-y-6">
      <div className="page-header-row">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-secondary-900">{title}</h1>
          <p className="mt-1 text-sm text-secondary-500">{description}</p>
        </div>
        <div className="page-header-actions">{action}</div>
      </div>

      <div className="card p-6">
        {isLoading && <TableLoadingState message={loadingMessage} />}
        {error && (
          <TableErrorState title={`Unable to load ${title.toLowerCase()}`} message={error} onRetry={onRetry} />
        )}
        {!isLoading && !error && (
          <DataTable
            columns={columns}
            data={data}
            searchKey={searchKey}
            searchPlaceholder={searchPlaceholder}
            enableRowSelection={enableRowSelection}
            pageSize={pageSize}
          />
        )}
      </div>
    </div>
  );
}
