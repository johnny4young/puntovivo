import { Building2 as Building, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { SimpleFormField } from '@/components/form-controls/FormField';
import { cn } from '@/lib/utils';
import type { Company } from '@/types';
import { CompanyCashCloseSettingsCard } from './CompanyCashCloseSettingsCard';
import { CompanyLogoLibraryCard } from './CompanyLogoLibraryCard';

export interface CompanyFormValues {
  name: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
}

interface CompanyProfileSettingsProps {
  company: Company | null;
  canEdit: boolean;
  isSaving: boolean;
  error: string | null;
  includeCashClose?: boolean;
  onSubmit: (values: CompanyFormValues) => Promise<void>;
}

const DEFAULT_COMPANY_FORM_VALUES: CompanyFormValues = {
  name: '',
  taxId: '',
  address: '',
  phone: '',
  email: '',
};

function mapCompanyToForm(company: Company | null): CompanyFormValues {
  if (!company) return DEFAULT_COMPANY_FORM_VALUES;

  return {
    name: company.name,
    taxId: company.taxId ?? '',
    address: company.address ?? '',
    phone: company.phone ?? '',
    email: company.email ?? '',
  };
}

/**
 * Builds the `error` prop for SimpleFormField under
 * `exactOptionalPropertyTypes`: omit the prop instead of passing `undefined`.
 */
function errorProp(message: string | undefined): { error?: string } {
  return message ? { error: message } : {};
}

/** ENG-178 — Shared company profile form and adjacent general settings. */
export function CompanyProfileSettings({
  company,
  canEdit,
  isSaving,
  error,
  includeCashClose = false,
  onSubmit,
}: CompanyProfileSettingsProps): React.ReactElement {
  const { t } = useTranslation('settings');
  const form = useForm<CompanyFormValues>({
    defaultValues: mapCompanyToForm(company),
  });
  const errors = form.formState.errors;

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="flex items-center gap-3 rounded-2xl border border-primary-200/55 bg-primary-50/55 px-4 py-3.5">
            <span className="pv-gt pv-gt-primary h-11 w-11">
              <Building className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-medium text-secondary-900">
                {company?.name ?? t('company.createPrompt')}
              </p>
              <p className="text-sm text-secondary-500">{t('company.createNote')}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <SimpleFormField
              label={t('company.fields.companyName')}
              htmlFor="company-name"
              required
              {...errorProp(errors.name?.message)}
            >
              <input
                id="company-name"
                className={cn('pv-input', errors.name && 'error')}
                disabled={!canEdit}
                {...form.register('name', {
                  required: t('company.fields.companyNameRequired'),
                })}
              />
            </SimpleFormField>

            <SimpleFormField label={t('company.fields.taxId')} htmlFor="company-tax-id">
              <input
                id="company-tax-id"
                className="pv-input font-mono"
                disabled={!canEdit}
                {...form.register('taxId')}
              />
            </SimpleFormField>

            <SimpleFormField
              label={t('company.fields.email')}
              htmlFor="company-email"
              {...errorProp(errors.email?.message)}
            >
              <input
                id="company-email"
                type="email"
                className={cn('pv-input', errors.email && 'error')}
                disabled={!canEdit}
                {...form.register('email', {
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: t('company.fields.emailInvalid'),
                  },
                })}
              />
            </SimpleFormField>

            <SimpleFormField label={t('company.fields.phone')} htmlFor="company-phone">
              <input
                id="company-phone"
                className="pv-input font-mono"
                disabled={!canEdit}
                {...form.register('phone')}
              />
            </SimpleFormField>
          </div>

          <SimpleFormField label={t('company.fields.address')} htmlFor="company-address">
            <textarea
              id="company-address"
              className="pv-input area min-h-[96px]"
              disabled={!canEdit}
              {...form.register('address')}
            />
          </SimpleFormField>

          {error && (
            <p className="err-msg" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            <button type="submit" disabled={isSaving || !canEdit} className="pv-btn primary">
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSaving ? t('company.submitting') : t('company.save')}
            </button>
          </div>
        </form>
      </div>

      <CompanyLogoLibraryCard company={company} canEdit={canEdit} />
      {includeCashClose && <CompanyCashCloseSettingsCard />}
    </div>
  );
}
