import type { ReactNode } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/tables/DataTable';
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
}: ResourcePageProps<TData>) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">{title}</h1>
          <p className="mt-1 text-sm text-secondary-500">{description}</p>
        </div>
        {action}
      </div>

      <div className="card p-6">
        {isLoading && <TableLoadingState message={loadingMessage} />}
        {error && <p className="py-4 text-danger-500">{error}</p>}
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
