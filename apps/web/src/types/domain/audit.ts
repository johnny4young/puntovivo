// audit-log domain shape ( slice 28).

import type { AuditLogAction, AuditLogResourceType } from '../ui';

export interface AuditLogEntry {
  id: string;
  actorId: string;
  actorName: string | null;
  actorEmail: string | null;
  action: AuditLogAction;
  resourceType: AuditLogResourceType;
  resourceId: string;
  /** Current name or number of the resource; null once it no longer exists. */
  resourceName?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
