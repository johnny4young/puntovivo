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
  /** Operator-provided label ("Mesa 5") inherited from the server row. */
  label: string | null;
  createdAt: string;
}

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
  /** Replace the items of a workspace. */
  updateCart(id: string, items: SaleCartItem[]): void;
  /** Record the keyboard-selected row inside a workspace. */
  setSelectedItem(id: string, itemKey: string | null): void;
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
const PERSIST_VERSION = 1;

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
          label: null,
          createdAt: new Date().toISOString(),
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
          return {
            ...state,
            workspaces: {
              ...state.workspaces,
              [id]: { ...existing, items },
            },
          };
        });
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

      hydrateFromResumed({ ownerKey, serverSaleId, serverSaleNumber, label, items }) {
        const id = generateId();
        const workspace: CartWorkspace = {
          id,
          ownerKey,
          items,
          selectedItemKey: null,
          serverSaleId,
          serverSaleNumber,
          label,
          createdAt: new Date().toISOString(),
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
