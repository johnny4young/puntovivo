/**
 * ENG-018b — Multi-cart workspace store for the sales screen.
 *
 * One cashier can keep several carts in flight at the same time. A cart
 * is called a "workspace" inside the store so we do not collide with
 * the existing `SalesCartWorkspace.tsx` layout component. Each
 * workspace holds its own line items + currently selected row, and
 * carries the server-side id when it was hydrated from a resumed
 * draft.
 *
 * Persistence:
 * - Backed by `zustand/middleware/persist` against `localStorage`.
 * - The storage key is static (`cart-workspace-store`) but each
 *   workspace carries an `ownerKey` (`${tenantId}:${userId}`). The UI
 *   selects workspaces by the current owner so two cashiers signing
 *   into the same machine never see each other's drafts.
 * - `AuthProvider.logout()` clears auth localStorage; we mirror that
 *   cleanup via `resetAllWorkspaces()` so the store does not retain a
 *   signed-out user's carts.
 *
 * Locked items on resume:
 * - When a workspace has a non-null `serverSaleId`, the cart was
 *   hydrated from a server-side draft via `sales.resume`. Charging
 *   that workspace must call `sales.completeDraft({ saleId: serverSaleId })`
 *   (items locked — ENG-018c contract). The UI uses the `isResumed`
 *   derived flag to disable item edits and show a "Draft resumed"
 *   banner on top of the cart.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SaleCartItem } from './saleCart';

/** One cart kept in flight. */
export interface CartWorkspace {
  /** Local UUID — stable for the lifetime of the workspace. */
  id: string;
  /** `${tenantId}:${userId}` — filters workspaces per signed-in cashier. */
  ownerKey: string;
  items: SaleCartItem[];
  /** Currently highlighted cart row for keyboard-driven actions. */
  selectedItemKey: string | null;
  /**
   * Non-null when this workspace was hydrated from a resumed server
   * draft. Charging the workspace must call `sales.completeDraft`
   * with this id; local edits to items are disabled in the UI.
   */
  serverSaleId: string | null;
  /** Sale number of the resumed draft, rendered in the resumed banner. */
  serverSaleNumber: string | null;
  /** Customer frozen on the resumed draft; used by checkout authorization. */
  serverCustomerId: string | null;
  /** Operator-provided label ("Mesa 5") inherited from the server row. */
  label: string | null;
  /** ENG-209 — first real cart interaction; null while the workspace is empty. */
  checkoutStartedAt: string | null;
  createdAt: string;
  /**
   * ENG-105d — per-workspace undo history. Each entry is the
   * `items` snapshot that existed BEFORE an `updateCart` mutation.
   * The most recent change sits at the end of the array, so
   * `pop()` restores the immediately previous state.
   *
   * Cap: {@link HISTORY_CAP}. When the stack exceeds the cap, the
   * oldest entry is evicted (FIFO — `shift()`) so memory stays
   * bounded even if the cashier never undoes.
   *
   * The stack resets to `[]` on `hydrateFromResumed`,
   * `removeWorkspace`, and `resetAllWorkspaces` — undo never
   * crosses the boundary of a hydrated server draft (the
   * "first state" the cashier sees IS the server state) or the
   * boundary of a completed/discarded workspace.
   */
  historyStack: SaleCartItem[][];
}

/**
 * ENG-105d — bound the per-workspace undo stack. 20 reverts is
 * the longest reasonable run before the cashier should restart
 * the cart; bigger stacks burn memory without giving back useful
 * affordance.
 */
export const HISTORY_CAP = 20;

interface CartWorkspaceState {
  workspaces: Record<string, CartWorkspace>;
  /** `null` when no workspace is active (empty workspace panel, e.g. right after "Charge"). */
  activeId: string | null;
}

