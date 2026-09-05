import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import type { EmploymentCursor } from './employmentTypes';

/** Tenant-scoped filters share the same stable keyset boundary for both privacy projections. */
export function useEmploymentFilters() {
  const [siteId, setSiteId] = useState('');
  const [onDate, setOnDate] = useState('');
  const [cursors, setCursors] = useState<EmploymentCursor[]>([]);
  const sites = trpc.sites.list.useQuery({ includeInactive: true });
  return {
    siteId,
    setSiteId,
    onDate,
    setOnDate,
    cursors,
    setCursors,
    sites,
    input: {
      limit: 20,
      ...(siteId ? { siteId } : {}),
      ...(onDate ? { onDate } : {}),
      ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}),
    },
  };
}
