/** native tray lifecycle, isolated from application bootstrap. */

import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron';
import { t } from './i18n';
import type { TraySettings } from './ipc/settings.js';

interface TrayControllerDeps {
  getMainWindow: () => BrowserWindow | null;
  toggleMainWindow: () => void;
  markQuitting: () => void;
}

export interface TrayController {
  getSettings: () => TraySettings;
  refresh: (settings?: TraySettings) => void;
  destroy: () => void;
}

export function createTrayController({
  getMainWindow,
  toggleMainWindow,
  markQuitting,
}: TrayControllerDeps): TrayController {
  let tray: Tray | null = null;
  let settings: TraySettings = { enabled: true, closeToTray: false };

  function createTrayIcon() {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
        <rect x="10" y="10" width="44" height="44" rx="12" fill="#0ea5e9"/>
        <path d="M22 22h20v6H28v8h12v6H28v10h-6V22z" fill="#ffffff"/>
      </svg>
    `.trim();
    return nativeImage
      .createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
      .resize({ width: 18, height: 18 });
  }

  function destroy(): void {
    if (!tray) return;
    // Detach native listeners so repeated enable/disable cannot leak.
    tray.removeAllListeners('click');
    tray.destroy();
    tray = null;
  }

  function refresh(nextSettings = settings): void {
    settings = nextSettings;
    if (!settings.enabled) {
      destroy();
      return;
    }

    if (!tray) {
      tray = new Tray(createTrayIcon());
      tray.setToolTip(t('tray.tooltip'));
      tray.on('click', toggleMainWindow);
    }

    const mainWindow = getMainWindow();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: mainWindow?.isVisible() ? t('tray.hideWindow') : t('tray.openWindow'),
          click: toggleMainWindow,
        },
        { type: 'separator' },
        {
          label: settings.closeToTray ? t('tray.closeHidesToTray') : t('tray.closeQuitsApp'),
          enabled: false,
        },
        { type: 'separator' },
        {
          label: t('tray.quit'),
          click: () => {
            markQuitting();
            app.quit();
          },
        },
      ])
    );
  }

  return { getSettings: () => settings, refresh, destroy };
}
