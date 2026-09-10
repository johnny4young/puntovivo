/**
 * A packaged build must not ship a developer console.
 *
 * Electron installs a default menu when the app sets none, and that default
 * carries View -> Toggle Developer Tools. Confirmed by hand on a packaged
 * build: Cmd+Alt+I opened DevTools and `Object.keys(window.db)` returned
 * getAll, getById, insert, update, delete, getByField, deleteByTenant,
 * countByTenant, addToSyncQueue, getPendingSyncItems — a console against the
 * local encrypted database, at any operator's terminal.
 *
 * @module main/__tests__/application-menu.test
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildApplicationMenuTemplate, findDeveloperRoles } from '../application-menu.ts';

const PLATFORMS: NodeJS.Platform[] = ['darwin', 'win32', 'linux'];

describe('application menu', () => {
  it('exposes no developer role on any packaged platform', () => {
    for (const platform of PLATFORMS) {
      const template = buildApplicationMenuTemplate({
        isPackaged: true,
        platform,
        appName: 'Puntovivo',
      });
      assert.deepEqual(findDeveloperRoles(template), [], platform);
    }
  });

  it('declares no View menu, which is where those roles live', () => {
    for (const platform of PLATFORMS) {
      const template = buildApplicationMenuTemplate({
        isPackaged: true,
        platform,
        appName: 'Puntovivo',
      })!;
      assert.equal(
        template.some(item => item.role === 'viewMenu'),
        false,
        platform
      );
    }
  });

  it('keeps the edit menu, so macOS text fields keep copy and paste', () => {
    // setApplicationMenu(null) would also remove DevTools, and would take
    // Cmd+C / Cmd+V / Cmd+Z away from every field in the POS. That failure
    // only appears on the operator's machine, which is the worst place for it.
    for (const platform of PLATFORMS) {
      const template = buildApplicationMenuTemplate({
        isPackaged: true,
        platform,
        appName: 'Puntovivo',
      })!;
      assert.equal(
        template.some(item => item.role === 'editMenu'),
        true,
        platform
      );
    }
  });

  it('gives macOS its application menu so About, Hide and Quit still work', () => {
    const darwin = buildApplicationMenuTemplate({
      isPackaged: true,
      platform: 'darwin',
      appName: 'Puntovivo',
    })!;
    const appMenu = darwin.find(item => item.role === 'appMenu');
    assert.ok(appMenu, 'darwin needs a leading application menu');
    assert.equal(appMenu.label, 'Puntovivo');

    // Not applicable off macOS; including it there would render an empty entry.
    for (const platform of ['win32', 'linux'] as NodeJS.Platform[]) {
      const template = buildApplicationMenuTemplate({
        isPackaged: true,
        platform,
        appName: 'Puntovivo',
      })!;
      assert.equal(
        template.some(item => item.role === 'appMenu'),
        false,
        platform
      );
    }
  });

  it('leaves the default menu alone in development', () => {
    // DevTools is the tool during development; only the packaged build is
    // hardened. Returning null is how the caller knows to install nothing.
    for (const platform of PLATFORMS) {
      assert.equal(
        buildApplicationMenuTemplate({ isPackaged: false, platform, appName: 'Puntovivo' }),
        null,
        platform
      );
    }
  });

  it('the role scanner actually finds a developer role when one is present', () => {
    // Guards the guard: a scanner that matched nothing would make every
    // assertion above vacuously true.
    assert.deepEqual(findDeveloperRoles([{ role: 'toggleDevTools' }]), ['toggleDevTools']);
    assert.deepEqual(findDeveloperRoles([{ label: 'View', submenu: [{ role: 'forceReload' }] }]), [
      'forceReload',
    ]);
  });
});
