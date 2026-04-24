import { Building2 as Building, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { Company, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { getErrorMessage } from '@/lib/utils';
import { CompanyBackupCard } from './CompanyBackupCard';
import { CompanyLocaleSettingsCard } from './CompanyLocaleSettingsCard';
import { CompanyAutoUpdateCard } from './CompanyAutoUpdateCard';
import { CompanyLogoLibraryCard } from './CompanyLogoLibraryCard';
import { CompanyPrintSettingsCard } from './CompanyPrintSettingsCard';
import { CompanySyncCard } from './CompanySyncCard';
import { CompanyThemeSettingsCard } from './CompanyThemeSettingsCard';
import { CompanyTraySettingsCard } from './CompanyTraySettingsCard';

interface CompanyFormValues {
  name: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
}

const defaultValues: CompanyFormValues = {
  name: '',
  taxId: '',
  address: '',
  phone: '',
  email: '',
};

function mapCompanyToForm(company: Company | null | undefined): CompanyFormValues {
  if (!company) {
    return defaultValues;
  }

  return {
    name: company.name,
    taxId: company.taxId ?? '',
    address: company.address ?? '',
    phone: company.phone ?? '',
    email: company.email ?? '',
  };
}

interface CompanyFormProps {
  company: Company | null;
  canEdit: boolean;
  isSaving: boolean;
  error: string | null;
  onSubmit: (values: CompanyFormValues) => Promise<void>;
}

function CompanyForm({ company, canEdit, isSaving, error, onSubmit }: CompanyFormProps) {
  const { t } = useTranslation('settings');
  const form = useForm<CompanyFormValues>({
    defaultValues: mapCompanyToForm(company),
  });

  const handleSubmit = form.handleSubmit(onSubmit);

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex items-center gap-3 rounded-xl bg-primary-50 px-4 py-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <Building className="h-5 w-5 text-primary-700" />
        </div>
        <div>
          <p className="font-medium text-secondary-900">
            {company?.name ?? t('company.createPrompt')}
          </p>
          <p className="text-sm text-secondary-500">
            {t('company.createNote')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="company-name" className="label">
            {t('company.fields.companyName')}
          </label>
          <input
            id="company-name"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('name', { required: t('company.fields.companyNameRequired') })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="company-tax-id" className="label">
            {t('company.fields.taxId')}
          </label>
          <input
            id="company-tax-id"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('taxId')}
          />
        </div>

        <div>
          <label htmlFor="company-email" className="label">
            {t('company.fields.email')}
          </label>
          <input
            id="company-email"
            type="email"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('email', {
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: t('company.fields.emailInvalid'),
              },
            })}
          />
          {form.formState.errors.email && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="company-phone" className="label">
            {t('company.fields.phone')}
          </label>
          <input
            id="company-phone"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('phone')}
          />
        </div>
      </div>

      <div>
        <label htmlFor="company-address" className="label">
          {t('company.fields.address')}
        </label>
        <textarea
          id="company-address"
          className="input mt-1 min-h-[96px]"
          disabled={!canEdit}
          {...form.register('address')}
        />
      </div>

      {error && <p className="text-sm text-danger-500">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSaving || !canEdit}
          className="btn-primary flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          {isSaving ? t('company.submitting') : t('company.save')}
        </button>
      </div>
    </form>
  );
}

function canManageCompany(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function CompanyPage() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const companyQuery = trpc.companies.getCurrent.useQuery();
  const company = companyQuery.data ?? null;
  const canEdit = canManageCompany(user?.role);

  const upsertMutation = trpc.companies.upsert.useMutation({
    onSuccess: async company => {
      await utils.companies.getCurrent.setData(undefined, company);
      toast.success({ title: t('company.toast.saved') });
    },
    onError: error => {
      toast.error({
        title: t('company.toast.saveError'),
        description: getErrorMessage(error, t('company.toast.saveError')),
      });
    },
  });

  const onSubmit = async (values: CompanyFormValues) => {
    if (!canEdit) {
      return;
    }

    await upsertMutation.mutateAsync({
      name: values.name,
      taxId: values.taxId || null,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">{t('company.title')}</h1>
        <p className="mt-1 text-sm text-secondary-500">
          {t('company.description')}
        </p>
      </div>

      {companyQuery.isLoading && (
        <PageLoadingState
          title={t('company.title')}
          description={t('company.loading')}
        />
      )}
      {companyQuery.error && (
        <QueryErrorState
          title={t('company.error')}
          message={companyQuery.error.message}
          onRetry={() => {
            void companyQuery.refetch();
          }}
        />
      )}
      {!companyQuery.isLoading && !companyQuery.error && (
        <div className="card p-6">
          <CompanyForm
            key={company?.id ?? 'new-company'}
            company={company}
            canEdit={canEdit}
            isSaving={upsertMutation.isPending}
            error={upsertMutation.error?.message ?? null}
            onSubmit={onSubmit}
          />
        </div>
      )}

      {!companyQuery.isLoading && !companyQuery.error && (
        <CompanyLogoLibraryCard company={company} canEdit={canEdit} />
      )}

      {canEdit && (
        <div className="grid gap-6 xl:grid-cols-2 2xl:grid-cols-3">
          <CompanyLocaleSettingsCard />
          <CompanySyncCard />
          <CompanyAutoUpdateCard />
          <CompanyThemeSettingsCard />
          <CompanyTraySettingsCard />
          <CompanyPrintSettingsCard />
          <CompanyBackupCard />
        </div>
      )}
    </div>
  );
}
