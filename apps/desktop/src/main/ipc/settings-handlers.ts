/**
 * electron-free settings update handlers so the session
 * gates — and the DELIBERATE update-main-locale exemption — stay
 * pinned by node tests (same pattern as print-handler.ts). The
 * persistence closures and the locale side effects are injected by
 * `./settings.ts`.
 *
 * @module main/ipc/settings-handlers
 */

export interface SettingsSessionGate {
  /** Throws when no verified desktop session is registered. */
  requireTenantId: () => string;
}

/**
 * The three db-persisting update channels gate on the registered
 * session (renderer-as-attacker posture, same as the db and sync
 * handlers): a pre-auth or compromised renderer must not write
 * app_settings rows. The rejection propagates across IPC like the
 * db handlers do.
 */
export async function handleGatedSettingsUpdate<T>(
  session: SettingsSessionGate,
  persist: () => Promise<T>
): Promise<T> {
  session.requireTenantId();
  return persist();
}

export interface LocaleUpdateDeps<L> {
  normalize: (locale: string | null) => L;
  apply: (locale: L) => void;
}

/**
 * update-main-locale is DELIBERATELY not session-gated: the
 * renderer's i18n bootstrap invokes it before login so the window
 * title, tray, and update dialogs speak the login screen's language.
 * It persists nothing and the value is normalized to the supported
 * locales — keep it that way; gating it would break pre-login i18n.
 */
export function handleLocaleUpdate<L>(deps: LocaleUpdateDeps<L>, locale: unknown): L {
  const next = deps.normalize(typeof locale === 'string' ? locale : null);
  deps.apply(next);
  return next;
}
