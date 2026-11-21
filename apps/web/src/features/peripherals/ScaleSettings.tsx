import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuthOwnerKey } from '@/features/auth/AuthContext';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { DEFAULT_SCALE_CONFIG, scaleStatusKey } from '@/features/peripherals/scale';
import { kilogramFormat } from '@/features/sales/weighedItem';
import type {
  ScaleBaudRate,
  ScaleConfig,
  ScaleFraming,
  ScaleProtocol,
  ScaleReadResult,
} from '@/types/electron';

const PROTOCOLS: ScaleProtocol[] = ['continuous', 'toledo', 'enq'];
const BAUD_RATES: ScaleBaudRate[] = [2400, 4800, 9600, 19200];
const FRAMINGS: ScaleFraming[] = ['8N1', '7E1'];

function sameConfig(draft: ScaleConfig, saved: ScaleConfig | null) {
  if (!saved) return draft.path === '';
  return (
    draft.path === saved.path &&
    draft.protocol === saved.protocol &&
    draft.baudRate === saved.baudRate &&
    draft.framing === saved.framing
  );
}

/** Serial scale on this computer: port, protocol and a test read; never synchronized. */
export function ScaleSettings() {
  const owner = useAuthOwnerKey();
  return <ScaleSettingsForOwner key={owner} owner={owner} />;
}

function ScaleSettingsForOwner({ owner }: { owner: string | null }) {
  const { t } = useTranslation('scale');
  const { locale } = useResolvedLocale();
  const queryClient = useQueryClient();
  const electron = window.electron;
  const queryKey = ['desktop', 'scale-settings', owner];
  const [draft, setScaleConfig] = useState<ScaleConfig | null>(null);
  const [result, setResult] = useState<ScaleReadResult | null>(null);
  const [saved, setSaved] = useState(false);

  const query = useQuery({
    queryKey,
    queryFn: () => electron!.getScaleSettings!(),
    enabled: Boolean(electron?.getScaleSettings),
    retry: false,
  });
  const save = useMutation({
    mutationFn: async (config: ScaleConfig | null) => {
      const result = await electron!.saveScaleSettings!(config);
      if (result.status === 'error') throw new Error(result.code);
      return result.settings;
    },
    onSuccess: state => {
      queryClient.setQueryData(queryKey, state);
      void queryClient.invalidateQueries({ queryKey: scaleStatusKey(owner) });
      setScaleConfig(null);
      setSaved(true);
    },
    onError: () => void query.refetch(),
  });
  const test = useMutation({
    mutationFn: (config: ScaleConfig) => electron!.testScale!(config),
    onSuccess: setResult,
  });

  if (!electron?.getScaleSettings || !electron.saveScaleSettings || !electron.testScale)
    return null;
  const state = query.data;
  const form: ScaleConfig = draft ?? {
    ...DEFAULT_SCALE_CONFIG,
    ...state?.config,
    path: state?.config?.path ?? '',
  };
  const missing = form.path !== '' && !state?.ports.some(port => port.path === form.path);
  const busy = query.isFetching || save.isPending || test.isPending;
  const config: ScaleConfig | null = form.path ? form : null;

  const update = (patch: Partial<ScaleConfig>) => {
    setScaleConfig({ ...form, ...patch });
    setResult(null);
    setSaved(false);
    save.reset();
    test.reset();
  };

  return (
    <fieldset
      className="mt-4 space-y-3 rounded-xl border border-line p-4"
      data-testid="scale-settings"
    >
      <legend className="text-sm font-semibold">{t('settings.title')}</legend>
      {state && !state.available ? (
        <p role="status" className="text-sm text-fg3">
          {t('settings.unavailable')}
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScaleSelect
              label={t('settings.port')}
              testId="scale-settings-port"
              value={form.path}
              disabled={!state || busy}
              onChange={path => update({ path })}
            >
              <option value="">{t('settings.none')}</option>
              {missing && (
                <option value={form.path}>{t('settings.disconnected', { path: form.path })}</option>
              )}
              {state?.ports.map(port => (
                <option key={port.path} value={port.path}>
                  {port.label}
                </option>
              ))}
            </ScaleSelect>
            <ScaleSelect
              label={t('settings.protocol')}
              testId="scale-settings-protocol"
              value={form.protocol}
              disabled={!config || busy}
              // Toledo 8217 scales talk 7E1; the others default to 8N1.
              onChange={value => {
                const protocol = value as ScaleProtocol;
                update({ protocol, framing: protocol === 'toledo' ? '7E1' : '8N1' });
              }}
            >
              {PROTOCOLS.map(protocol => (
                <option key={protocol} value={protocol}>
                  {t(`settings.protocols.${protocol}`)}
                </option>
              ))}
            </ScaleSelect>
            <ScaleSelect
              label={t('settings.baudRate')}
              testId="scale-settings-baud"
              value={form.baudRate}
              disabled={!config || busy}
              onChange={value => update({ baudRate: Number(value) as ScaleBaudRate })}
            >
              {BAUD_RATES.map(rate => (
                <option key={rate}>{rate}</option>
              ))}
            </ScaleSelect>
            <ScaleSelect
              label={t('settings.framing')}
              testId="scale-settings-framing"
              value={form.framing}
              disabled={!config || busy}
              onChange={value => update({ framing: value as ScaleFraming })}
            >
              {FRAMINGS.map(framing => (
                <option key={framing}>{framing}</option>
              ))}
            </ScaleSelect>
          </div>
          {state?.ports.length === 0 && (
            <p role="status" className="text-sm text-warning-700">
              {t('settings.noPorts')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-outline"
              disabled={busy}
              onClick={() => {
                setResult(null);
                void query.refetch();
              }}
              data-testid="scale-settings-refresh"
            >
              {t('settings.refresh')}
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={!config || missing || busy}
              onClick={() => {
                setResult(null);
                if (config) test.mutate(config);
              }}
              data-testid="scale-settings-test"
            >
              {t('settings.test')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!state || missing || busy || sameConfig(form, state.config)}
              onClick={() => save.mutate(config)}
              data-testid="scale-settings-save"
            >
              {t('settings.save')}
            </button>
          </div>
        </>
      )}
      {result && (
        <p
          role="status"
          className={`text-sm ${result.status === 'ok' ? 'text-success-700' : 'text-danger-700'}`}
          data-testid="scale-settings-result"
        >
          {result.status === 'ok'
            ? t('settings.weight', {
                weight: kilogramFormat(locale).format(result.kilograms),
              })
            : t(`errors.${result.code}`)}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success-700">
          {t('settings.saved')}
        </p>
      )}
      {test.error && (
        <p role="alert" className="text-sm text-danger-700">
          {t('errors.failed')}
        </p>
      )}
      {(query.error || save.error) && (
        <p role="alert" className="text-sm text-danger-700">
          {t('settings.saveFailed')}
        </p>
      )}
    </fieldset>
  );
}

function ScaleSelect(props: {
  label: string;
  testId: string;
  value: string | number;
  disabled: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label">{props.label}</span>
      <select
        className="input"
        value={props.value}
        disabled={props.disabled}
        onChange={event => props.onChange(event.target.value)}
        data-testid={props.testId}
      >
        {props.children}
      </select>
    </label>
  );
}
