import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { generateConnectorSecret } from './connectorSecret';
import { externalButtonClass, externalInputClass, type ExternalConnector } from './types';

/** Secret stays in this form only and is never retrieved from the server. Rotation is an explicit CAS command. */
export function ConnectorForm({
  siteId,
  connector,
  onCancel,
  onSaved,
}: {
  siteId: string;
  connector?: ExternalConnector | undefined;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['externalOrders', 'common', 'errors', 'fulfillmentErrors']);
  const [secret, setSecret] = useState(''),
    [name, setName] = useState(''),
    [copied, setCopied] = useState(false),
    [show, setShow] = useState(false),
    [error, setError] = useState<string | null>(null);
  const create = useCriticalMutation('externalOrders.createConnector', { gcTime: 0 }),
    update = useCriticalMutation('externalOrders.updateConnector', { gcTime: 0 });
  const busy = useRef(false),
    pending = create.isPending || update.isPending;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!secret || !copied || busy.current || (!connector && !name.trim())) return;
    busy.current = true;
    setError(null);
    try {
      if (connector)
        await update.mutateAsync({
          siteId,
          id: connector.id,
          expectedVersion: connector.version,
          enabled: connector.enabled,
          secret,
        });
      else await create.mutateAsync({ siteId, name: name.trim(), adapter: 'sandbox_v1', secret });
      setSecret('');
      onSaved();
    } catch (failure) {
      setError(translateServerError(failure, t, t('errors:server.unknown')));
    } finally {
      busy.current = false;
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-4"
      aria-label={t(connector ? 'connectors.rotate' : 'connectors.create')}
    >
      <p className="text-sm text-secondary-700">{t('connectors.sandboxOnly')}</p>
      {connector ? (
        <p>{t('connectors.rotating', { name: connector.name })}</p>
      ) : (
        <label className="block">
          {t('connectors.name')}
          <input
            className={externalInputClass}
            value={name}
            onChange={event => setName(event.target.value)}
            maxLength={100}
            required
            disabled={pending}
          />
        </label>
      )}
      <button
        type="button"
        className={externalButtonClass}
        disabled={pending}
        onClick={() => {
          try {
            setSecret(generateConnectorSecret());
            setCopied(false);
            setShow(false);
          } catch {
            setError(t('connectors.randomUnavailable'));
          }
        }}
      >
        {t('connectors.generate')}
      </button>
      {secret && (
        <div className="space-y-3">
          <label className="block">
            {t('connectors.secret')}
            <input
              className={`${externalInputClass} font-mono`}
              readOnly
              type={show ? 'text' : 'password'}
              value={secret}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            type="button"
            className={externalButtonClass}
            onClick={() => setShow(value => !value)}
          >
            {t(show ? 'connectors.hide' : 'connectors.show')}
          </button>
          <p className="text-sm text-secondary-700">{t('connectors.saveOnce')}</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={copied}
              disabled={pending}
              onChange={event => setCopied(event.target.checked)}
            />
            <span>{t('connectors.savedConfirmation')}</span>
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger-700">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button type="button" className={externalButtonClass} disabled={pending} onClick={onCancel}>
          {t('common:actions.cancel')}
        </button>
        <button
          type="submit"
          className="rounded bg-primary-700 px-3 py-2 text-white disabled:opacity-50"
          disabled={!secret || !copied || pending || (!connector && !name.trim())}
        >
          {t(connector ? 'connectors.rotate' : 'connectors.create')}
        </button>
      </div>
    </form>
  );
}
