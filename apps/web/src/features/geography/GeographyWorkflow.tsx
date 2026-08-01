import { Building2, Flag, Map, MapPinned, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { GeographyLevel } from '@/features/geography/geography.types';
import type { Country, Department } from '@/types';

const LEVELS: readonly { key: GeographyLevel; icon: LucideIcon; step: number }[] = [
  { key: 'countries', icon: Flag, step: 1 },
  { key: 'departments', icon: Building2, step: 2 },
  { key: 'cities', icon: MapPinned, step: 3 },
];

export function GeographyHeader(): React.ReactElement {
  const { t } = useTranslation('geography');
  return (
    <header className="mb-6 rounded-[1.5rem] border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary-100 bg-primary-50 text-primary-800">
          <Map className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.18em] text-primary-800">
            {t('eyebrow')}
          </p>
          <h1 className="mt-1 font-display text-3xl leading-tight text-secondary-950">
            {t('title')}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-600">
            {t('description')}
          </p>
        </div>
      </div>
    </header>
  );
}

export function GeographyLevelNav({
  activeLevel,
  onChange,
}: {
  activeLevel: GeographyLevel;
  onChange: (level: GeographyLevel) => void;
}): React.ReactElement {
  const { t } = useTranslation('geography');
  return (
    <div
      className="mb-6 grid gap-2 rounded-[1.5rem] border border-line bg-card p-2 shadow-sm md:grid-cols-3"
      role="tablist"
      aria-label={t('workflow.label')}
    >
      {LEVELS.map(({ key, icon: Icon, step }) => {
        const selected = activeLevel === key;
        return (
          <button
            key={key}
            type="button"
            id={`geography-tab-${key}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`geography-panel-${key}`}
            className={`flex min-h-[4.5rem] items-center gap-3 rounded-[1.1rem] border px-3.5 py-3 text-left transition-colors ${
              selected
                ? 'border-primary-700 bg-primary-950 text-white shadow-sm'
                : 'border-transparent text-secondary-700 hover:border-line hover:bg-surface-2'
            }`}
            onClick={() => onChange(key)}
          >
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-xs font-bold ${
                selected
                  ? 'border-white/20 bg-white/10 text-white'
                  : 'border-secondary-200 bg-white text-secondary-700'
              }`}
              aria-hidden="true"
            >
              {step}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 font-semibold">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {t(`levels.${key}`)}
              </span>
              <span
                className={`mt-1 block text-xs leading-4 ${
                  selected ? 'text-white/70' : 'text-secondary-500'
                }`}
              >
                {t(`workflow.${key}`)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function GeographyParentContext({
  activeLevel,
  countries,
  departments,
  selectedCountryId,
  selectedDepartmentId,
  isCountriesLoading,
  isDepartmentsLoading,
  onCountryChange,
  onDepartmentChange,
}: {
  activeLevel: GeographyLevel;
  countries: Country[];
  departments: Department[];
  selectedCountryId: string;
  selectedDepartmentId: string;
  isCountriesLoading: boolean;
  isDepartmentsLoading: boolean;
  onCountryChange: (countryId: string) => void;
  onDepartmentChange: (departmentId: string) => void;
}): React.ReactElement | null {
  const { t } = useTranslation('geography');
  if (activeLevel === 'countries') return null;

  return (
    <section
      className="mb-6 rounded-[1.5rem] border border-line bg-surface-2/50 p-4 sm:p-5"
      aria-labelledby="geography-context-title"
    >
      <div className="mb-4">
        <h2 id="geography-context-title" className="text-base font-semibold text-secondary-950">
          {t('context.title')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{t(`context.${activeLevel}`)}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label htmlFor="geography-country-context" className="pv-field">
          <span className="label">{t('context.country')}</span>
          <select
            id="geography-country-context"
            className="pv-input"
            value={selectedCountryId}
            onChange={event => onCountryChange(event.target.value)}
            disabled={isCountriesLoading}
          >
            <option value="">
              {isCountriesLoading ? t('context.loadingCountries') : t('context.selectCountry')}
            </option>
            {countries.map(country => (
              <option key={country.id} value={country.id} disabled={!country.isActive}>
                {country.name}
              </option>
            ))}
          </select>
        </label>

        {activeLevel === 'cities' ? (
          <label htmlFor="geography-department-context" className="pv-field">
            <span className="label">{t('context.department')}</span>
            <select
              id="geography-department-context"
              className="pv-input"
              value={selectedDepartmentId}
              onChange={event => onDepartmentChange(event.target.value)}
              disabled={!selectedCountryId || isDepartmentsLoading}
            >
              <option value="">
                {isDepartmentsLoading
                  ? t('context.loadingDepartments')
                  : t('context.selectDepartment')}
              </option>
              {departments.map(department => (
                <option key={department.id} value={department.id} disabled={!department.isActive}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </section>
  );
}

export function GeographyPrerequisite({
  level,
}: {
  level: 'departments' | 'cities';
}): React.ReactElement {
  const { t } = useTranslation('geography');
  return (
    <section
      className="grid min-h-64 place-items-center rounded-[1.5rem] border border-dashed border-secondary-300 bg-card p-8 text-center"
      role="status"
    >
      <div className="max-w-md">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary-50 text-primary-800">
          <MapPinned className="h-5 w-5" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-semibold text-secondary-950">
          {t(`prerequisite.${level}.title`)}
        </h2>
        <p className="mt-2 text-sm leading-6 text-secondary-600">
          {t(`prerequisite.${level}.description`)}
        </p>
      </div>
    </section>
  );
}
