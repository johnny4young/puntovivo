/**
 * Lazy body of the global shortcut surfaces: the shortcut sheet
 * (Alt+/) and the logout confirmation (Alt+Q). Split from the
 * provider so the always-mounted index chunk carries only the keydown
 * listener — the modal bodies load on first use.
 */
import { useTranslation } from 'react-i18next';

import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { SHORTCUTS, formatKeysForDisplay, type ShortcutDefinition } from '@/lib/shortcuts';
import type { UserRole } from '@/types';

const SHEET_SCOPES = ['global', 'sales', 'modal'] as const;

function ShortcutRow({ shortcut }: { shortcut: ShortcutDefinition }) {
  const { t } = useTranslation('shortcuts');
  return (
    <li className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-secondary-700">{t(`${shortcut.labelKey}.label`)}</span>
      <kbd className="pv-kbd">{formatKeysForDisplay(shortcut.keys)}</kbd>
    </li>
  );
}

export function ShortcutsSheetModal({
  role,
  onClose,
}: {
  role: UserRole | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('shortcuts');
  const visibleShortcuts = SHORTCUTS.filter(
    shortcut => !shortcut.roles || (role !== undefined && shortcut.roles.includes(role))
  );

  return (
    <Modal isOpen onClose={onClose} title={t('sheet.title')} size="md">
      <div className="space-y-5" data-testid="shortcuts-sheet">
        <p className="text-sm text-secondary-600">{t('sheet.description')}</p>
        {SHEET_SCOPES.map(scope => {
          const group = visibleShortcuts.filter(shortcut => shortcut.scope === scope);
          if (group.length === 0) return null;
          return (
            <section key={scope}>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg3">
                {t(`sheet.scopes.${scope}`)}
              </h3>
              <ul className="mt-1 divide-y divide-line/60">
                {group.map(shortcut => (
                  <ShortcutRow key={shortcut.id} shortcut={shortcut} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Alt+Q asks before ending the session: logout purges every
 * in-progress cart workspace, so a single stray chord must never be
 * able to destroy a ticket unconfirmed.
 */
export function LogoutConfirmModal({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('shortcuts');
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('logoutConfirm.title')}
      size="sm"
      footer={
        <>
          <ModalButton onClick={onClose}>{t('logoutConfirm.cancel')}</ModalButton>
          <ModalButton variant="primary" onClick={onConfirm} id="logout-confirm-accept">
            {t('logoutConfirm.confirm')}
          </ModalButton>
        </>
      }
    >
      <p className="text-sm text-secondary-700" data-testid="logout-confirm">
        {t('logoutConfirm.message')}
      </p>
    </Modal>
  );
}
