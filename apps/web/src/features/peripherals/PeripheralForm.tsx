import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';

/**
 * ENG-060 — Peripheral register/update modal.
 *
 * The form is intentionally minimal: kind picker, driver picker
 * filtered by kind, optional display name, and a raw JSON textarea
 * for `config`. ENG-061/062/063 will swap the JSON textarea for
 * typed per-driver forms once their adapters land.
 *
 * The kind field is locked when editing an existing peripheral
 * because the router's `update` procedure does not accept a kind
 * change — switching kinds requires removing + re-registering, which
 * matches the partial-unique constraint semantics.
 */

type PeripheralKind =
  | 'printer'
  | 'cash_drawer'
  | 'scanner'
  | 'payment_terminal'
  | 'customer_display';

const KIND_ORDER: PeripheralKind[] = [
  'printer',
  'cash_drawer',
  'scanner',
  'payment_terminal',
  'customer_display',
];

// Map of (kind → drivers shown in the picker). The flag `available`
// reflects whether ENG-060 ships the adapter; non-available rows
// surface a driverHint copy explaining which ENG-NNN unlocks them.
const DRIVER_OPTIONS: Record<
  PeripheralKind,
  Array<{ id: string; available: boolean }>
> = {
  printer: [
    { id: 'system', available: true },
    // ENG-062 — ESC/POS thermal printer driver shipped.
    { id: 'escpos', available: true },
  ],
  cash_drawer: [
    // ENG-062 — RJ11 cash drawer via the ESC/POS printer stream.
    { id: 'escpos', available: true },
  ],
  scanner: [
    // ENG-061 — USB HID keyboard-wedge driver shipped.
    { id: 'wedge', available: true },
  ],
  payment_terminal: [
    { id: 'manual', available: true },
    { id: 'bold', available: false },
    { id: 'wompi', available: false },
    { id: 'mercadopago', available: false },
  ],
  customer_display: [
    { id: 'escpos', available: false },
  ],
};

function defaultConfigFor(kind: PeripheralKind, driver: string): Record<string, unknown> {
  if ((kind === 'printer' || kind === 'cash_drawer') && driver === 'escpos') {
    return {
      channel: 'tcp',
      host: '192.168.1.50',
      port: 9100,
    };
  }
  return {};
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
  // only fully-supported pair in ENG-060.
  const [kind, setKind] = useState<PeripheralKind>(initial?.kind ?? 'printer');
  const [driver, setDriver] = useState<string>(initial?.driver ?? 'system');
  const [displayName, setDisplayName] = useState<string>(initial?.displayName ?? '');
  const [configRaw, setConfigRaw] = useState<string>(
    initial ? formatConfigForInput(initial.config) : '{}'
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const driverOptions = useMemo(() => DRIVER_OPTIONS[kind] ?? [], [kind]);

  // ENG-097 — derive the `autoPrintOnComplete` printer flag from the
  // JSON textarea so the toggle + the raw editor stay in sync without
  // a second state mirror. Returns `null` when the JSON does not parse
  // (so the toggle reflects "unknown" via its derived defaultChecked).
  const parsedConfig = useMemo<Record<string, unknown> | null>(() => {
    try {
      const trimmed = configRaw.trim();
      if (trimmed === '') return {};
      const value = JSON.parse(trimmed) as unknown;
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value)
      ) {
        return null;
      }
      return value as Record<string, unknown>;
    } catch {
      return null;
    }
  }, [configRaw]);
  const showAutoPrintToggle = kind === 'printer' && driver === 'escpos';
  const autoPrintChecked =
    showAutoPrintToggle && parsedConfig?.autoPrintOnComplete === true;
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
      if (typeof parsedConfig !== 'object' || parsedConfig === null || Array.isArray(parsedConfig)) {
        throw new Error('Config must be a JSON object');
      }
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : 'Invalid JSON in configuration'
      );
      return;
    }
    setValidationError(null);
    void onSubmit({
      kind,
      driver,
      displayName: displayName.trim() === '' ? null : displayName.trim(),
      config: parsedConfig,
    });
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
            <label
              htmlFor="peripheral-auto-print"
              className="flex items-start gap-2 text-sm"
            >
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
                <span className="font-medium">
                  {t('fields.autoPrintOnComplete.label')}
                </span>
                <span className="text-xs text-secondary-600">
                  {t('fields.autoPrintOnComplete.help')}
                </span>
              </span>
            </label>
          </div>
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
          <p className="mt-1 text-xs text-secondary-500">
            {t('fields.configHelp')}
          </p>
          {validationError && (
            <p className="mt-1 text-sm text-danger-600">{validationError}</p>
          )}
        </div>
      </form>
    </Modal>
  );
}
