import { Check, Minus, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { USER_ROLES } from '@puntovivo/shared/roles';
import { ROLE_PERMISSION_TEMPLATES } from '@/features/auth/workspaceRoleTemplates';

/**
 * ENG-129a — Workspace-level role template shown to administrators.
 *
 * A parity test pins the matrix to the catalogue that renders the sidebar, so
 * it cannot silently disagree with route discovery while both runtime chunks
 * stay independent. Module activation and individual server procedures can
 * narrow access further; the explanatory note makes that distinction explicit
 * instead of promising field-level RBAC.
 */
export function RolePermissionAudit() {
  const { t } = useTranslation(['settings', 'workspaces', 'nav']);

  return (
    <section className="card overflow-hidden" aria-labelledby="role-permission-audit-title">
      <div className="border-b border-secondary-200 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2
              id="role-permission-audit-title"
              className="text-lg font-semibold text-secondary-900"
            >
              {t('settings:users.permissions.title')}
            </h2>
            <p className="mt-1 text-sm text-secondary-600">
              {t('settings:users.permissions.description')}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {USER_ROLES.map(role => (
            <div key={role} className="rounded-xl border border-secondary-200 bg-secondary-50 p-3">
              <dt className="text-sm font-semibold text-secondary-900">
                {t(`settings:users.roles.${role}`)}
              </dt>
              <dd className="mt-1 text-xs leading-5 text-secondary-600">
                {t(`settings:users.permissions.roleDescriptions.${role}`)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <caption className="sr-only">{t('settings:users.permissions.caption')}</caption>
          <thead>
            <tr className="border-b border-secondary-200 bg-secondary-50 text-left text-xs font-semibold uppercase tracking-wide text-secondary-600">
              <th scope="col" className="px-6 py-3">
                {t('settings:users.permissions.workspace')}
              </th>
              {USER_ROLES.map(role => (
                <th key={role} scope="col" className="px-4 py-3 text-center">
                  {t(`settings:users.roles.${role}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_PERMISSION_TEMPLATES.map(row => {
              const workspaceLabel = t(row.labelKey);
              return (
                <tr key={row.id} className="border-b border-secondary-100 last:border-b-0">
                  <th scope="row" className="px-6 py-3 text-left font-medium text-secondary-800">
                    {workspaceLabel}
                  </th>
                  {USER_ROLES.map(role => {
                    const isAllowed = row.allowedRoles.includes(role);
                    const roleLabel = t(`settings:users.roles.${role}`);
                    const accessLabel = t(
                      isAllowed
                        ? 'settings:users.permissions.allowed'
                        : 'settings:users.permissions.denied'
                    );

                    return (
                      <td key={role} className="px-4 py-3 text-center">
                        <span
                          aria-label={t('settings:users.permissions.cellLabel', {
                            role: roleLabel,
                            workspace: workspaceLabel,
                            access: accessLabel,
                          })}
                          className={
                            isAllowed
                              ? 'inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-1 text-xs font-medium text-success-700'
                              : 'inline-flex items-center gap-1 rounded-full bg-secondary-100 px-2 py-1 text-xs font-medium text-secondary-500'
                          }
                        >
                          {isAllowed ? (
                            <Check className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          <span aria-hidden="true">{accessLabel}</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="border-t border-secondary-200 bg-primary-50 px-6 py-3 text-xs leading-5 text-primary-800">
        {t('settings:users.permissions.note')}
      </p>
    </section>
  );
}
