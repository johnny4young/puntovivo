/**
 * Render-side gate that mirrors `createModuleGuard` on the
 * server. Wraps any subtree (a route, a sidebar item, a dashboard
 * card) and returns `null` (or an explicit fallback) when the module
 * is off for the current tenant.
 *
 * The wrapper does NOT throw — gating is purely a hide-on-render. The
 * server-side guard is what actually enforces the policy when a
 * request arrives. This separation keeps the kernel resilient against
 * a stale renderer (e.g. cached bundle) trying to call a deactivated
 * module — the procedure returns FORBIDDEN with `MODULE_NOT_ACTIVATED`
 * which the renderer's error toast surfaces in a translated form.
 *
 * @module features/modules/RequireModule
 */

import type { ReactNode } from 'react';
import { useIsModuleActive } from './ModulesContext';
import type { ClientModuleId } from './manifest';

interface RequireModuleProps {
  id: ClientModuleId;
  children: ReactNode;
  /**
   * Optional fallback rendered when the module is off. Useful for
   * route gating where we want to redirect to the dashboard rather
   * than render nothing. Sidebar items pass nothing here so the entry
   * fully disappears.
   */
  fallback?: ReactNode;
}

export function RequireModule({ id, children, fallback = null }: RequireModuleProps) {
  const active = useIsModuleActive(id);
  if (!active) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
