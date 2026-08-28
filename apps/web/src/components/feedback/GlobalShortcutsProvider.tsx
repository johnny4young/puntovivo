/**
 * "atajos reales" — global keyboard shortcuts.
 *
 * One window-level keydown listener drives every global-scope entry in
 * the shortcut catalogue that is not owned by another provider (the
 * palette keeps its own Mod+K listener):
 *
 * - Alt+1..4  → navigate dashboard / sales / inventory / purchases
 * - Alt+/     → toggle the shortcut sheet (discovery surface)
 * - Alt+Shift+D → toggle light/dark theme
 * - Alt+Shift+S → cycle to the next active site
 * - Alt+Q     → CONFIRM, then log out (logout purges cart workspaces)
 *
 * Guard policy, in order: bail without Alt; the sheet chord may CLOSE
 * the sheet from anywhere; nothing fires from an editable target;
 * matching runs BEFORE the open-dialog DOM query so unmatched
 * keystrokes never pay for it; a matched action is dropped while any
 * other modal owns the page (`hasOpenModalDialog`) — the same policy
 * the palette listener applies. Matching goes through the catalogue's
 * `matchesShortcut`, whose `event.code` fallback rescues ONLY macOS
 * Alt-composition (printable keys are never remapped by physical
 * position). The sheet chord additionally accepts '?' and tolerates
 * Shift, because '/' requires Shift+7 on Spanish layouts.
 *
 * The modal bodies (sheet + logout confirm) live in a lazy chunk so
 * the always-mounted provider adds only the listener to the shared
 * index bundle.
 *
 * Mounted inside `CommandPaletteProvider` in App.tsx, under the
 * router/auth/tenant/theme providers it consumes.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useTheme } from '@/components/feedback/ThemeProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { isEditableShortcutTarget } from '@/features/sales/salesKeyboard';
import {
  SHORTCUTS,
  getShortcutById,
  hasOpenModalDialog,
  matchesShortcut,
  type ShortcutDefinition,
} from '@/lib/shortcuts';
import type { UserRole } from '@/types';

const ShortcutsSheetModal = lazy(() =>
  import('./GlobalShortcutsSheet').then(module => ({ default: module.ShortcutsSheetModal }))
);
const LogoutConfirmModal = lazy(() =>
  import('./GlobalShortcutsSheet').then(module => ({ default: module.LogoutConfirmModal }))
);

type GlobalActionId = 'themeToggle' | 'switchSite' | 'logoutConfirm';

interface GlobalBinding {
  definition: ShortcutDefinition;
  action: { kind: 'navigate'; path: string } | { kind: GlobalActionId };
}

/**
 * Resolved once at module scope: the keydown handler must not pay a
 * catalogue scan per candidate per keystroke. Paths mirror the command
 * palette's navigate actions for the same destinations.
 */
const GLOBAL_NAVIGATION_BINDINGS: readonly GlobalBinding[] = SHORTCUTS.flatMap(
  (definition): GlobalBinding[] =>
    definition.route ? [{ definition, action: { kind: 'navigate', path: definition.route } }] : []
);

const GLOBAL_BINDINGS: readonly GlobalBinding[] = [
  ...GLOBAL_NAVIGATION_BINDINGS,
  ...(
    [
      { id: 'app.themeToggle', action: { kind: 'themeToggle' as const } },
      { id: 'app.switchSite', action: { kind: 'switchSite' as const } },
      { id: 'app.logout', action: { kind: 'logoutConfirm' as const } },
    ] as const
  ).flatMap(binding => {
    const definition = getShortcutById(binding.id);
    return definition ? [{ definition, action: binding.action }] : [];
  }),
];

/**
 * The sheet chord, matched by hand instead of `matchesShortcut`:
 * Spanish layouts type '/' as Shift+7 (and some as AltGr chords), so
 * the match tolerates Shift and accepts the '?' sibling — a strict
 * 'Alt+/' would leave the discovery surface unreachable on the
 * product's primary market.
 */
function matchesSheetChord(event: KeyboardEvent): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.key === '/' || event.key === '?') return true;
  return event.code === 'Slash';
}

export function GlobalShortcutsProvider() {
  const { t } = useTranslation('shortcuts');
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated, user, logout } = useAuth();
  const { currentSite, sites, switchSite } = useTenant();
  const { resolvedTheme, setPreference } = useTheme();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);

  const cycleSite = useCallback(async () => {
    const active = sites.filter(site => site.isActive !== false);
    if (active.length < 2) return;
    const index = active.findIndex(site => site.id === currentSite?.id);
    // findIndex misses (-1) wrap to the first active site.
    const next = active[(index + 1) % active.length]!;
    await switchSite(next.id);
    toast.success({ title: t('app.switchSite.toast', { site: next.name }) });
  }, [sites, currentSite, switchSite, toast, t]);

  // The listener subscribes once per auth session and reads the
  // freshest values through this ref — re-subscribing on every theme
  // flip or sites refetch is listener churn the long-shift soak
  // budget polices.
  const latest = useRef({ navigate, resolvedTheme, setPreference, cycleSite, role: user?.role });
  useEffect(() => {
    latest.current = { navigate, resolvedTheme, setPreference, cycleSite, role: user?.role };
  });

  useEffect(() => {
    if (!isAuthenticated) return;

    const handler = (event: KeyboardEvent) => {
      // Every combo here carries Alt; bail before any other work.
      if (!event.altKey) return;

      if (matchesSheetChord(event)) {
        // Closing is allowed from anywhere (the sheet is on top);
        // OPENING respects the same guards as every other action so
        // the sheet never stacks on the payment modal or fires while
        // the operator is typing.
        if (isSheetOpen) {
          event.preventDefault();
          setIsSheetOpen(false);
          return;
        }
        if (isEditableShortcutTarget(event.target) || hasOpenModalDialog()) return;
        event.preventDefault();
        setIsSheetOpen(true);
        return;
      }

      if (isEditableShortcutTarget(event.target)) return;

      const { role } = latest.current;
      const binding = GLOBAL_BINDINGS.find(candidate => {
        if (
          candidate.definition.roles &&
          (role === undefined || !candidate.definition.roles.includes(role))
        ) {
          return false;
        }
        return matchesShortcut(event, candidate.definition);
      });
      if (!binding) return;

      // Matched — now (and only now) pay for the DOM query. Any open
      // modal owns the keyboard; identical policy to the palette.
      if (hasOpenModalDialog()) return;

      event.preventDefault();
      const current = latest.current;
      switch (binding.action.kind) {
        case 'navigate':
          current.navigate(binding.action.path);
          return;
        case 'themeToggle':
          void current.setPreference(current.resolvedTheme === 'dark' ? 'light' : 'dark');
          return;
        case 'switchSite':
          void current.cycleSite();
          return;
        case 'logoutConfirm':
          setIsLogoutConfirmOpen(true);
          return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isAuthenticated, isSheetOpen]);

  return (
    <Suspense fallback={null}>
      {isSheetOpen && (
        <ShortcutsSheetModal
          role={user?.role as UserRole | undefined}
          onClose={() => setIsSheetOpen(false)}
        />
      )}
      {isLogoutConfirmOpen && (
        <LogoutConfirmModal
          onConfirm={() => {
            setIsLogoutConfirmOpen(false);
            void logout();
          }}
          onClose={() => setIsLogoutConfirmOpen(false)}
        />
      )}
    </Suspense>
  );
}
