import type { ColumnDef } from '@tanstack/react-table';
import type { TFunction } from 'i18next';
import { ArrowRight, Building2, Flag, MapPinned, Pencil, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui';
import type { City, Country, Department } from '@/types';

interface BaseColumnOptions<T extends { name: string }> {
  t: TFunction<'geography'>;
  canManage: boolean;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
}

interface CountryColumnOptions extends BaseColumnOptions<Country> {
  onOpenDepartments: (country: Country) => void;
}

interface DepartmentColumnOptions extends BaseColumnOptions<Department> {
  onOpenCities: (department: Department) => void;
}

function statusColumn<T extends { isActive: boolean }>(
  t: TFunction<'geography'>
): ColumnDef<T> {
  return {
    accessorKey: 'isActive',
    header: t('columns.status'),
    size: 120,
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
        {row.original.isActive ? t('columns.available') : t('columns.unavailable')}
      </Badge>
    ),
  };
}

function mutationActions<T extends { name: string }>({
  item,
  t,
  onEdit,
  onDelete,
}: {
  item: T;
  t: TFunction<'geography'>;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
}): React.ReactElement {
  return (
    <>
      <button
        type="button"
        aria-label={t('actions.edit', { name: item.name })}
        title={t('actions.edit', { name: item.name })}
        className="btn-ghost btn-icon h-8 w-8"
        onClick={() => onEdit(item)}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        aria-label={t('actions.delete', { name: item.name })}
        title={t('actions.delete', { name: item.name })}
        className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
        onClick={() => onDelete(item)}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );
}

export function buildCountryColumns({
  t,
  canManage,
  onEdit,
  onDelete,
  onOpenDepartments,
}: CountryColumnOptions): ColumnDef<Country>[] {
  return [
    {
      accessorKey: 'name',
      header: t('columns.country'),
      size: 300,
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">
            <Flag className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="pname">{row.original.name}</p>
            <p className="sku">{row.original.code}</p>
          </div>
        </div>
      ),
    },
    statusColumn<Country>(t),
    {
      id: 'actions',
      size: canManage ? 210 : 150,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={t('actions.viewDepartmentsFor', { name: row.original.name })}
            className="btn-ghost flex min-h-8 items-center gap-1.5 px-2 text-xs"
            onClick={() => onOpenDepartments(row.original)}
          >
            {t('actions.viewDepartments')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {canManage
            ? mutationActions({ item: row.original, t, onEdit, onDelete })
            : null}
        </div>
      ),
    },
  ];
}

export function buildDepartmentColumns({
  t,
  canManage,
  onEdit,
  onDelete,
  onOpenCities,
}: DepartmentColumnOptions): ColumnDef<Department>[] {
  return [
    {
      accessorKey: 'name',
      header: t('columns.department'),
      size: 300,
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">
            <Building2 className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="pname">{row.original.name}</p>
            <p className="sku">{row.original.code}</p>
          </div>
        </div>
      ),
    },
    statusColumn<Department>(t),
    {
      id: 'actions',
      size: canManage ? 190 : 130,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            aria-label={t('actions.viewCitiesFor', { name: row.original.name })}
            className="btn-ghost flex min-h-8 items-center gap-1.5 px-2 text-xs"
            onClick={() => onOpenCities(row.original)}
          >
            {t('actions.viewCities')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {canManage
            ? mutationActions({ item: row.original, t, onEdit, onDelete })
            : null}
        </div>
      ),
    },
  ];
}

export function buildCityColumns({
  t,
  canManage,
  onEdit,
  onDelete,
}: BaseColumnOptions<City>): ColumnDef<City>[] {
  const columns: ColumnDef<City>[] = [
    {
      accessorKey: 'name',
      header: t('columns.city'),
      size: 320,
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">
            <MapPinned className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="pname">{row.original.name}</p>
            <p className="sku">{row.original.code}</p>
          </div>
        </div>
      ),
    },
    statusColumn<City>(t),
  ];

  if (canManage) {
    columns.push({
      id: 'actions',
      size: 100,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {mutationActions({ item: row.original, t, onEdit, onDelete })}
        </div>
      ),
    });
  }

  return columns;
}
