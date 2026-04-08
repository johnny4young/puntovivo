import { Building2 as Building, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { Company, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { CompanyBackupCard } from './CompanyBackupCard';
import { CompanyPrintSettingsCard } from './CompanyPrintSettingsCard';

interface CompanyFormValues {
  name: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  logoUrl: string;
}

const defaultValues: CompanyFormValues = {
  name: '',
  taxId: '',
  address: '',
  phone: '',
  email: '',
  logoUrl: '',
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
    logoUrl: company.logoUrl ?? '',
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
            {company?.name ?? 'Create your company profile'}
          </p>
          <p className="text-sm text-secondary-500">
            This record is used by sites, future documents, and business settings.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="company-name" className="label">
            Company Name
          </label>
          <input
            id="company-name"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('name', { required: 'Company name is required' })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="company-tax-id" className="label">
            Tax ID
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
            Email
          </label>
          <input
            id="company-email"
            type="email"
            className="input mt-1"
            disabled={!canEdit}
            {...form.register('email', {
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: 'Invalid email address',
              },
            })}
          />
          {form.formState.errors.email && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="company-phone" className="label">
            Phone
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
          Address
        </label>
        <textarea
          id="company-address"
          className="input mt-1 min-h-[96px]"
          disabled={!canEdit}
          {...form.register('address')}
        />
      </div>

      <div>
        <label htmlFor="company-logo-url" className="label">
          Logo URL
        </label>
        <input
          id="company-logo-url"
          className="input mt-1"
          placeholder="https://example.com/logo.png"
          disabled={!canEdit}
          {...form.register('logoUrl')}
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
          {isSaving ? 'Saving...' : 'Save Company'}
        </button>
      </div>
    </form>
  );
}

function canManageCompany(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function CompanyPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const companyQuery = trpc.companies.getCurrent.useQuery();
  const company = companyQuery.data ?? null;
  const canEdit = canManageCompany(user?.role);

  const upsertMutation = trpc.companies.upsert.useMutation({
    onSuccess: async company => {
      await utils.companies.getCurrent.setData(undefined, company);
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
      logoUrl: values.logoUrl || null,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">Company</h1>
        <p className="mt-1 text-sm text-secondary-500">
          Manage the business identity used across your tenant.
        </p>
      </div>

      {companyQuery.isLoading && (
        <PageLoadingState
          title="Company"
          description="Loading the business identity and workstation settings."
        />
      )}
      {companyQuery.error && (
        <QueryErrorState
          title="Unable to load company settings"
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

      {canEdit && (
        <div className="grid gap-6 xl:grid-cols-2">
          <CompanyPrintSettingsCard />
          <CompanyBackupCard />
        </div>
      )}
    </div>
  );
}
