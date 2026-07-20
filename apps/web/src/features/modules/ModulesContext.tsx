/**
 * /  — effective-modules state for the renderer.
 *
 * Originally a React context (`ModulesProvider`) mounted between
 * `AuthProvider` and the route tree.  migrated it to a Zustand
 * store so an `AuthProvider` re-render no longer cascades a new context
 * value through every `useIsModuleActive` consumer; components now
 * subscribe to the store via selectors and only re-render when the slice
 * they read actually changes.
 *
 * The tRPC query cannot live inside a Zustand store, so `useModulesSync()`
 * (mounted once via `<ModulesSync />` in `App.tsx`) runs
 * `modules.getEffective` and writes the resolved snapshot into the store.
 * Public hooks `useIsModuleActive` + `useModulesSnapshot` keep their
 * original signatures so the ~12 consumers and their test mocks are
 * untouched.
 *
 * Defaults to the manifest-default state for every module while the query
 * is loading so the renderer never flashes hidden routes during boot. The
 * query auto-refetches on `modules.setActive` invalidation (the admin tab
 * calls `utils.modules.getEffective.invalidate()` after a successful flip).
 *
 * @module features/modules/ModulesContext
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { CLIENT_MODULE_DEFAULTS, CLIENT_MODULE_IDS, type ClientModuleId } from './manifest';

/**
 * Read model exposed by `useModulesSnapshot()`. Mirrors the shape the old
 * `ModulesContext` provided so callers (admin tab, tests) are unchanged.
 */
export interface ModulesSnapshot {
  /**
   * Full effective state map. Always carries every known module key so
   * callers don't have to special-case the missing case.
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

/**
 * Internal Zustand store backing the modules snapshot. `setSnapshot` is
 * fed by `useModulesSync` from the tRPC query; `reset` drops the snapshot
 * back to manifest defaults on logout so a new cashier never inherits the
 * previous tenant's module flags.
 */
interface ModulesStore extends ModulesSnapshot {
  setSnapshot(
    data: { modules?: Partial<Record<string, boolean>> } | undefined,
    isLoading: boolean
  ): void;
  reset(): void;
}

/**
 * Resolve a defensive snapshot. The renderer must NEVER read
 * `effective[id]` against an unknown id, so this helper always fills every
 * known key with either the server response or the manifest default.
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

const useModulesStore = create<ModulesStore>(set => ({
  modules: { ...CLIENT_MODULE_DEFAULTS },
  isLoading: true,
  isPlaceholder: true,
  setSnapshot(data, isLoading) {
    set({
      modules: resolveSnapshot(data?.modules),
      isLoading,
      isPlaceholder: !data,
    });
  },
  reset() {
    set({
      modules: { ...CLIENT_MODULE_DEFAULTS },
      isLoading: false,
      isPlaceholder: true,
    });
  },
}));

/**
 * Bridges the `modules.getEffective` tRPC query into the Zustand store.
 * Mount exactly once near the top of the authenticated tree via
 * `<ModulesSync />`. Idempotent under StrictMode double-mount (React Query
 * dedupes the request; the effect just re-writes the same snapshot).
 */
export function useModulesSync(): void {
  const { isAuthenticated } = useAuth();
  // The endpoint is `tenantProcedure`, so it requires auth. Skip the call
  // entirely until the session is mounted so the query doesn't throw
  // UNAUTHORIZED on the login screen.
  const query = trpc.modules.getEffective.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    // no window-focus refetch; the 5-minute staleTime is the
    // freshness contract and admin flips invalidate explicitly.
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      useModulesStore.getState().reset();
      return;
    }
    useModulesStore.getState().setSnapshot(query.data, query.isLoading);
  }, [isAuthenticated, query.data, query.isLoading]);
}

/**
 * Null-rendering mount point for `useModulesSync`. Placed inside
 * `AuthProvider` in `App.tsx` so the query has an auth context.
 */
export function ModulesSync(): null {
  useModulesSync();
  return null;
}

/**
 * Returns whether a module is active for the current tenant. While the
 * query is in-flight the manifest default applies (every demo module
 * defaults to `true` today, so this is optimistic-with-redirect — see
 * ADR-0007). Use `useModulesSnapshot().isPlaceholder` if you need to
 * distinguish "loading" from "explicitly true".
 */
export function useIsModuleActive(moduleId: ClientModuleId): boolean {
  return useModulesStore(state => state.modules[moduleId]);
}

/**
 * Batch-read all modules at once. Useful for the admin tab + tests.
 * Reads each field with its own selector so the returned object never
 * triggers the Zustand "snapshot not cached" warning (each selector
 * returns a stable slice).
 */
export function useModulesSnapshot(): ModulesSnapshot {
  const modules = useModulesStore(state => state.modules);
  const isLoading = useModulesStore(state => state.isLoading);
  const isPlaceholder = useModulesStore(state => state.isPlaceholder);
  return { modules, isLoading, isPlaceholder };
}

/**
 * Test-only escape hatch to drive the store directly without mounting the
 * sync hook. Not exported from the feature barrel.
 */
export const __modulesStoreForTests = useModulesStore;
