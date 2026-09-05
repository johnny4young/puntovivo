import { useMemo, useState } from 'react';
import { KeyRound, RotateCcw, ShieldCheck, ShieldX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback/EmptyState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { TablePagination } from '@/components/tables/TablePagination';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCalendarDay, formatDateTime } from '@/lib/utils';

interface PharmacyAuthorizationPanelProps {
  isAdmin: boolean;
  countryCode: string;
  businessDate: string;
}

function nextYear(calendarDate: string): string {
  const [year, month, day] = calendarDate.split('-').map(Number);
  const nextYearValue = (year ?? 0) + 1;
  const maxDay = new Date(Date.UTC(nextYearValue, month ?? 1, 0)).getUTCDate();
  return [
    String(nextYearValue).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(Math.min(day ?? 1, maxDay)).padStart(2, '0'),
  ].join('-');
}

interface AuthorizationUserOption {
  id: string;
  name: string;
  role: string;
}

const AUTHORIZATIONS_PER_PAGE = 25;

function authorizationDisplayStatus(
  authorization: {
    status: string;
    userIsActive: boolean | null;
    validFrom: string;
    validUntil: string | null;
  },
  businessDate: string
): 'active' | 'employeeInactive' | 'notYetEffective' | 'expired' | 'revoked' {
  if (authorization.status !== 'active') return 'revoked';
  if (!authorization.userIsActive) return 'employeeInactive';
  if (authorization.validFrom > businessDate) return 'notYetEffective';
  if (authorization.validUntil && authorization.validUntil < businessDate) return 'expired';
  return 'active';
}

export function PharmacyAuthorizationPanel({
  isAdmin,
  countryCode,
  businessDate,
}: PharmacyAuthorizationPanelProps) {
  // Professional credentials are sensitive and bound to one authorization
  // subject. A live role, country, or business-date change must remount the
  // form synchronously rather than briefly preserving a secret from the old
  // policy context.
  const workflowScopeKey = JSON.stringify([isAdmin, countryCode, businessDate]);
  return (
    <StatefulPharmacyAuthorizationPanel
      key={workflowScopeKey}
      isAdmin={isAdmin}
      countryCode={countryCode}
      businessDate={businessDate}
    />
  );
}

