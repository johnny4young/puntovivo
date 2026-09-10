import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import type { EmploymentContract, EmploymentSnapshot } from './employmentTypes';

/** Frozen terms render only within administrator-only history, never the general audit projection. */
function TermsEvidence({ value }: { value: EmploymentSnapshot }) {
  const { t, i18n } = useTranslation('workforce');
  const { terms } = value;
  const money = (amount: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage, {
      style: 'currency',
      currency: terms.currencyCode,
      // Frozen evidence uses the same two-decimal precision accepted by the writer.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  return (
    <dl className="mt-2 grid gap-2 break-words text-sm sm:grid-cols-2">
      <div>
        <dt className="text-secondary-500">{t('position')}</dt>
        <dd>{terms.position}</dd>
      </div>
      <div>
        <dt className="text-secondary-500">{t('siteReference')}</dt>
        <dd>{terms.siteId}</dd>
      </div>
      <div>
        <dt className="text-secondary-500">{t('effectiveFrom')}</dt>
        <dd>{terms.effectiveFrom}</dd>
      </div>
      <div>
        <dt className="text-secondary-500">{t('effectiveUntil')}</dt>
        <dd>{terms.effectiveUntil ?? t('openEnded')}</dd>
      </div>
      <div>
        <dt className="text-secondary-500">{t(`basis.${terms.pay.basis}`)}</dt>
        <dd>{money(terms.pay.amount)}</dd>
      </div>
      {terms.pay.basis === 'monthly' && (
        <div>
          <dt className="text-secondary-500">
            {t('costingRate', { currencyCode: terms.currencyCode })}
          </dt>
          <dd>
            {terms.pay.costingHourlyRate === null
              ? t('unknownCost')
              : money(terms.pay.costingHourlyRate)}
          </dd>
        </div>
      )}
      <div>
        <dt className="text-secondary-500">{t('timezoneLabel')}</dt>
        <dd>{value.timeZone}</dd>
      </div>
      {value.voidedAt && (
        <div>
          <dt>{t('voided')}</dt>
          <dd>{value.voidedAt}</dd>
        </div>
      )}
    </dl>
  );
}

/** Bounded private history follows versions rather than offsets; earlier terms stay immutable. */
export function EmploymentHistory({
  contract,
  onClose,
}: {
  contract: EmploymentContract;
  onClose: () => void;
}) {
  const { t } = useTranslation(['workforce', 'errors']);
  const [pages, setPages] = useState<number[]>([]);
  const boundary = pages.at(-1);
  const query = trpc.workforce.contracts.events.useQuery(
    {
      id: contract.id,
      siteId: contract.siteId,
      limit: 20,
      ...(boundary === undefined ? {} : { beforeVersion: boundary }),
    },
    { gcTime: 0, staleTime: 0 }
  );
  return (
    <Modal
      isOpen
      title={t('historyTitle', { employee: contract.userName })}
      size="lg"
      onClose={onClose}
      footer={<ModalButton onClick={onClose}>{t('close')}</ModalButton>}
    >
      <p className="mb-4 text-sm text-secondary-600">{t('historyNotice')}</p>
      {query.isPending && <p role="status">{t('loading')}</p>}
      {query.error && (
        <div role="alert">
          <p>{translateServerError(query.error, t, t('loadError'))}</p>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </div>
      )}
      {!query.error && (
        <ol className="space-y-4">
          {query.data?.items.map(event => (
            <li key={event.id} className="rounded-xl border border-line p-4">
              <h3 className="font-semibold">
                {t(`kinds.${event.kind}`)} · {t('version', { version: event.version })}
              </h3>
              <p className="mt-1 text-xs text-secondary-500">
                {event.createdAt} · {t('actorReference', { actor: event.actorId })}
              </p>
              <p className="my-2 whitespace-pre-wrap break-words text-sm">{event.reason}</p>
              {event.before && (
                <details className="mb-2">
                  <summary className="cursor-pointer font-medium">{t('before')}</summary>
                  <TermsEvidence value={event.before} />
                </details>
              )}
              <details>
                <summary className="cursor-pointer font-medium">{t('after')}</summary>
                <TermsEvidence value={event.after} />
              </details>
            </li>
          ))}
        </ol>
      )}
      <nav className="mt-4 flex gap-3" aria-label={t('historyPages')}>
        <Button
          variant="outline"
          disabled={!pages.length || query.isFetching}
          onClick={() => setPages(previous => previous.slice(0, -1))}
        >
          {t('newer')}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.nextBeforeVersion || !!query.error || query.isFetching}
          onClick={() => {
            if (query.data?.nextBeforeVersion)
              setPages(previous => [...previous, query.data!.nextBeforeVersion!]);
          }}
        >
          {t('older')}
        </Button>
      </nav>
    </Modal>
  );
}
