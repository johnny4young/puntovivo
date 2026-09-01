import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_GS1_PREFIX_CONFIG,
  GS1_IN_STORE_PREFIXES,
  GS1_SCHEMES,
  isGs1PrefixConfig,
  type Gs1InStorePrefix,
  type Gs1PrefixConfig,
  type Gs1PrefixRole,
  type Gs1Scheme,
} from '@puntovivo/shared/gs1';
import { Modal, ModalButton } from '@/components/form-controls/Modal';

/**
 * Peripheral register/update modal.
 *
 * The form is intentionally minimal: kind picker, driver picker
 * filtered by kind, optional display name, and a raw JSON textarea
 * for `config`.  will swap the JSON textarea for
 * typed per-driver forms once their adapters land.
 *
 * The kind field is locked when editing an existing peripheral
 * because the router's `update` procedure does not accept a kind
 * change — switching kinds requires removing + re-registering, which
 * matches the partial-unique constraint semantics.
 */

type PeripheralKind =
  'printer' | 'cash_drawer' | 'scanner' | 'payment_terminal' | 'customer_display';

const KIND_ORDER: PeripheralKind[] = [
  'printer',
  'cash_drawer',
  'scanner',
  'payment_terminal',
  'customer_display',
];

// Map of (kind → drivers shown in the picker). The flag `available`
// reflects whether  ships the adapter; non-available rows
// surface a driverHint copy explaining which  unlocks them.
const DRIVER_OPTIONS: Record<PeripheralKind, Array<{ id: string; available: boolean }>> = {
  printer: [
    { id: 'system', available: true },
    // ESC/POS thermal printer driver shipped.
    { id: 'escpos', available: true },
  ],
  cash_drawer: [
    // RJ11 cash drawer via the ESC/POS printer stream.
    { id: 'escpos', available: true },
  ],
  scanner: [
    // USB HID keyboard-wedge driver shipped.
    { id: 'wedge', available: true },
  ],
  payment_terminal: [
    { id: 'manual', available: true },
    { id: 'bold', available: false },
    { id: 'wompi', available: false },
    { id: 'mercadopago', available: false },
  ],
  customer_display: [{ id: 'escpos', available: false }],
};

function defaultConfigFor(kind: PeripheralKind, driver: string): Record<string, unknown> {
  if ((kind === 'printer' || kind === 'cash_drawer') && driver === 'escpos') {
    return {
      channel: 'tcp',
      host: '192.168.1.50',
      port: 9100,
    };
  }
  if (kind === 'scanner' && driver === 'wedge') {
    return {
      minLength: 6,
      maxLength: 32,
      interCharGapMs: 30,
      endOfScan: 'enter',
      gs1Scheme: 'generic',
      gs1Prefixes: {
        weight: [...DEFAULT_GS1_PREFIX_CONFIG.weight],
        price: [...DEFAULT_GS1_PREFIX_CONFIG.price],
      },
    };
  }
  return {};
}

function readGs1Scheme(config: Record<string, unknown>): Gs1Scheme | null {
  const value = config.gs1Scheme;
  if (value === undefined) return 'generic';
  return GS1_SCHEMES.includes(value as Gs1Scheme) ? (value as Gs1Scheme) : null;
}

function readGs1Prefixes(config: Record<string, unknown>): Gs1PrefixConfig | null {
  const value = config.gs1Prefixes;
  if (value === undefined) return DEFAULT_GS1_PREFIX_CONFIG;
  return isGs1PrefixConfig(value) ? value : null;
}

function roleForPrefix(prefix: Gs1InStorePrefix, config: Gs1PrefixConfig): Gs1PrefixRole | 'none' {
  if (config.weight.includes(prefix)) return 'weight';
  if (config.price.includes(prefix)) return 'price';
  return 'none';
}

export interface PeripheralFormInitial {
  id: string;
  kind: PeripheralKind;
  driver: string;
  displayName: string | null;
  config: Record<string, unknown>;
}