function StatefulPharmacyAuthorizationPanel({
  isAdmin,
  countryCode,
  businessDate,
}: PharmacyAuthorizationPanelProps) {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const { sites, currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [userId, setUserId] = useState('');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedUserOption, setSelectedUserOption] = useState<AuthorizationUserOption | null>(
    null
  );
  const [siteId, setSiteId] = useState(currentSite?.id ?? '');
  const [credentialType, setCredentialType] = useState('pharmacist-license');
  const [credential, setCredential] = useState('');
  const [validFrom, setValidFrom] = useState(businessDate);
  const [validUntil, setValidUntil] = useState(nextYear(businessDate));
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [page, setPage] = useState(1);

  const debouncedEmployeeSearch = useDebouncedValue(employeeSearch.trim(), 200);
  const authorizationsQuery = trpc.pharmacy.listAuthorizations.useQuery({
    page,
    perPage: AUTHORIZATIONS_PER_PAGE,
    activeOnly: false,
  });
  const usersQuery = trpc.users.list.useQuery(
    {
      page: 1,
      perPage: 50,
      isActive: true,
      search: debouncedEmployeeSearch || undefined,
    },
    { enabled: isAdmin }
  );
  const userOptions = useMemo(() => {
    const matches = (usersQuery.data?.items ?? []) as AuthorizationUserOption[];
    if (
      selectedUserOption &&
      selectedUserOption.id === userId &&
      !matches.some(user => user.id === selectedUserOption.id)
    ) {
      return [selectedUserOption, ...matches];
    }
    return matches;
  }, [selectedUserOption, userId, usersQuery.data?.items]);

  const create = useCriticalMutation('pharmacy.createAuthorization', {
    onSuccess: async () => {
      setPage(1);
      await Promise.all([
        utils.pharmacy.listAuthorizations.invalidate(),
        utils.pharmacy.context.invalidate(),
      ]);
      setCredential('');
      toast.success({ title: t('pharmacy:authorizations.toast.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:authorizations.toast.error' }),
  });
  const revoke = useCriticalMutation('pharmacy.revokeAuthorization', {
    onSuccess: async () => {
      await Promise.all([
        utils.pharmacy.listAuthorizations.invalidate(),
        utils.pharmacy.context.invalidate(),
        utils.pharmacy.listEvidence.invalidate(),
        utils.pharmacy.checkoutRequirements.invalidate(),
      ]);
      setRevokeTargetId(null);
      setRevokeReason('');
      toast.success({ title: t('pharmacy:authorizations.toast.revoked') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:authorizations.toast.error' }),
  });

  const credentialValid = credential.trim().length >= 3;
  const datesValid = validFrom.length > 0 && (!validUntil || validUntil >= validFrom);
  const canCreate =
    isAdmin && !!userId && credentialType.trim().length >= 2 && credentialValid && datesValid;
  const authorizations = authorizationsQuery.data?.items ?? [];
  const authorizationTotal = authorizationsQuery.data?.total ?? authorizations.length;
  const pageCount = Math.ceil(authorizationTotal / AUTHORIZATIONS_PER_PAGE);
  const displayPage = authorizationsQuery.data?.page ?? page;
  const revokeTarget = isAdmin
    ? (authorizations.find(item => item.id === revokeTargetId) ?? null)
    : null;

  function submitAuthorization() {
    if (!canCreate) return;
    create.mutate({
      userId,
      siteId: siteId || null,
      countryCode,
      credentialType: credentialType.trim(),
      credential: credential.trim(),
      validFrom,
      validUntil: validUntil || null,
    });
  }

  if (authorizationsQuery.error) {
    return (
      <QueryErrorState
        title={t('pharmacy:authorizations.loadError')}
        message={translateServerError(authorizationsQuery.error, t, t('errors:server.unknown'))}
        onRetry={() => void authorizationsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-5">
      {isAdmin ? (
        <section className="card p-5" aria-labelledby="pharmacy-authorization-create-heading">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h3
                id="pharmacy-authorization-create-heading"
                className="font-semibold text-secondary-950"
              >
                {t('pharmacy:authorizations.createTitle')}
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-secondary-600">
                {t('pharmacy:authorizations.createDescription')}
              </p>
            </div>
          </div>

          <form
            autoComplete="off"
            onSubmit={event => {
              event.preventDefault();
              submitAuthorization();
            }}
          >
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-authorization-employee-search">
                  {t('pharmacy:common.searchEmployee')}
                </label>
                <input
                  id="pharmacy-authorization-employee-search"
                  className="pv-input"
                  type="search"
                  value={employeeSearch}
                  placeholder={t('pharmacy:common.searchEmployeePlaceholder')}
                  onChange={event => setEmployeeSearch(event.target.value)}
                />
              </div>

              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-authorization-user">
                  {t('pharmacy:authorizations.employee')}
                </label>
                <select
                  id="pharmacy-authorization-user"
                  name="pharmacy-authorization-user"
                  className="pv-input"
                  value={userId}
                  disabled={usersQuery.isLoading}
                  onChange={event => {
                    const nextUserId = event.target.value;
                    setUserId(nextUserId);
                    setSelectedUserOption(userOptions.find(user => user.id === nextUserId) ?? null);
                    setCredential('');
                  }}
                >
                  <option value="">{t('pharmacy:authorizations.employeePlaceholder')}</option>
                  {userOptions.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name} · {user.role}
                    </option>
                  ))}
                </select>
                {usersQuery.error && (
                  <p className="mt-1 text-xs text-danger-700" role="alert">
                    {translateServerError(
                      usersQuery.error,
                      t,
                      t('pharmacy:authorizations.employeeLoadError')
                    )}
                  </p>
                )}
              </div>

              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-authorization-site">
                  {t('pharmacy:authorizations.site')}
                </label>
                <select
                  id="pharmacy-authorization-site"
                  className="pv-input"
                  value={siteId}
                  onChange={event => {
                    setSiteId(event.target.value);
                    setCredential('');
                  }}
                >
                  <option value="">{t('pharmacy:authorizations.allSites')}</option>
                  {sites.map(site => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-authorization-country">
                  {t('pharmacy:authorizations.country')}
                </label>
                <input
                  id="pharmacy-authorization-country"
                  className="pv-input"
                  value={countryCode}
                  readOnly
                />
                <p className="mt-1 text-xs text-secondary-500">
                  {t('pharmacy:authorizations.countryHelp')}
                </p>
              </div>

              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-authorization-type">
                  {t('pharmacy:authorizations.credentialType')}
                </label>
                <input
                  id="pharmacy-authorization-type"
                  className="pv-input"
                  value={credentialType}
                  maxLength={80}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={event => {
                    setCredentialType(event.target.value);
                    setCredential('');
                  }}
                />
              </div>

              <div className="pv-field md:col-span-2">
                <label className="label" htmlFor="pharmacy-authorization-credential">
                  {t('pharmacy:authorizations.credential')}
                </label>
                <input
                  id="pharmacy-authorization-credential"
                  name="pharmacy-authorization-credential"
                  className="pv-input"
                  type="password"
                  value={credential}
                  maxLength={160}
                  autoComplete="new-password"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={event => setCredential(event.target.value)}
                />
                <p className="mt-1 text-xs text-secondary-500">
                  {t('pharmacy:authorizations.credentialHelp')}
                </p>
              </div>

              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-authorization-from">
                  {t('pharmacy:authorizations.validFrom')}
                </label>
                <input
                  id="pharmacy-authorization-from"
                  className="pv-input"
                  type="date"
                  value={validFrom}
                  onChange={event => setValidFrom(event.target.value)}
                />
              </div>
              <div className="pv-field">
                <label className="label" htmlFor="pharmacy-authorization-until">
                  {t('pharmacy:authorizations.validUntil')}
                </label>
                <input
                  id="pharmacy-authorization-until"
                  className="pv-input"
                  type="date"
                  min={validFrom}
                  value={validUntil}
                  onChange={event => setValidUntil(event.target.value)}
                />
              </div>
            </div>
            {!datesValid && (
              <p className="mt-3 text-sm text-danger-700" role="alert">
                {t('pharmacy:authorizations.invalidDates')}
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <Button type="submit" disabled={!canCreate || create.isPending}>
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                {t('pharmacy:authorizations.createAction')}
              </Button>
            </div>
          </form>
        </section>
      ) : (
        <div className="rounded-2xl border border-secondary-200 bg-secondary-50 p-4 text-sm text-secondary-700">
          {t('pharmacy:authorizations.adminOnly')}
        </div>
      )}

      <section className="card p-5" aria-labelledby="pharmacy-authorizations-list-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3
              id="pharmacy-authorizations-list-heading"
              className="font-semibold text-secondary-950"
            >
              {t('pharmacy:authorizations.listTitle')}
            </h3>
            <p className="mt-1 text-sm text-secondary-600">
              {t('pharmacy:authorizations.listDescription')}
            </p>
          </div>
          <Button
            variant="outline"
            size="compact"
            onClick={() => void authorizationsQuery.refetch()}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:common.refresh')}
          </Button>
        </div>

        {authorizationsQuery.isLoading && (
          <p className="mt-5 text-sm text-secondary-600" role="status">
            {t('pharmacy:common.loading')}
          </p>
        )}
        {!authorizationsQuery.isLoading && authorizations.length === 0 && (
          <EmptyState
            className="mt-5"
            icon={ShieldCheck}
            title={t('pharmacy:authorizations.emptyTitle')}
            description={t('pharmacy:authorizations.emptyDescription')}
          />
        )}
        {authorizations.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase text-secondary-500">
                <tr>
                  <th className="px-3 py-2">{t('pharmacy:authorizations.columns.employee')}</th>
                  <th className="px-3 py-2">{t('pharmacy:authorizations.columns.scope')}</th>
                  <th className="px-3 py-2">{t('pharmacy:authorizations.columns.validity')}</th>
                  <th className="px-3 py-2">{t('pharmacy:authorizations.columns.status')}</th>
                  <th className="px-3 py-2 text-right">
                    {t('pharmacy:authorizations.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {authorizations.map(item => {
                  const displayStatus = authorizationDisplayStatus(item, businessDate);
                  return (
                    <tr key={item.id}>
                      <td className="px-3 py-3">
                        <p className="font-medium text-secondary-900">{item.userName}</p>
                        <p className="mt-0.5 text-xs text-secondary-500">{item.credentialType}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p>{item.siteName ?? t('pharmacy:authorizations.allSites')}</p>
                        <p className="text-xs text-secondary-500">{item.countryCode}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p>{formatCalendarDay(item.validFrom)}</p>
                        <p className="text-xs text-secondary-500">
                          {item.validUntil
                            ? t('pharmacy:authorizations.until', {
                                date: formatCalendarDay(item.validUntil),
                              })
                            : t('pharmacy:authorizations.noExpiry')}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge
                          variant={
                            displayStatus === 'revoked'
                              ? 'danger'
                              : displayStatus === 'active'
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {t(`pharmacy:common.authorizationStatus.${displayStatus}`)}
                        </Badge>
                        <p className="mt-1 text-[11px] text-secondary-500">
                          {formatDateTime(item.createdAt)}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        {isAdmin && item.status === 'active' && (
                          <Button
                            variant="outline"
                            size="compact"
                            disabled={revoke.isPending}
                            onClick={() => {
                              setRevokeTargetId(item.id);
                              setRevokeReason('');
                            }}
                          >
                            <ShieldX className="h-4 w-4" aria-hidden="true" />
                            {t('pharmacy:authorizations.revoke')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3">
          <TablePagination
            page={displayPage - 1}
            pageCount={pageCount}
            total={authorizationTotal}
            rangeStart={(displayPage - 1) * AUTHORIZATIONS_PER_PAGE + 1}
            rangeEnd={Math.min(displayPage * AUTHORIZATIONS_PER_PAGE, authorizationTotal)}
            onPageChange={nextPage => setPage(nextPage + 1)}
          />
        </div>

        {revokeTarget && (
          <div className="mt-5 rounded-2xl border border-danger-200 bg-danger-50 p-4">
            <h4 className="font-medium text-danger-950">
              {t('pharmacy:authorizations.revokeTitle', { employee: revokeTarget.userName })}
            </h4>
            <label className="label mt-3" htmlFor="pharmacy-authorization-revoke-reason">
              {t('pharmacy:common.reason')}
            </label>
            <textarea
              id="pharmacy-authorization-revoke-reason"
              className="pv-input mt-1 min-h-20"
              value={revokeReason}
              maxLength={500}
              onChange={event => setRevokeReason(event.target.value)}
            />
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setRevokeTargetId(null);
                  setRevokeReason('');
                }}
              >
                {t('pharmacy:common.cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={revokeReason.trim().length < 3 || revoke.isPending}
                onClick={() => revoke.mutate({ id: revokeTarget.id, reason: revokeReason.trim() })}
              >
                {t('pharmacy:authorizations.confirmRevoke')}
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
