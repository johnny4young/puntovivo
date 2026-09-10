/**
 * Production application menu.
 *
 * Electron installs a default menu when the app sets none, and that default
 * carries View -> Toggle Developer Tools. Confirmed on a packaged build:
 * Cmd+Alt+I opens DevTools and `Object.keys(window.db)` returns the full data
 * bridge. Any operator standing at a terminal has a console against the local
 * encrypted database.
 *
 * The fix is NOT `Menu.setApplicationMenu(null)`. On macOS the clipboard
 * shortcuts live in the application menu, so removing it outright takes
 * Cmd+C / Cmd+V / Cmd+Z away from every text field in the POS — a worse bug
 * than the one being fixed, and one that only shows up on the operator's
 * machine. Ship a curated menu instead: the roles the app genuinely needs,
 * and no View menu at all.
 *
 * Development keeps Electron's default, because DevTools is the tool.
 *
 * @module main/application-menu
 */

import type { MenuItemConstructorOptions } from 'electron';

/** Roles that expose a developer console, in any menu Electron can build. */
export const DEVELOPER_MENU_ROLES = ['toggleDevTools', 'reload', 'forceReload'] as const;

/**
 * @returns the curated template for a packaged build, or `null` to keep
 *   Electron's default menu (development only).
 */
export function buildApplicationMenuTemplate(args: {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appName: string;
}): MenuItemConstructorOptions[] | null {
  if (!args.isPackaged) return null;

  const template: MenuItemConstructorOptions[] = [];

  // macOS always renders a leading application menu; supplying our own keeps
  // About/Hide/Quit working without inheriting anything else.
  if (args.platform === 'darwin') {
    template.push({ label: args.appName, role: 'appMenu' });
  }

  // The one that matters: without it, macOS text fields lose copy and paste.
  template.push({ role: 'editMenu' });
  template.push({ role: 'windowMenu' });

  // Deliberately no View menu. That is where toggleDevTools, reload and
  // forceReload live, and a POS operator needs none of them.
  return template;
}

/**
 * Walk a template and collect every developer role it exposes, at any depth.
 * Used by the test so the guarantee is structural rather than a spot check.
 */
export function findDeveloperRoles(
  template: readonly MenuItemConstructorOptions[] | null
): string[] {
  if (!template) return [];
  const found: string[] = [];
  const visit = (items: readonly MenuItemConstructorOptions[]): void => {
    for (const item of items) {
      if (item.role && (DEVELOPER_MENU_ROLES as readonly string[]).includes(item.role)) {
        found.push(item.role);
      }
      if (Array.isArray(item.submenu)) visit(item.submenu);
    }
  };
  visit(template);
  return found;
}