export interface PeripheralFormValues {
  kind: PeripheralKind;
  driver: string;
  displayName: string | null;
  config: Record<string, unknown>;
}

interface PeripheralFormProps {
  isOpen: boolean;
  initial: PeripheralFormInitial | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: PeripheralFormValues) => Promise<void> | void;
}

function formatConfigForInput(config: Record<string, unknown>): string {
  if (!config || Object.keys(config).length === 0) {
    return '{}';
  }
  return JSON.stringify(config, null, 2);
}

export function PeripheralForm({
  isOpen,
  initial,
  isSaving,
  onClose,
  onSubmit,
}: PeripheralFormProps) {
  const { t } = useTranslation('peripherals');
  const isEditing = initial !== null;

  // Default to (printer, system) for new entries — these are the
  // only fully-supported pair in .
  const [kind, setKind] = useState<PeripheralKind>(initial?.kind ?? 'printer');
  const [driver, setDriver] = useState<string>(initial?.driver ?? 'system');
  const [displayName, setDisplayName] = useState<string>(initial?.displayName ?? '');
  const [configRaw, setConfigRaw] = useState<string>(
    initial ? formatConfigForInput(initial.config) : '{}'
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const driverOptions = useMemo(() => DRIVER_OPTIONS[kind] ?? [], [kind]);

  // derive the `autoPrintOnComplete` printer flag from the
  // JSON textarea so the toggle + the raw editor stay in sync without
  // a second state mirror. Returns `null` when the JSON does not parse
  // (so the toggle reflects "unknown" via its derived defaultChecked).
  const parsedConfig = useMemo<Record<string, unknown> | null>(() => {
    try {
      const trimmed = configRaw.trim();
      if (trimmed === '') return {};
      const value = JSON.parse(trimmed) as unknown;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null;
      }
      return value as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [configRaw]);
  const showAutoPrintToggle = kind === 'printer' && driver === 'escpos';
  const showConfigHelp = driver === 'escpos';
  const showGs1Controls = kind === 'scanner' && driver === 'wedge';
  const gs1Scheme = parsedConfig ? readGs1Scheme(parsedConfig) : null;
  const gs1Prefixes = parsedConfig ? readGs1Prefixes(parsedConfig) : null;
  const autoPrintChecked = showAutoPrintToggle && parsedConfig?.autoPrintOnComplete === true;
  const autoPrintToggleDisabled = isSaving || parsedConfig === null;

  function handleAutoPrintToggle(nextChecked: boolean) {
    if (parsedConfig === null) return;
    const nextConfig: Record<string, unknown> = { ...parsedConfig };
    if (nextChecked) {
      nextConfig.autoPrintOnComplete = true;
    } else {
      delete nextConfig.autoPrintOnComplete;
    }
    setConfigRaw(formatConfigForInput(nextConfig));
  }

  function updateParsedConfig(updates: Record<string, unknown>) {
    if (parsedConfig === null) return;
    setConfigRaw(formatConfigForInput({ ...parsedConfig, ...updates }));
  }

  function handleGs1SchemeChange(nextScheme: Gs1Scheme) {
    setValidationError(null);
    updateParsedConfig({ gs1Scheme: nextScheme });
  }

  function handleGs1PrefixRole(prefix: Gs1InStorePrefix, role: Gs1PrefixRole | 'none') {
    if (!gs1Prefixes) return;
    const weight = gs1Prefixes.weight.filter(value => value !== prefix);
    const price = gs1Prefixes.price.filter(value => value !== prefix);
    if (role === 'weight') weight.push(prefix);
    if (role === 'price') price.push(prefix);
    if (weight.length + price.length === 0) {
      setValidationError(t('fields.gs1.invalid'));
      return;
    }
    setValidationError(null);
    updateParsedConfig({ gs1Prefixes: { weight, price } });
  }

  // When the kind changes, snap to the first available driver so the
  // operator does not silently land on an unsupported pair. We do
  // this in the change handler instead of an effect to avoid a
  // cascading render and to satisfy `react-hooks/set-state-in-effect`.
  function handleKindChange(nextKind: PeripheralKind) {
    setKind(nextKind);
    const opts = DRIVER_OPTIONS[nextKind] ?? [];
    const stillValid = opts.find(option => option.id === driver);
    if (!stillValid) {
      const firstAvailable = opts.find(option => option.available);
      const nextDriver = firstAvailable?.id ?? opts[0]?.id ?? '';
      setDriver(nextDriver);
      if (!isEditing) {
        setConfigRaw(formatConfigForInput(defaultConfigFor(nextKind, nextDriver)));
      }
    }
  }

  function handleDriverChange(nextDriver: string) {
    setDriver(nextDriver);
    if (!isEditing) {
      setConfigRaw(formatConfigForInput(defaultConfigFor(kind, nextDriver)));
    }
  }

  function handleSubmit() {
    let parsedConfig: Record<string, unknown>;
    try {
      const trimmed = configRaw.trim();
      parsedConfig = trimmed === '' ? {} : (JSON.parse(trimmed) as Record<string, unknown>);
      if (
        typeof parsedConfig !== 'object' ||
        parsedConfig === null ||
        Array.isArray(parsedConfig)
      ) {
        throw new Error('Config must be a JSON object');
      }
    } catch {
      // JSON.parse SyntaxErrors are technical English strings — never
      // surface them to the operator; the i18n message covers every shape.
      setValidationError(t('fields.configInvalidJson'));
      return;
    }
    if (
      kind === 'scanner' &&
      driver === 'wedge' &&
      (readGs1Scheme(parsedConfig) === null || readGs1Prefixes(parsedConfig) === null)
    ) {
      setValidationError(t('fields.gs1.invalid'));
      return;
    }
    setValidationError(null);
    const submission = onSubmit({
      kind,
      driver,
      displayName: displayName.trim() === '' ? null : displayName.trim(),
      config: parsedConfig,
    });
    if (submission) {
      void submission.catch(() => {
        // PeripheralsPage owns the mutation's localized toast. Consuming the
        // already-handled rejection here prevents a duplicate global
        // unhandledrejection without hiding synchronous programming errors.
      });
    }
  }

  const selectedDriverHint = driverOptions.find(option => option.id === driver);
  const showDriverHint = selectedDriverHint && !selectedDriverHint.available;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? t('actions.edit') : t('addButton')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('actions.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {t('actions.save')}
          </ModalButton>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div>
          <label htmlFor="peripheral-kind" className="label">
            {t('fields.kindLabel')}
          </label>
          <select
            id="peripheral-kind"
            className="input mt-1"
            value={kind}
            disabled={isEditing || isSaving}
            onChange={event => handleKindChange(event.target.value as PeripheralKind)}
          >
            {KIND_ORDER.map(option => (
              <option key={option} value={option}>
                {t(`kind.${option}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="peripheral-driver" className="label">
            {t('fields.driverLabel')}
          </label>
          <select
            id="peripheral-driver"
            className="input mt-1"
            value={driver}
            disabled={isSaving}
            onChange={event => handleDriverChange(event.target.value)}
          >
            {driverOptions.map(option => (
              <option key={option.id} value={option.id}>
                {t(`driver.${option.id}`)}
                {!option.available
                  ? ` — ${t(`driverHint.${option.id}`, { defaultValue: '' })}`
                  : ''}
              </option>
            ))}
          </select>
          {showDriverHint && (
            <p className="mt-1 text-xs text-warning-700">
              {t(`driverHint.${driver}`, { defaultValue: '' })}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="peripheral-display-name" className="label">
            {t('fields.displayNameLabel')}
          </label>
          <input
            id="peripheral-display-name"
            type="text"
            className="input mt-1"
            placeholder={t('fields.displayNamePlaceholder')}
            value={displayName}
            disabled={isSaving}
            maxLength={120}
            onChange={event => setDisplayName(event.target.value)}
          />
        </div>

        {showAutoPrintToggle && (
          <div className="rounded border border-line bg-secondary-50 p-3">
            <label htmlFor="peripheral-auto-print" className="flex items-start gap-2 text-sm">
              <input
                id="peripheral-auto-print"
                type="checkbox"
                className="mt-0.5"
                checked={autoPrintChecked}
                disabled={autoPrintToggleDisabled}
                onChange={event => handleAutoPrintToggle(event.target.checked)}
                data-testid="peripheral-auto-print-toggle"
              />
              <span className="flex flex-col">
                <span className="font-medium">{t('fields.autoPrintOnComplete.label')}</span>
                <span className="text-xs text-secondary-600">
                  {t('fields.autoPrintOnComplete.help')}
                </span>
              </span>
            </label>
          </div>
        )}

        {showGs1Controls && (
          <fieldset className="rounded border border-line bg-secondary-50 p-3">
            <legend className="px-1 text-sm font-medium text-secondary-900">
              {t('fields.gs1.title')}
            </legend>
            <p className="mb-3 text-xs text-secondary-600">{t('fields.gs1.help')}</p>

            <label htmlFor="peripheral-gs1-scheme" className="label">
              {t('fields.gs1.scheme')}
            </label>
            <select
              id="peripheral-gs1-scheme"
              className="input mt-1"
              value={gs1Scheme ?? ''}
              disabled={isSaving || parsedConfig === null || gs1Scheme === null}
              onChange={event => handleGs1SchemeChange(event.target.value as Gs1Scheme)}
            >
              {GS1_SCHEMES.map(scheme => (
                <option key={scheme} value={scheme}>
                  {t(`fields.gs1.schemes.${scheme}`)}
                </option>
              ))}
            </select>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {GS1_IN_STORE_PREFIXES.map(prefix => (
                <label
                  key={prefix}
                  htmlFor={`peripheral-gs1-prefix-${prefix}`}
                  className="flex items-center justify-between gap-3 rounded border border-line bg-white px-3 py-2 text-sm"
                >
                  <span>{t('fields.gs1.prefix', { prefix })}</span>
                  <select
                    id={`peripheral-gs1-prefix-${prefix}`}
                    className="input min-w-28 py-1"
                    value={gs1Prefixes ? roleForPrefix(prefix, gs1Prefixes) : ''}
                    disabled={
                      isSaving ||
                      parsedConfig === null ||
                      gs1Prefixes === null ||
                      gs1Scheme === 'none'
                    }
                    data-testid={`peripheral-gs1-prefix-${prefix}`}
                    onChange={event =>
                      handleGs1PrefixRole(prefix, event.target.value as Gs1PrefixRole | 'none')
                    }
                  >
                    {(['none', 'weight', 'price'] as const).map(role => (
                      <option key={role} value={role}>
                        {t(`fields.gs1.roles.${role}`)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {parsedConfig !== null && (gs1Scheme === null || gs1Prefixes === null) && (
              <p className="mt-2 text-sm text-danger-600">{t('fields.gs1.invalid')}</p>
            )}
          </fieldset>
        )}

        <div>
          <label htmlFor="peripheral-config" className="label">
            {t('fields.configLabel')}
          </label>
          <textarea
            id="peripheral-config"
            className="input mt-1 font-mono text-xs"
            rows={5}
            placeholder={t('fields.configPlaceholder')}
            value={configRaw}
            disabled={isSaving}
            onChange={event => setConfigRaw(event.target.value)}
          />
          {showConfigHelp && (
            <p className="mt-1 text-xs text-secondary-500">{t('fields.configHelp')}</p>
          )}
          {validationError && <p className="mt-1 text-sm text-danger-600">{validationError}</p>}
        </div>
      </form>
    </Modal>
  );
}
