import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { MapPinned, Search } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Location, Site } from '@/types';

interface SiteLocationAssignmentsValues {
  locationIds: string[];
}

interface SiteLocationAssignmentsModalProps {
  isOpen: boolean;
  site: Site | null;
  locations: Location[];
  initialLocationIds: string[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (locationIds: string[]) => Promise<void>;
}

export function SiteLocationAssignmentsModal({
  isOpen,
  site,
  locations,
  initialLocationIds,
  isSaving,
  error,
  onClose,
  onSubmit,
}: SiteLocationAssignmentsModalProps) {
  const { t } = useTranslation('settings');
  const form = useForm<SiteLocationAssignmentsValues>({
    defaultValues: {
      locationIds: initialLocationIds,
    },
  });
  const [search, setSearch] = useState('');
  const selectedIds = new Set(form.watch('locationIds'));
  const normalizedSearch = search.trim().toLowerCase();
  const filteredLocations = locations.filter(location => {
    if (normalizedSearch.length === 0) {
      return true;
    }

    return (
      location.name.toLowerCase().includes(normalizedSearch) ||
      location.code.toLowerCase().includes(normalizedSearch) ||
      (location.description ?? '').toLowerCase().includes(normalizedSearch)
    );
  });

  const toggleLocation = (locationId: string) => {
    const nextIds = selectedIds.has(locationId)
      ? [...selectedIds].filter(candidateId => candidateId !== locationId)
      : [...selectedIds, locationId];

    form.setValue('locationIds', nextIds, { shouldDirty: true });
  };

  const handleSubmit = form.handleSubmit(async values => {
    await onSubmit(values.locationIds);
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={site ? `${t('sites.locations.manage')} ${site.name}` : t('sites.locations.title')}
      size="lg"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('sites.locations.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('sites.locations.submitting') : t('sites.locations.save')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
          {t('sites.locations.hint')}
        </div>

        <label className="block">
          <span className="label">{t('sites.locations.search')}</span>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="input pl-9"
              placeholder={t('sites.locations.searchPlaceholder')}
            />
          </div>
        </label>

        <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
          {filteredLocations.length === 0 && (
            <div className="rounded-xl border border-secondary-200 bg-white px-4 py-6 text-center text-sm text-secondary-500">
              {t('sites.locations.noMatch')}
            </div>
          )}

          {filteredLocations.map(location => {
            const isSelected = selectedIds.has(location.id);

            return (
              <label
                key={location.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-4 transition ${
                  isSelected
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-secondary-200 bg-white hover:border-secondary-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleLocation(location.id)}
                  className="mt-1 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <MapPinned className="h-4 w-4 text-primary-700" />
                    <p className="font-medium text-secondary-900">{location.name}</p>
                    <span className="rounded-full bg-secondary-100 px-2 py-0.5 text-xs text-secondary-600">
                      {location.code}
                    </span>
                    {!location.isActive && (
                      <span className="rounded-full bg-warning-100 px-2 py-0.5 text-xs text-warning-800">
                        {t('sites.locations.inactive')}
                      </span>
                    )}
                  </div>
                  {location.description && (
                    <p className="mt-1 text-sm text-secondary-500">{location.description}</p>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </div>
    </Modal>
  );
}
