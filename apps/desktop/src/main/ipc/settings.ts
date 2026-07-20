/**
 * desktop settings IPC (receipt printing, theme, tray,
 * main-process locale), extracted verbatim from the former monolithic
 * `main/index.ts`.
 *
 * Owns the `app_settings`-backed persistence helpers plus the
 * normalisers for each settings shape. The tray itself (native Tray
 * instance, context menu, visibility toggling) stays in `main/index.ts`
 * because it is bound to the main-window lifecycle; this module only
 * persists the tray *settings* and calls back through `deps.refreshTray`
 * so the native tray reflects the saved state.
 *
 * @module main/ipc/settings
 */

import { ipcMain, nativeTheme, type BrowserWindow } from 'electron';
import {
  appSettings,
  // Drizzle operators re-exported by the server package: they must come
  // from the same drizzle-orm instance that typed the schema tables above
  // (a direct 'drizzle-orm' import here is a phantom dependency that can
  // resolve to a different module identity and break the typecheck).
  eq,
} from '@puntovivo/server';
import { getServerDatabase } from '../runtime.js';
import { t, setMainLocale, normalizeMainLocale, type MainLocale } from '../i18n';
import { refreshAutoUpdateTranslations } from '../auto-updater';

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
  const database = getServerDatabase();
  const row = await database
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, RECEIPT_PRINT_SETTINGS_KEY))
    .get();

  return normalizeReceiptPrintSettings(row?.value);
}

async function saveReceiptPrintSettings(settings: unknown): Promise<ReceiptPrintSettings> {
  const database = getServerDatabase();
  const now = new Date().toISOString();
  const nextSettings = normalizeReceiptPrintSettings(settings, await getReceiptPrintSettings());
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, RECEIPT_PRINT_SETTINGS_KEY))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value: nextSettings,
        updatedAt: now,
      })
      .where(eq(appSettings.key, RECEIPT_PRINT_SETTINGS_KEY));
  } else {
    await database.insert(appSettings).values({
      key: RECEIPT_PRINT_SETTINGS_KEY,
      value: nextSettings,
      updatedAt: now,
    });
  }

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
  const database = getServerDatabase();
  const row = await database
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, THEME_PREFERENCE_KEY))
    .get();

  return normalizeThemePreference(row?.value);
}

async function saveThemePreference(preference: unknown): Promise<ThemePreference> {
  const database = getServerDatabase();
  const now = new Date().toISOString();
  const nextPreference = applyThemePreference(normalizeThemePreference(preference));
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, THEME_PREFERENCE_KEY))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value: nextPreference,
        updatedAt: now,
      })
      .where(eq(appSettings.key, THEME_PREFERENCE_KEY))
      .run();
  } else {
    await database.insert(appSettings).values({
      key: THEME_PREFERENCE_KEY,
      value: nextPreference,
      updatedAt: now,
    });
  }

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
  const database = getServerDatabase();
  const row = await database
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, TRAY_SETTINGS_KEY))
    .get();

  return normalizeTraySettings(row?.value);
}

async function saveTraySettings(
  settings: unknown,
  refreshTray: (settings: TraySettings) => void
): Promise<TraySettings> {
  const database = getServerDatabase();
  const now = new Date().toISOString();
  const nextSettings = normalizeTraySettings(settings, await getTraySettings());
  const existing = await database
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, TRAY_SETTINGS_KEY))
    .get();

  if (existing) {
    await database
      .update(appSettings)
      .set({
        value: nextSettings,
        updatedAt: now,
      })
      .where(eq(appSettings.key, TRAY_SETTINGS_KEY))
      .run();
  } else {
    await database.insert(appSettings).values({
      key: TRAY_SETTINGS_KEY,
      value: nextSettings,
      updatedAt: now,
    });
  }

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
  ipcMain.handle('update-receipt-print-settings', async (_event, settings: unknown) => {
    return saveReceiptPrintSettings(settings);
  });
  ipcMain.handle('get-theme-preference', async () => {
    return getThemePreference();
  });
  ipcMain.handle('update-theme-preference', async (_event, preference: unknown) => {
    return saveThemePreference(preference);
  });
  ipcMain.handle('get-tray-settings', async () => {
    return getTraySettings();
  });
  ipcMain.handle('update-tray-settings', async (_event, settings: unknown) => {
    return saveTraySettings(settings, deps.refreshTray);
  });
  ipcMain.handle('update-main-locale', async (_event, locale: unknown): Promise<MainLocale> => {
    const next = normalizeMainLocale(typeof locale === 'string' ? locale : null);
    setMainLocale(next);
    refreshAutoUpdateTranslations();
    deps.getMainWindow()?.setTitle(t('app.windowTitle'));
    deps.refreshTray();
    return next;
  });
}
