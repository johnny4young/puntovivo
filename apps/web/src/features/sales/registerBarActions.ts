/** Register actions the command bar lists after `/`, in the order the bar shows them. */
const REGISTER_BAR_ACTIONS = [
  { id: 'suspend', shortcutId: 'sales.suspend' },
  { id: 'returns' },
  { id: 'newSale', shortcutId: 'sales.newSale' },
  { id: 'openDrawer' },
  { id: 'suspended', shortcutId: 'sales.toggleSuspended' },
  { id: 'charge', shortcutId: 'sales.charge' },
  { id: 'fastCash', shortcutId: 'sales.fastCash' },
  { id: 'undo', shortcutId: 'sales.undo' },
  { id: 'catalog', shortcutId: 'sales.productSearch' },
  { id: 'cashMovement', shortcutId: 'sales.cashMovement' },
  { id: 'openCashSession', shortcutId: 'sales.openCashSession' },
  { id: 'closeCashSession', shortcutId: 'sales.closeCashSession' },
] as const satisfies ReadonlyArray<{ id: string; shortcutId?: string }>;

export type RegisterBarActionId = (typeof REGISTER_BAR_ACTIONS)[number]['id'];

export interface RegisterBarAction {
  id: RegisterBarActionId;
  /** Key under `sales:commandBar.actions`. */
  labelKey: `commandBar.actions.${RegisterBarActionId}`;
  shortcutId: string | null;
  run: () => void;
}

/** A missing handler means the action is not available right now, so it is not listed. */
export type RegisterBarHandlers = Partial<Record<RegisterBarActionId, (() => void) | undefined>>;

export function buildRegisterBarActions(handlers: RegisterBarHandlers): RegisterBarAction[] {
  return REGISTER_BAR_ACTIONS.flatMap(definition => {
    const run = handlers[definition.id];
    if (!run) return [];
    return [
      {
        id: definition.id,
        labelKey: `commandBar.actions.${definition.id}` as const,
        shortcutId: 'shortcutId' in definition ? definition.shortcutId : null,
        run,
      },
    ];
  });
}
