/**
 * ENG-068 — `ModulesContext` mounted between `AuthProvider` and the
 * route tree. Fetches `modules.getEffective` once per session and
 * surfaces `useIsModuleActive(moduleId)` + `useModulesSnapshot()`.
 *
 * Defaults to the manifest-default state for every module while the
 * query is loading so the renderer never flashes hidden routes during
 * boot. The query auto-refetches on `modules.setActive` invalidation
 * (the admin tab calls `utils.modules.getEffective.invalidate()`
 * after a successful flip).
 *
 * @module features/modules/ModulesContext
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import {
  CLIENT_MODULE_DEFAULTS,
  CLIENT_MODULE_IDS,
  type ClientModuleId,
} from './manifest';

interface ModulesContextValue {
  /**
   * Full effective state map. Always carries every known module key
   * so callers don't have to special-case the missing case.
   */
  modules: Record<ClientModuleId, boolean>;
  /** Outstanding network request — true on first mount, false after. */
  isLoading: boolean;
  /**
   * `true` when the cache is still cold (i.e. defaults were used). The
   * admin tab renders a small "Cargando…" badge in that window so the
   * operator knows the toggles are not yet live.
   */
  isPlaceholder: boolean;
}

const ModulesContext = createContext<ModulesContextValue | undefined>(undefined);

interface ModulesProviderProps {
  children: ReactNode;
}

/**
 * Resolve a defensive snapshot. The renderer must NEVER read
 * `effective[id]` against an unknown id, so this helper always
 * fills every known key with either the server response or the
 * manifest default.
 */
function resolveSnapshot(
  raw: Partial<Record<string, boolean>> | undefined
): Record<ClientModuleId, boolean> {
  const out = { ...CLIENT_MODULE_DEFAULTS };
  if (!raw) {
    return out;
  }
  for (const id of CLIENT_MODULE_IDS) {
    const value = raw[id];
    if (typeof value === 'boolean') {
      out[id] = value;
    }
  }
  return out;
}

export function ModulesProvider({ children }: ModulesProviderProps) {
  const { isAuthenticated } = useAuth();
  // The endpoint is `tenantProcedure`, so it requires auth. Skip the
  // call entirely until the session is mounted so the query doesn't
  // throw UNAUTHORIZED on the login screen.
  const query = trpc.modules.getEffective.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const value = useMemo<ModulesContextValue>(() => {
    const isPlaceholder = !query.data;
    const modules = resolveSnapshot(query.data?.modules);
    return {
      modules,
      isLoading: query.isLoading,
      isPlaceholder,
    };
  }, [query.data, query.isLoading]);

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

function useModulesContext(): ModulesContextValue {
  const ctx = useContext(ModulesContext);
  if (!ctx) {
    throw new Error('useModulesContext must be used within ModulesProvider');
  }
  return ctx;
}

/**
 * Returns whether a module is active for the current tenant. While the
 * query is in-flight the manifest default applies (every demo module
 * defaults to `true` today, so this is optimistic-with-redirect — see
 * ADR-0007). Use `useModulesSnapshot().isPlaceholder` if you need to
 * distinguish "loading" from "explicitly true".
 */
export function useIsModuleActive(moduleId: ClientModuleId): boolean {
  return useModulesContext().modules[moduleId];
}

/**
 * Batch-read all modules at once. Useful for the admin tab + tests.
 */
export function useModulesSnapshot(): ModulesContextValue {
  return useModulesContext();
}
