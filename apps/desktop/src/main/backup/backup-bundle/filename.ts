// canonical backup filename builder ( slice 31).

/**
 * Build the canonical backup filename. Includes the tenant slug
 * (when supplied) + an ISO-style timestamp so files sort
 * chronologically AND carry tenant context — handy when a support
 * ticket has multiple backups attached.
 */
export function createBackupFileName(args?: { tenantSlug?: string; now?: Date }): string {
  const now = args?.now ?? new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const slugSegment = args?.tenantSlug ? `-${args.tenantSlug.replace(/[^a-z0-9-]/gi, '-')}` : '';
  return `puntovivo-backup${slugSegment}-${timestamp}.zip`;
}