interface CartWorkspaceActions {
  /**
   * Create a fresh empty workspace owned by `ownerKey`, set it active,
   * and return the new id.
   */
  createDraft(ownerKey: string): string;
  /** Swap the active workspace. Accepts `null` to leave the panel empty. */
  setActive(id: string | null): void;
  /**
   * Replace the items of a workspace.
   *
   * ENG-105d — the current `items` array is pushed onto the
   * workspace's `historyStack` BEFORE the mutation lands (capped
   * via FIFO eviction at {@link HISTORY_CAP}). When the new array
   * is referentially identical to the previous one, the push is
   * skipped so no-op writes never inflate the stack.
   */
  updateCart(id: string, items: SaleCartItem[]): void;
  /** Record the keyboard-selected row inside a workspace. */
  setSelectedItem(id: string, itemKey: string | null): void;
  /**
   * ENG-105d — pop the last entry off the workspace's undo
   * history and reinstate it as the workspace's `items`.
   *
   * Returns `true` when an entry was actually popped, `false`
   * when the stack was empty (caller surfaces a "nothing to
   * undo" toast on the false branch). Does NOT push the
   * currently-replaced `items` onto a redo stack — redo is out
   * of scope for v1.
   */
  undoCart(id: string): boolean;
  /**
   * Drop a workspace entirely (e.g. after the server acknowledged the
   * suspend / complete / discard). If the removed workspace was
   * active, `activeId` becomes `null`.
   */
  removeWorkspace(id: string): void;
  /**
   * Hydrate a new workspace from a resumed server draft. Takes the
   * response shape of `sales.resume` (mapped) and returns the new
   * workspace id. Sets it active.
   */
  hydrateFromResumed(args: {
    ownerKey: string;
    serverSaleId: string;
    serverSaleNumber: string;
    serverCustomerId: string | null;
    label: string | null;
    items: SaleCartItem[];
  }): string;
  /**
   * Purge every workspace from memory + storage. Called on logout so
   * the next user never sees the previous cashier's carts.
   */
  resetAllWorkspaces(): void;
}

type CartWorkspaceStore = CartWorkspaceState & CartWorkspaceActions;

const PERSIST_KEY = 'cart-workspace-store';
// ENG-105d — bump to 2 to add `historyStack`. The migration below
// backfills missing stacks to `[]` so previously-persisted
// workspaces hydrate cleanly without surfacing a runtime error
// for cashiers who upgrade mid-shift.
const PERSIST_VERSION = 4;

// Monotonic suffix so synchronous bursts of `createDraft` calls never
// collide in environments where `crypto.randomUUID` is missing or
// where `Math.random` is deterministic per the test harness. Even
// with randomUUID available the counter is cheap insurance.
let generateIdCounter = 0;
function generateId(): string {
  generateIdCounter += 1;
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `ws-${uuid}-${generateIdCounter}`;
}

/**
 * ENG-105d — bound the per-workspace undo stack. Returns a NEW
 * array (never mutates the input) so React subscribers always see a
 * fresh reference. When the input is already within `HISTORY_CAP`
 * the function returns it unchanged for cheap referential equality.
 */
function trimHistory(stack: SaleCartItem[][]): SaleCartItem[][] {
  if (stack.length <= HISTORY_CAP) return stack;
  return stack.slice(stack.length - HISTORY_CAP);
}

