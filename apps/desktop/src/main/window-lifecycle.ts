/** ENG-201 — BrowserWindow creation, navigation policy, and measurement mode. */

import { app, BrowserWindow, shell, type WebContentsConsoleMessageEventParams } from 'electron';
import { join } from 'node:path';
import type { PuntovivoLogger } from '@puntovivo/server';
import { t } from './i18n';
import { isAllowedExternalUrl } from './external-url-policy.js';
import { buildMainWindowWebPreferences } from './window-config.js';

const RENDERER_LEVEL_MAP = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
} as const satisfies Record<
  WebContentsConsoleMessageEventParams['level'],
  'debug' | 'info' | 'warn' | 'error'
>;

interface WindowLifecycleDeps {
  webDevServerUrl: string;
  isDev: boolean;
  shouldOpenDevTools: boolean;
  log: PuntovivoLogger;
  rendererLog: PuntovivoLogger;
  stopEmbeddedServer: () => Promise<void>;
  shouldCloseToTray: () => boolean;
  isQuitting: () => boolean;
  onVisibilityChange: () => void;
}

export interface WindowLifecycle {
  getWindow: () => BrowserWindow | null;
  create: () => void;
  show: () => void;
  hide: () => void;
  toggleVisibility: () => void;
  installGlobalWebContentsPolicy: () => void;
}

export function createWindowLifecycle({
  webDevServerUrl,
  isDev,
  shouldOpenDevTools,
  log,
  rendererLog,
  stopEmbeddedServer,
  shouldCloseToTray,
  isQuitting,
  onVisibilityChange,
}: WindowLifecycleDeps): WindowLifecycle {
  let mainWindow: BrowserWindow | null = null;

  function getWindow(): BrowserWindow | null {
    return mainWindow;
  }

  function show(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
      create();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }

  function hide(): void {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  }

  function toggleVisibility(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
      create();
      return;
    }
    if (mainWindow.isVisible()) hide();
    else show();
  }

  function create(): void {
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 768,
      show: false,
      autoHideMenuBar: true,
      title: t('app.windowTitle'),
      // ENG-004 — exact sandboxed webPreferences live in window-config.ts.
      webPreferences: buildMainWindowWebPreferences(join(__dirname, '../preload/index.cjs')),
    });

    mainWindow.on('ready-to-show', () => mainWindow?.show());
    mainWindow.on('close', event => {
      if (!isQuitting() && shouldCloseToTray()) {
        event.preventDefault();
        hide();
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    mainWindow.on('show', onVisibilityChange);
    mainWindow.on('hide', onVisibilityChange);

    mainWindow.webContents.setWindowOpenHandler(details => {
      if (!isAllowedExternalUrl(details.url)) {
        log.warn({ url: details.url }, 'blocked unsupported external URL');
        return { action: 'deny' };
      }
      void shell.openExternal(details.url);
      return { action: 'deny' };
    });

    const isInAppNavigation = (target: string): boolean => {
      try {
        const url = new URL(target);
        if (isDev) return url.origin === new URL(webDevServerUrl).origin;
        if (url.protocol !== 'file:') return false;
        const packagedDist = join(process.resourcesPath, 'dist');
        return decodeURIComponent(url.pathname).startsWith(packagedDist);
      } catch {
        return false;
      }
    };
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (isInAppNavigation(url)) return;
      event.preventDefault();
      if (isAllowedExternalUrl(url)) {
        void shell.openExternal(url);
        return;
      }
      log.warn({ url }, 'blocked unsupported renderer navigation');
    });

    // ENG-133b — machine-readable Electron memory gate. Verify the React root
    // mounted before measuring so Chromium error pages never report a false pass.
    if (process.env.PUNTOVIVO_MEASURE_MEMORY === '1') {
      const measuredWebContents = mainWindow.webContents;
      measuredWebContents.once('did-finish-load', () => {
        setTimeout(() => {
          const shutdown = () =>
            void stopEmbeddedServer()
              .catch(err => {
                log.warn({ err }, 'failed to stop embedded server after memory measurement');
              })
              .finally(() => app.exit(0));

          void measuredWebContents
            .executeJavaScript(
              'Boolean(document.getElementById("root") && document.getElementById("root").childElementCount > 0)'
            )
            .catch(() => false)
            .then(appMounted => {
              if (!appMounted) {
                process.stdout.write('PUNTOVIVO_MEMORY_SKIP=app-not-mounted\n');
                shutdown();
                return;
              }
              const metrics = app.getAppMetrics().map(metric => ({
                type: metric.type,
                workingSetKb: metric.memory.workingSetSize,
              }));
              process.stdout.write(`PUNTOVIVO_MEMORY_METRICS=${JSON.stringify(metrics)}\n`);
              shutdown();
            });
        }, 2000);
      });
    }

    if (isDev) {
      log.info({ source: webDevServerUrl }, 'loading renderer from dev server');
      void mainWindow.loadURL(webDevServerUrl);
      if (shouldOpenDevTools) mainWindow.webContents.openDevTools();
    } else {
      const webAppPath = join(process.resourcesPath, 'dist', 'index.html');
      log.info({ source: webAppPath }, 'loading renderer from packaged bundle');
      void mainWindow.loadFile(webAppPath);
    }

    if (isDev) {
      mainWindow.webContents.on('console-message', details => {
        const method = RENDERER_LEVEL_MAP[details.level] ?? 'info';
        rendererLog[method](
          { sourceId: details.sourceId, lineNumber: details.lineNumber },
          details.message
        );
      });
    }
  }

  function installGlobalWebContentsPolicy(): void {
    app.on('web-contents-created', (_event, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        if (isAllowedExternalUrl(url)) void shell.openExternal(url);
        else log.warn({ url }, 'blocked window.open from webContents');
        return { action: 'deny' };
      });
      contents.on('will-attach-webview', event => event.preventDefault());
      contents.on('will-navigate', (event, url) => {
        if (mainWindow && contents === mainWindow.webContents) return;
        event.preventDefault();
        log.warn({ url }, 'blocked navigation in auxiliary webContents');
      });
    });
  }

  return { getWindow, create, show, hide, toggleVisibility, installGlobalWebContentsPolicy };
}
