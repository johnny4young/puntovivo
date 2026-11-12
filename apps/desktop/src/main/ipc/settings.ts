/**
 * desktop settings IPC (receipt printing, theme, tray,
 * main-process locale), extracted verbatim from the former monolithic
 * `main/index.ts`.
 *
 * Owns the `app_settings`-backed persistence helpers, reached through the
 * server host, plus the normalisers for each settings shape. The tray itself (native Tray
 * instance, context menu, visibility toggling) stays in `main/index.ts`
 * because it is bound to the main-window lifecycle; this module only
 * persists the tray *settings* and calls back through `deps.refreshTray`
 * so the native tray reflects the saved state.
 *
 * @module main/ipc/settings
 */

import { ipcMain, nativeTheme, type BrowserWindow } from 'electron';
// read authenticated identity from the main-process singleton,
// never from renderer-supplied arguments.
import * as desktopSession from '../session/desktopSession.js';
import { requireServerHost, whenServerReady } from '../runtime.js';
import { t, setMainLocale, normalizeMainLocale, type MainLocale } from '../i18n';
import { refreshAutoUpdateTranslations } from '../auto-updater';
import { handleGatedSettingsUpdate, handleLocaleUpdate } from './settings-handlers.ts';
import { captureDesktopIpcSessionResult } from './session-authorization.ts';

export interface ReceiptPrintSettings {
  silent: boolean;
  printBackground: boolean;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export interface TraySettings {
  enabled: boolean;
  closeToTray: boolean;
}

const RECEIPT_PRINT_SETTINGS_KEY = 'receipt_print_settings';
const THEME_PREFERENCE_KEY = 'theme_preference';
const TRAY_SETTINGS_KEY = 'tray_settings';
const DEFAULT_RECEIPT_PRINT_SETTINGS: ReceiptPrintSettings = {
  silent: false,
  printBackground: true,
};
const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
export const DEFAULT_TRAY_SETTINGS: TraySettings = {
  enabled: true,
  closeToTray: false,
};

function normalizeReceiptPrintSettings(
  value: unknown,
  base: ReceiptPrintSettings = DEFAULT_RECEIPT_PRINT_SETTINGS
): ReceiptPrintSettings {
  if (!value || typeof value !== 'object') {
    return { ...base };
  }

  const candidate = value as Partial<ReceiptPrintSettings>;

  return {
    silent: typeof candidate.silent === 'boolean' ? candidate.silent : base.silent,
    printBackground:
      typeof candidate.printBackground === 'boolean'
        ? candidate.printBackground
        : base.printBackground,
  };
}

export async function getReceiptPrintSettings(): Promise<ReceiptPrintSettings> {
  return normalizeReceiptPrintSettings(
    await requireServerHost().readAppSetting(RECEIPT_PRINT_SETTINGS_KEY)
  );
}

async function saveReceiptPrintSettings(settings: unknown): Promise<ReceiptPrintSettings> {
  const nextSettings = normalizeReceiptPrintSettings(settings, await getReceiptPrintSettings());
  await requireServerHost().writeAppSetting(RECEIPT_PRINT_SETTINGS_KEY, nextSettings);
  return nextSettings;
}

function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }

  return DEFAULT_THEME_PREFERENCE;
}

export function applyThemePreference(preference: ThemePreference): ThemePreference {
  nativeTheme.themeSource = preference;
  return preference;
}

export async function getThemePreference(): Promise<ThemePreference> {
  return normalizeThemePreference(await requireServerHost().readAppSetting(THEME_PREFERENCE_KEY));
}

async function saveThemePreference(preference: unknown): Promise<ThemePreference> {
  const nextPreference = applyThemePreference(normalizeThemePreference(preference));
  await requireServerHost().writeAppSetting(THEME_PREFERENCE_KEY, nextPreference);
  return nextPreference;
}

function normalizeTraySettings(
  value: unknown,
  base: TraySettings = DEFAULT_TRAY_SETTINGS
): TraySettings {
  if (!value || typeof value !== 'object') {
    return { ...base };
  }

  const candidate = value as Partial<TraySettings>;

  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : base.enabled,
    closeToTray:
      typeof candidate.closeToTray === 'boolean' ? candidate.closeToTray : base.closeToTray,
  };
}

export async function getTraySettings(): Promise<TraySettings> {
  return normalizeTraySettings(await requireServerHost().readAppSetting(TRAY_SETTINGS_KEY));
}

async function saveTraySettings(
  settings: unknown,
  refreshTray: (settings: TraySettings) => void
): Promise<TraySettings> {
  const nextSettings = normalizeTraySettings(settings, await getTraySettings());
  await requireServerHost().writeAppSetting(TRAY_SETTINGS_KEY, nextSettings);
  refreshTray(nextSettings);
  return nextSettings;
}

export interface SettingsIpcDeps {
  /** Live main window (or null) — needed to retitle it on locale change. */
  getMainWindow: () => BrowserWindow | null;
  /**
   * Rebuilds the native tray from the given settings; called without an
   * argument to re-render the current tray (e.g. after a locale change
   * retranslates the context-menu labels).
   */
  refreshTray: (settings?: TraySettings) => void;
}

export function registerSettingsIpc(deps: SettingsIpcDeps): void {
  ipcMain.handle('get-receipt-print-settings', async () => {
    return getReceiptPrintSettings();
  });
  // Gate rationale + the update-main-locale exemption live in
  // settings-handlers.ts, where node tests pin both.
  ipcMain.handle('update-receipt-print-settings', async (_event, settings: unknown) => {
    return captureDesktopIpcSessionResult(() =>
      handleGatedSettingsUpdate(desktopSession, () => saveReceiptPrintSettings(settings))
    );
  });
  // The window opens before the server; the theme lives in its database.
  ipcMain.handle('get-theme-preference', async () => {
    await whenServerReady();
    return getThemePreference();
  });
  ipcMain.handle('update-theme-preference', async (_event, preference: unknown) => {
    return captureDesktopIpcSessionResult(() =>
      handleGatedSettingsUpdate(desktopSession, () => saveThemePreference(preference))
    );
  });
  ipcMain.handle('get-tray-settings', async () => {
    return getTraySettings();
  });
  ipcMain.handle('update-tray-settings', async (_event, settings: unknown) => {
    return captureDesktopIpcSessionResult(() =>
      handleGatedSettingsUpdate(desktopSession, () => saveTraySettings(settings, deps.refreshTray))
    );
  });
  ipcMain.handle('update-main-locale', async (_event, locale: unknown): Promise<MainLocale> => {
    return handleLocaleUpdate<MainLocale>(
      {
        normalize: normalizeMainLocale,
        apply: next => {
          setMainLocale(next);
          refreshAutoUpdateTranslations();
          deps.getMainWindow()?.setTitle(t('app.windowTitle'));
          deps.refreshTray();
        },
      },
      locale
    );
  });
}