export const useCartWorkspaceStore = create<CartWorkspaceStore>()(
  persist(
    (set, get) => ({
      workspaces: {},
      activeId: null,

      createDraft(ownerKey) {
        const id = generateId();
        const workspace: CartWorkspace = {
          id,
          ownerKey,
          items: [],
          selectedItemKey: null,
          serverSaleId: null,
          serverSaleNumber: null,
          serverCustomerId: null,
          label: null,
          checkoutStartedAt: null,
          createdAt: new Date().toISOString(),
          historyStack: [],
        };
        set(state => ({
          workspaces: { ...state.workspaces, [id]: workspace },
          activeId: id,
        }));
        return id;
      },

      setActive(id) {
        if (id !== null && !get().workspaces[id]) {
          // Be strict — setting active to a missing id is a bug in the
          // caller that would leave the UI in an inconsistent state.
          return;
        }
        set({ activeId: id });
      },

      updateCart(id, items) {
        set(state => {
          const existing = state.workspaces[id];
          if (!existing) {
            return state;
          }
          // ENG-105d — only record the previous snapshot when the
          // mutation is a genuine change. Referential identity is
          // enough — every cart mutation flows through helpers
          // (`mergeCartItem`, `updateCartItem`, `filter`) that
          // return a brand-new array on a real change.
          const isRealChange = items !== existing.items;
          const nextStack = isRealChange
            ? trimHistory([...existing.historyStack, existing.items])
            : existing.historyStack;
          const checkoutStartedAt = !isRealChange
            ? (existing.checkoutStartedAt ?? null)
            : items.length === 0
              ? null
              : (existing.checkoutStartedAt ?? new Date().toISOString());
          return {
            ...state,
            workspaces: {
              ...state.workspaces,
              [id]: { ...existing, items, checkoutStartedAt, historyStack: nextStack },
            },
          };
        });
      },

      undoCart(id) {
        const existing = get().workspaces[id];
        if (!existing || existing.historyStack.length === 0) {
          return false;
        }
        const nextStack = existing.historyStack.slice(0, -1);
        const restored = existing.historyStack[existing.historyStack.length - 1]!;
        const checkoutStartedAt =
          restored.length === 0
            ? null
            : (existing.checkoutStartedAt ?? new Date().toISOString());
        set(state => ({
          ...state,
          workspaces: {
            ...state.workspaces,
            [id]: { ...existing, items: restored, checkoutStartedAt, historyStack: nextStack },
          },
        }));
        return true;
      },

      setSelectedItem(id, itemKey) {
        set(state => {
          const existing = state.workspaces[id];
          if (!existing) {
            return state;
          }
          return {
            ...state,
            workspaces: {
              ...state.workspaces,
              [id]: { ...existing, selectedItemKey: itemKey },
            },
          };
        });
      },

      removeWorkspace(id) {
        set(state => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [id]: _removed, ...rest } = state.workspaces;
          return {
            workspaces: rest,
            activeId: state.activeId === id ? null : state.activeId,
          };
        });
      },

      hydrateFromResumed({
        ownerKey,
        serverSaleId,
        serverSaleNumber,
        serverCustomerId,
        label,
        items,
      }) {
        const id = generateId();
        const workspace: CartWorkspace = {
          id,
          ownerKey,
          items,
          selectedItemKey: null,
          serverSaleId,
          serverSaleNumber,
          serverCustomerId,
          label,
          checkoutStartedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          // ENG-105d — resumed drafts arrive with the server state as
          // their "first state". The cashier should NOT be able to
          // undo past that baseline (it would delete persisted lines
          // out of the UI without touching the server row).
          historyStack: [],
        };
        set(state => ({
          workspaces: { ...state.workspaces, [id]: workspace },
          activeId: id,
        }));
        return id;
      },

      resetAllWorkspaces() {
        set({ workspaces: {}, activeId: null });
      },
    }),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      // ENG-105d — persist only serializable workspace state. Store
      // actions stay runtime-only, and future transient flags cannot
      // accidentally bloat localStorage.
      //
      // `historyStack` is deliberately persisted EMPTY: undo is a
      // session-level affordance (a rehydrated cart starts with no undo
      // baseline, same as a resumed draft), and persisting it made every
      // cart keystroke serialize up to HISTORY_CAP full item-array
      // snapshots per workspace into localStorage — a synchronous
      // multi-hundred-KB write on the hottest input path.
      partialize: state => ({
        workspaces: Object.fromEntries(
          Object.entries(state.workspaces).map(([id, workspace]) => [
            id,
            { ...workspace, historyStack: [] },
          ])
        ),
        activeId: state.activeId,
      }),
      // ENG-105d / ENG-209 — migrate old persisted workspaces by
      // backfilling runtime-safe history and an unmeasured checkout clock.
      // Existing non-empty carts intentionally stay null until their next
      // cart interaction rather than fabricating a start from createdAt.
      migrate: (persisted, fromVersion) => {
        if (fromVersion < PERSIST_VERSION && persisted && typeof persisted === 'object') {
          const cast = persisted as Partial<CartWorkspaceState>;
          const workspaces = cast.workspaces ?? {};
          const next: Record<string, CartWorkspace> = {};
          for (const [id, workspace] of Object.entries(workspaces)) {
            next[id] = {
              ...workspace,
              historyStack: workspace.historyStack ?? [],
              checkoutStartedAt: workspace.checkoutStartedAt ?? null,
              serverCustomerId: workspace.serverCustomerId ?? null,
            };
          }
          return { ...cast, workspaces: next } as CartWorkspaceState;
        }
        return persisted as CartWorkspaceState;
      },
    }
  )
);

// =============================================================================
// Selectors — used by components so we can render from primitives instead of
// subscribing to the whole state object.
// =============================================================================

/** The single active workspace, or `null` if the panel is empty. */
export function selectActiveWorkspace(
  state: CartWorkspaceStore
): CartWorkspace | null {
  if (!state.activeId) {
    return null;
  }
  return state.workspaces[state.activeId] ?? null;
}

/**
 * Every workspace owned by the signed-in user, ordered by createdAt
 * desc so the most recent draft renders at the top of the panel.
 */
export function selectOwnedWorkspaces(
  state: CartWorkspaceStore,
  ownerKey: string
): CartWorkspace[] {
  return Object.values(state.workspaces)
    .filter(workspace => workspace.ownerKey === ownerKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * `true` when the active workspace was hydrated from a resumed
 * server-side draft. Drives the "items locked" UX on SalesPage.
 */
export function selectActiveIsResumed(state: CartWorkspaceStore): boolean {
  const active = selectActiveWorkspace(state);
  return active?.serverSaleId != null;
}

/**
 * ENG-105d — depth of the undo stack on the active workspace.
 * Returns `0` when no workspace is active or the stack is empty.
 * Consumed by `SaleCartTable` / `SalesCartWorkspace` to drive the
 * disabled state of the "Deshacer" button without forcing a
 * subscription to the whole workspace object.
 */
export function selectActiveUndoDepth(state: CartWorkspaceStore): number {
  const active = selectActiveWorkspace(state);
  return active?.historyStack.length ?? 0;
}
