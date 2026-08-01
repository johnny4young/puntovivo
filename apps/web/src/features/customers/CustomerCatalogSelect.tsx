import type { UseFormRegisterReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { CustomerCatalogItem } from '@/types';
import type { CustomerCatalogKey } from '@/features/customer-catalogs/customerCatalogConfig';
import { resolveCustomerCatalogDisplayName } from '@/features/customer-catalogs/customerCatalogDisplayName';

interface CustomerCatalogSelectProps {
  id: string;
  label: string;
  placeholder: string;
  registration: UseFormRegisterReturn;
  options: CustomerCatalogItem[];
  catalog: CustomerCatalogKey;
}

export function CustomerCatalogSelect({
  id,
  label,
  placeholder,
  registration,
  options,
  catalog,
}: CustomerCatalogSelectProps) {
  const { t } = useTranslation('customerCatalogs');

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="input mt-1" {...registration}>
        <option value="">{placeholder}</option>
        {options.map(option => (
          <option key={option.id} value={option.code} disabled={!option.isActive}>
            {option.code} · {resolveCustomerCatalogDisplayName(t, catalog, option)}
            {!option.isActive ? ` (${t('columns.inactive')})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
