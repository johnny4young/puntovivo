import type { UseFormRegisterReturn } from 'react-hook-form';
import type { CustomerCatalogItem } from '@/types';

interface CustomerCatalogSelectProps {
  id: string;
  label: string;
  placeholder: string;
  registration: UseFormRegisterReturn;
  options: CustomerCatalogItem[];
}

export function CustomerCatalogSelect({
  id,
  label,
  placeholder,
  registration,
  options,
}: CustomerCatalogSelectProps) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="input mt-1" {...registration}>
        <option value="">{placeholder}</option>
        {options.map(option => (
          <option key={option.id} value={option.code} disabled={!option.isActive}>
            {option.code} · {option.name}
            {!option.isActive ? ' (Inactive)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
