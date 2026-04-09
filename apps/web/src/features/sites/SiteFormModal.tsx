import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Company, Site } from '@/types';

export interface SiteFormValues {
  name: string;
  address: string;
  phone: string;
  isActive: boolean;
}

const defaultValues: SiteFormValues = {
  name: '',
  address: '',
  phone: '',
  isActive: true,
};

export function mapSiteToForm(site: Site | null): SiteFormValues {
  if (!site) {
    return defaultValues;
  }

  return {
    name: site.name,
    address: site.address ?? '',
    phone: site.phone ?? '',
    isActive: site.isActive,
  };
}

interface SiteFormModalProps {
  company: Company | null;
  isOpen: boolean;
  site: Site | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: SiteFormValues) => Promise<void>;
}

export function SiteFormModal({
  company,
  isOpen,
  site,
  isSaving,
  error,
  onClose,
  onSubmit,
}: SiteFormModalProps) {
  const form = useForm<SiteFormValues>({
    defaultValues: mapSiteToForm(site),
  });

  const handleSubmit = form.handleSubmit(onSubmit);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={site ? 'Edit Site' : 'Create Site'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton
            variant="primary"
            type="submit"
            onClick={handleSubmit}
            disabled={isSaving || !company}
          >
            {isSaving ? 'Saving...' : site ? 'Save Changes' : 'Create Site'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="site-name" className="label">
            Site Name
          </label>
          <input
            id="site-name"
            className="input mt-1"
            {...form.register('name', { required: 'Site name is required' })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>
        <div>
          <label htmlFor="site-address" className="label">
            Address
          </label>
          <textarea id="site-address" className="input mt-1 min-h-[88px]" {...form.register('address')} />
        </div>
        <div>
          <label htmlFor="site-phone" className="label">
            Phone
          </label>
          <input id="site-phone" className="input mt-1" {...form.register('phone')} />
        </div>
        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          Site is active
        </label>
        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
