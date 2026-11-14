/** BrowserWindow creation and navigation policy. */

import {
  app,
  BrowserWindow,
  shell,
  type WebContents,
  type WebContentsConsoleMessageEventParams,
} from 'electron';
import { join } from 'node:path';
import type { PuntovivoLogger } from '@puntovivo/server';
import { t } from './i18n';
import { isAllowedExternalUrl } from './external-url-policy.js';
import {
  isPackagedRendererUrl,
  PACKAGED_RENDERER_ENTRY_URL,
  resolveCustomerDisplayRendererUrl,
} from './renderer-protocol.js';
import {
  buildCustomerDisplayWindowWebPreferences,
  buildMainWindowWebPreferences,
} from './window-config.js';
import { createSingleFlight } from './single-flight.js';

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
  shouldCloseToTray: () => boolean;
  isQuitting: () => boolean;
  onVisibilityChange: () => void;
  /** Runs once per main window, before its renderer URL loads. */
  beforeRendererLoad?: (webContents: WebContents) => void;
}

export interface WindowLifecycle {
  getWindow: () => BrowserWindow | null;
  /** `deferReveal` keeps the window hidden until `reveal()` or `show()`. */
  create: (options?: { deferReveal?: boolean }) => void;
  openCustomerDisplay: (accessId: string) => Promise<void>;
  show: () => void;
  /** Shows a deferred window once painted; no-op if it was already shown. */
  reveal: () => void;
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
  shouldCloseToTray,
  isQuitting,
  onVisibilityChange,
  beforeRendererLoad,
}: WindowLifecycleDeps): WindowLifecycle {
  let mainWindow: BrowserWindow | null = null;
  let revealRequested = false;
  let painted = false;
  let customerDisplayWindow: BrowserWindow | null = null;
  let customerDisplayAccessId: string | null = null;
  let pendingCustomerDisplayAccessId: string | null = null;
  const runCustomerDisplayOpen = createSingleFlight<void>();

  function getWindow(): BrowserWindow | null {
    return mainWindow;
  }

  function show(): void {
    if (!mainWindow || mainWindow.isDestroyed()) {
      create();
      return;
    }
    revealRequested = true;
    // ready-to-show shows it: an earlier show() flashes an empty frame.
    if (!painted) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }

  function reveal(): void {
    if (!revealRequested) show();
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

  function closeCustomerDisplay(): void {
    const displayWindow = customerDisplayWindow;
    customerDisplayWindow = null;
    customerDisplayAccessId = null;
    if (displayWindow && !displayWindow.isDestroyed()) displayWindow.destroy();
  }

  function openCustomerDisplay(accessId: string): Promise<void> {
    if (pendingCustomerDisplayAccessId && pendingCustomerDisplayAccessId !== accessId) {
      return Promise.reject(new Error('Customer Display is opening for another register'));
    }
    pendingCustomerDisplayAccessId = accessId;
    return runCustomerDisplayOpen(async () => {
      if (
        customerDisplayWindow &&
        !customerDisplayWindow.isDestroyed() &&
        customerDisplayAccessId === accessId
      ) {
        if (customerDisplayWindow.isMinimized()) customerDisplayWindow.restore();
        customerDisplayWindow.show();
        customerDisplayWindow.focus();
        return;
      }

      if (customerDisplayWindow && !customerDisplayWindow.isDestroyed()) {
        const target = resolveCustomerDisplayRendererUrl({ isDev, webDevServerUrl, accessId });
        try {
          await customerDisplayWindow.loadURL(target);
          customerDisplayAccessId = accessId;
          customerDisplayWindow.show();
          customerDisplayWindow.focus();
          return;
        } catch (err) {
          log.error({ err, source: target }, 'failed to switch customer display pairing');
          closeCustomerDisplay();
          throw err;
        }
      }

      const displayWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        title: t('app.windowTitle'),
        webPreferences: buildCustomerDisplayWindowWebPreferences(
          join(__dirname, '../preload/customer-display.cjs')
        ),
      });
      customerDisplayWindow = displayWindow;
      displayWindow.on('ready-to-show', () => {
        if (!displayWindow.isDestroyed()) displayWindow.show();
      });
      displayWindow.on('closed', () => {
        if (customerDisplayWindow === displayWindow) {
          customerDisplayWindow = null;
          customerDisplayAccessId = null;
        }
      });

      const target = resolveCustomerDisplayRendererUrl({ isDev, webDevServerUrl, accessId });
      log.info({ source: target }, 'opening customer display window');
      try {
        await displayWindow.loadURL(target);
        customerDisplayAccessId = accessId;
      } catch (err) {
        log.error({ err, source: target }, 'failed to load customer display window');
        closeCustomerDisplay();
        throw err;
      }
    }).finally(() => {
      if (pendingCustomerDisplayAccessId === accessId) pendingCustomerDisplayAccessId = null;
    });
  }

  function create({ deferReveal = false }: { deferReveal?: boolean } = {}): void {
    revealRequested = !deferReveal;
    painted = false;
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 768,
      show: false,
      autoHideMenuBar: true,
      title: t('app.windowTitle'),
      // exact sandboxed webPreferences live in window-config.ts.
      webPreferences: buildMainWindowWebPreferences(join(__dirname, '../preload/index.cjs')),
    });

    mainWindow.on('ready-to-show', () => {
      painted = true;
      if (revealRequested) mainWindow?.show();
    });
    mainWindow.on('close', event => {
      if (!isQuitting() && shouldCloseToTray()) {
        event.preventDefault();
        hide();
      }
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
      // A public projection has no useful owner once the POS renderer is gone.
      // Closing it also preserves ordinary Windows/Linux quit semantics instead
      // of leaving the process alive behind a stale auxiliary window.
      closeCustomerDisplay();
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
        return isPackagedRendererUrl(target);
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

    beforeRendererLoad?.(mainWindow.webContents);

    if (isDev) {
      log.info({ source: webDevServerUrl }, 'loading renderer from dev server');
      void mainWindow.loadURL(webDevServerUrl);
      if (shouldOpenDevTools) mainWindow.webContents.openDevTools();
    } else {
      log.info({ source: PACKAGED_RENDERER_ENTRY_URL }, 'loading renderer from packaged bundle');
      void mainWindow.loadURL(PACKAGED_RENDERER_ENTRY_URL);
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

  return {
    getWindow,
    create,
    openCustomerDisplay,
    show,
    reveal,
    hide,
    toggleVisibility,
    installGlobalWebContentsPolicy,
  };
}
