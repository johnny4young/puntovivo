/**
 * shared admin gates for the backup IPC surface. Every backup
 * channel is admin-only; the audit-bearing ones also need the acting
 * identity for their immutable evidence rows.
 *
 * @module main/ipc/backup/guards
 */

// read authenticated identity from the main-process singleton,
// never from renderer-supplied arguments.
import * as desktopSession from '../../session/desktopSession.ts';

export function requireAdminTenant(): string {
  desktopSession.requireOneOfRoles(['admin']);
  return desktopSession.requireTenantId();
}

export function requireAdminTenantActor(): { tenantId: string; actorId: string } {
  desktopSession.requireOneOfRoles(['admin']);
  return {
    tenantId: desktopSession.requireTenantId(),
    actorId: desktopSession.requireUserId(),
  };
}
