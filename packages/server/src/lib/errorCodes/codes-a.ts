/**
 * Server error-code registry — part A (ENG-178 split).
 *
 * Domains auth … fiscal (CO). Merged with part B in `registry.ts`. The keys
 * equal their string values; the union drives `ServerErrorCode`. Markers are
 * preserved inline. Leaf module.
 *
 * @module lib/errorCodes/codes-a
 */
export const SERVER_ERROR_CODES_A = {
  // --- auth domain ---
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_USER_DISABLED: 'AUTH_USER_DISABLED',
  AUTH_TENANT_DISABLED: 'AUTH_TENANT_DISABLED',
  AUTH_REFRESH_INVALID: 'AUTH_REFRESH_INVALID',
  AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  AUTH_CURRENT_PASSWORD_INCORRECT: 'AUTH_CURRENT_PASSWORD_INCORRECT',
  AUTH_PASSWORD_POLICY: 'AUTH_PASSWORD_POLICY',
  /**
   * ENG-008 — the `auth.login` procedure refused the attempt because the
   * per-IP or per-username rate-limit bucket is saturated. `details` carries
   * `{ kind: 'ip' | 'username', key, max, secondsUntilReset }` so the
   * frontend can render a precise retry-after message.
   */
  AUTH_RATE_LIMIT_EXCEEDED: 'AUTH_RATE_LIMIT_EXCEEDED',
  /** ENG-106a — the six-digit staff PIN did not match. */
  AUTH_STAFF_PIN_INVALID: 'AUTH_STAFF_PIN_INVALID',

  // --- employee shifts domain (ENG-106b) ---
  EMPLOYEE_SHIFT_ALREADY_CLOCKED_IN: 'EMPLOYEE_SHIFT_ALREADY_CLOCKED_IN',
  EMPLOYEE_SHIFT_NOT_CLOCKED_IN: 'EMPLOYEE_SHIFT_NOT_CLOCKED_IN',
  EMPLOYEE_SHIFT_SITE_INACTIVE: 'EMPLOYEE_SHIFT_SITE_INACTIVE',
  EMPLOYEE_SHIFT_PERSIST_FAILED: 'EMPLOYEE_SHIFT_PERSIST_FAILED',
  // ENG-140d — labor/cash lifecycle integration.
  EMPLOYEE_SHIFT_CASH_SESSION_OPEN: 'EMPLOYEE_SHIFT_CASH_SESSION_OPEN',
  // --- attendance breaks domain (ENG-140b) ---
  EMPLOYEE_SHIFT_BREAK_ALREADY_ACTIVE: 'EMPLOYEE_SHIFT_BREAK_ALREADY_ACTIVE',
  EMPLOYEE_SHIFT_BREAK_NOT_ACTIVE: 'EMPLOYEE_SHIFT_BREAK_NOT_ACTIVE',
  EMPLOYEE_SHIFT_BREAK_ACTIVE: 'EMPLOYEE_SHIFT_BREAK_ACTIVE',
  EMPLOYEE_SHIFT_BREAK_PERSIST_FAILED: 'EMPLOYEE_SHIFT_BREAK_PERSIST_FAILED',
  EMPLOYEE_SHIFT_ATTENDANCE_RANGE_INVALID: 'EMPLOYEE_SHIFT_ATTENDANCE_RANGE_INVALID',
  EMPLOYEE_SHIFT_ATTENDANCE_EMPLOYEE_NOT_FOUND: 'EMPLOYEE_SHIFT_ATTENDANCE_EMPLOYEE_NOT_FOUND',
  EMPLOYEE_SHIFT_ATTENDANCE_SITE_NOT_FOUND: 'EMPLOYEE_SHIFT_ATTENDANCE_SITE_NOT_FOUND',
  // --- immutable attendance corrections (ENG-140e) ---
  EMPLOYEE_SHIFT_CORRECTION_NOT_FOUND: 'EMPLOYEE_SHIFT_CORRECTION_NOT_FOUND',
  EMPLOYEE_SHIFT_CORRECTION_ACTIVE: 'EMPLOYEE_SHIFT_CORRECTION_ACTIVE',
  EMPLOYEE_SHIFT_CORRECTION_WINDOW_INVALID: 'EMPLOYEE_SHIFT_CORRECTION_WINDOW_INVALID',
  EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID: 'EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID',
  EMPLOYEE_SHIFT_CORRECTION_PERSIST_FAILED: 'EMPLOYEE_SHIFT_CORRECTION_PERSIST_FAILED',

  // --- labor schedule domain (ENG-140a) ---
  SCHEDULE_DATE_RANGE_INVALID: 'SCHEDULE_DATE_RANGE_INVALID',
  SCHEDULE_WINDOW_INVALID: 'SCHEDULE_WINDOW_INVALID',
  SCHEDULE_EMPLOYEE_NOT_FOUND: 'SCHEDULE_EMPLOYEE_NOT_FOUND',
  SCHEDULE_SITE_NOT_FOUND: 'SCHEDULE_SITE_NOT_FOUND',
  SCHEDULE_SHIFT_NOT_FOUND: 'SCHEDULE_SHIFT_NOT_FOUND',
  SCHEDULE_SHIFT_OVERLAP: 'SCHEDULE_SHIFT_OVERLAP',
  SCHEDULE_SHIFT_CANCELLED: 'SCHEDULE_SHIFT_CANCELLED',

  // --- manager approval rail (ENG-106c1) ---
  MANAGER_APPROVAL_NOT_FOUND: 'MANAGER_APPROVAL_NOT_FOUND',
  MANAGER_APPROVAL_NOT_PENDING: 'MANAGER_APPROVAL_NOT_PENDING',
  MANAGER_APPROVAL_EXPIRED: 'MANAGER_APPROVAL_EXPIRED',
  MANAGER_APPROVAL_PIN_INVALID: 'MANAGER_APPROVAL_PIN_INVALID',
  MANAGER_APPROVAL_SITE_REQUIRED: 'MANAGER_APPROVAL_SITE_REQUIRED',
  MANAGER_APPROVAL_REQUIRED: 'MANAGER_APPROVAL_REQUIRED',
  MANAGER_APPROVAL_MISMATCH: 'MANAGER_APPROVAL_MISMATCH',
  MANAGER_APPROVAL_UNAVAILABLE: 'MANAGER_APPROVAL_UNAVAILABLE',
  // --- deterministic loss-prevention alerts (ENG-142d) ---
  LOSS_PREVENTION_ALERT_NOT_FOUND: 'LOSS_PREVENTION_ALERT_NOT_FOUND',

  // --- cash sessions domain (Phase 1 DB-051 / API-051 / API-055) ---
  CASH_SESSION_REQUIRED: 'CASH_SESSION_REQUIRED',
  CASH_SESSION_SITE_REQUIRED: 'CASH_SESSION_SITE_REQUIRED',
  CASH_SESSION_ALREADY_OPEN_FOR_CASHIER: 'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER',
  CASH_SESSION_ALREADY_OPEN_FOR_REGISTER: 'CASH_SESSION_ALREADY_OPEN_FOR_REGISTER',
  CASH_SESSION_SHIFT_SITE_MISMATCH: 'CASH_SESSION_SHIFT_SITE_MISMATCH',
  CASH_SESSION_EMPLOYEE_BREAK_ACTIVE: 'CASH_SESSION_EMPLOYEE_BREAK_ACTIVE',
  CASH_SESSION_OPENING_FLOAT_MISMATCH: 'CASH_SESSION_OPENING_FLOAT_MISMATCH',
  CASH_SESSION_OPENING_FLOAT_INVALID: 'CASH_SESSION_OPENING_FLOAT_INVALID',
  CASH_SESSION_COUNT_MISMATCH: 'CASH_SESSION_COUNT_MISMATCH',
  CASH_SESSION_COUNT_INVALID: 'CASH_SESSION_COUNT_INVALID',
  /**
   * ENG-198 — `cashSessions.dayCloseSummary` was asked for a session id that
   * does not exist under the caller's tenant, or belongs to another cashier
   * when the caller is not privileged (both probes are indistinguishable by
   * design). `details` carries `{ sessionId }`.
   */
  CASH_SESSION_NOT_FOUND: 'CASH_SESSION_NOT_FOUND',
  /**
   * ENG-198 — the day-close summary only exists for a closed session; the
   * ritual fires from the close mutation's success path, so hitting this
   * means a stale/forged session id. `details` carries `{ sessionId }`.
   */
  CASH_SESSION_NOT_CLOSED: 'CASH_SESSION_NOT_CLOSED',
  /**
   * ENG-181 — defensive load failure right after creating / closing a
   * cash session. Should never reach a happy-path UI; surfaces if the
   * SELECT-after-INSERT pattern is broken (DB closed, replication lag,
   * etc.). `details` carries
   * `{ tenantId, sessionId, operation: 'open' | 'close' }`.
   */
  CASH_SESSION_LOAD_FAILED: 'CASH_SESSION_LOAD_FAILED',
  /**
   * ENG-141a — a manager requested a comprehensive day-close preview for a
   * tenant-local calendar day that has not started yet.
   */
  DAY_CLOSE_FUTURE_DATE: 'DAY_CLOSE_FUTURE_DATE',
  /** ENG-141b — the tenant business date already has immutable signed evidence. */
  DAY_CLOSE_ALREADY_SIGNED: 'DAY_CLOSE_ALREADY_SIGNED',
  /** ENG-141b — a report with readiness blockers cannot be attested. */
  DAY_CLOSE_NOT_READY: 'DAY_CLOSE_NOT_READY',
  /** ENG-141b — the persisted snapshot no longer matches its canonical hash or schema. */
  DAY_CLOSE_SIGNOFF_INTEGRITY_FAILED: 'DAY_CLOSE_SIGNOFF_INTEGRITY_FAILED',
  /**
   * ENG-181 — `services/cash-session.ts:insertCashMovement` rejected a
   * non-positive / non-finite amount. ENG-176a-rounding already rounds
   * at the boundary; this code surfaces if a future caller bypasses
   * `roundMoney()` and feeds a sub-cent or negative value. `details`
   * carries `{ amount }`.
   */
  CASH_MOVEMENT_INVALID_AMOUNT: 'CASH_MOVEMENT_INVALID_AMOUNT',
  /**
   * ENG-181 — unknown / unhandled `cash_movements.type` reached
   * `getCashMovementSignedAmount`. Indicates a schema enum value the
   * helper has not been taught about. `details` carries `{ type }`.
   */
  CASH_MOVEMENT_UNSUPPORTED_TYPE: 'CASH_MOVEMENT_UNSUPPORTED_TYPE',
  /**
   * ENG-181 — defensive guard on the SELECT-after-INSERT pattern in
   * `application/cash-sessions/recordCashMovement.ts`. Surfaces when
   * the freshly inserted cash movement row cannot be re-read; almost
   * always points to an underlying DB / FK issue. `details` carries
   * `{ tenantId, sessionId, type, amount, stage: 'insert' | 'post-tx' | 'reload', movementId? }`
   * — `stage` discriminates the three guard sites (in-transaction
   * insert, post-tx null-id check, post-tx reload-row check).
   */
  CASH_MOVEMENT_PERSIST_FAILED: 'CASH_MOVEMENT_PERSIST_FAILED',

  // --- fraction policy domain (Phase 1 DB-050) ---
  /** Admin config: sellByFraction=true but fractionStep is missing / ≤ 0. */
  PRODUCT_FRACTION_STEP_REQUIRED: 'PRODUCT_FRACTION_STEP_REQUIRED',
  /** Admin config: sellByFraction=true but fractionMinimum is missing / ≤ 0. */
  PRODUCT_FRACTION_MINIMUM_REQUIRED: 'PRODUCT_FRACTION_MINIMUM_REQUIRED',
  /** Admin config: fractionMinimum < fractionStep. */
  PRODUCT_FRACTION_MINIMUM_BELOW_STEP: 'PRODUCT_FRACTION_MINIMUM_BELOW_STEP',
  /** Admin config: fractionMinimum is not a multiple of fractionStep. */
  PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED: 'PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED',
  /** ENG-110a: enabling lot tracking would orphan existing/opening stock. */
  PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK: 'PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK',
  /** ENG-110a: a direct stock edit would bypass lot and FEFO evidence. */
  PRODUCT_LOT_TRACKING_STOCK_MANAGED: 'PRODUCT_LOT_TRACKING_STOCK_MANAGED',
  /** ENG-110a: a lot receipt targeted a product without lot tracking enabled. */
  PRODUCT_LOT_TRACKING_REQUIRED: 'PRODUCT_LOT_TRACKING_REQUIRED',
  /** ENG-110a: disabling lot tracking would strand non-zero lot inventory. */
  PRODUCT_LOT_TRACKING_HAS_ACTIVE_LOTS: 'PRODUCT_LOT_TRACKING_HAS_ACTIVE_LOTS',
  PRODUCT_SERIAL_TRACKING_REQUIRES_ZERO_STOCK: 'PRODUCT_SERIAL_TRACKING_REQUIRES_ZERO_STOCK',
  PRODUCT_SERIAL_TRACKING_STOCK_MANAGED: 'PRODUCT_SERIAL_TRACKING_STOCK_MANAGED',
  PRODUCT_SERIAL_TRACKING_REQUIRED: 'PRODUCT_SERIAL_TRACKING_REQUIRED',
  PRODUCT_SERIAL_TRACKING_HAS_SERIALS: 'PRODUCT_SERIAL_TRACKING_HAS_SERIALS',
  PRODUCT_SERIAL_TRACKING_CONFLICT: 'PRODUCT_SERIAL_TRACKING_CONFLICT',
  PRODUCT_SERIAL_UNIT_EQUIVALENCE_REQUIRED: 'PRODUCT_SERIAL_UNIT_EQUIVALENCE_REQUIRED',
  PRODUCT_SERIAL_PRODUCT_NOT_FOUND: 'PRODUCT_SERIAL_PRODUCT_NOT_FOUND',
  PRODUCT_SERIAL_DUPLICATE: 'PRODUCT_SERIAL_DUPLICATE',
  PRODUCT_SERIAL_QUANTITY_WHOLE_REQUIRED: 'PRODUCT_SERIAL_QUANTITY_WHOLE_REQUIRED',
  PRODUCT_SERIAL_SELECTION_REQUIRED: 'PRODUCT_SERIAL_SELECTION_REQUIRED',
  PRODUCT_SERIAL_UNAVAILABLE: 'PRODUCT_SERIAL_UNAVAILABLE',
  PRODUCT_SERIAL_SALE_STATUS_INVALID: 'PRODUCT_SERIAL_SALE_STATUS_INVALID',
  PRODUCT_SERIAL_SELECTION_NOT_ALLOWED: 'PRODUCT_SERIAL_SELECTION_NOT_ALLOWED',
  /** ENG-110c: per-unit identities cannot be moved onto matrix children implicitly. */
  PRODUCT_SERIAL_VARIANT_PARENT_UNSUPPORTED: 'PRODUCT_SERIAL_VARIANT_PARENT_UNSUPPORTED',
  /** ENG-110b: only a zero-stock standard product can become a matrix parent. */
  PRODUCT_VARIANT_PARENT_REQUIRES_ZERO_STOCK: 'PRODUCT_VARIANT_PARENT_REQUIRES_ZERO_STOCK',
  /** ENG-110b: the selected matrix source no longer exists for this tenant. */
  PRODUCT_VARIANT_PARENT_NOT_FOUND: 'PRODUCT_VARIANT_PARENT_NOT_FOUND',
  /** ENG-110b: later document reversals/receipts could restock the matrix parent. */
  PRODUCT_VARIANT_PARENT_HAS_HISTORY: 'PRODUCT_VARIANT_PARENT_HAS_HISTORY',
  /** ENG-110b: the selected product is already a parent or child in a matrix. */
  PRODUCT_VARIANT_MATRIX_EXISTS: 'PRODUCT_VARIANT_MATRIX_EXISTS',
  /** ENG-110b: generated child SKUs collide with tenant catalog rows. */
  PRODUCT_VARIANT_SKU_CONFLICT: 'PRODUCT_VARIANT_SKU_CONFLICT',
  /** ENG-110b: a matrix parent is catalog metadata, never a sellable stock item. */
  PRODUCT_VARIANT_PARENT_NOT_SELLABLE: 'PRODUCT_VARIANT_PARENT_NOT_SELLABLE',
  /** Sale path: quantity must be a whole number for this product. */
  SALE_QUANTITY_NOT_WHOLE: 'SALE_QUANTITY_NOT_WHOLE',
  /** Sale path: quantity is below the configured minimum. */
  SALE_QUANTITY_BELOW_MINIMUM: 'SALE_QUANTITY_BELOW_MINIMUM',
  /** Sale path: quantity does not match the configured step. */
  SALE_QUANTITY_NOT_ALIGNED: 'SALE_QUANTITY_NOT_ALIGNED',
  /** Sale path: sellByFraction=true but the policy columns are null. */
  SALE_FRACTION_POLICY_MISSING: 'SALE_FRACTION_POLICY_MISSING',
  /** Sale path: quantity is zero / negative / non-finite. */
  SALE_QUANTITY_INVALID: 'SALE_QUANTITY_INVALID',
  /** Split-payment input: Σ(payments.amount) does not match the sale total. */
  SALE_PAYMENTS_SUM_MISMATCH: 'SALE_PAYMENTS_SUM_MISMATCH',

  // --- inventory transfers domain (Phase 2 DB-102 / API-102) ---
  TRANSFER_SITES_IDENTICAL: 'TRANSFER_SITES_IDENTICAL',
  TRANSFER_SITE_NOT_FOUND: 'TRANSFER_SITE_NOT_FOUND',
  TRANSFER_PRODUCT_NOT_FOUND: 'TRANSFER_PRODUCT_NOT_FOUND',
  TRANSFER_QUANTITY_INVALID: 'TRANSFER_QUANTITY_INVALID',
  TRANSFER_ITEMS_REQUIRED: 'TRANSFER_ITEMS_REQUIRED',
  TRANSFER_INSUFFICIENT_STOCK: 'TRANSFER_INSUFFICIENT_STOCK',
  /** Void target: transfer id does not exist for the current tenant. */
  TRANSFER_NOT_FOUND: 'TRANSFER_NOT_FOUND',
  /** Void target is already in the `void` status — double-void is rejected. */
  TRANSFER_ALREADY_VOID: 'TRANSFER_ALREADY_VOID',
  /**
   * Void reversal would drive the destination site's on-hand below zero,
   * e.g. because a later sale already consumed the transferred stock.
   */
  TRANSFER_VOID_INSUFFICIENT_STOCK: 'TRANSFER_VOID_INSUFFICIENT_STOCK',
  /** `transfers.receive` called on a transfer whose status is not `in_transit`. */
  TRANSFER_NOT_IN_TRANSIT: 'TRANSFER_NOT_IN_TRANSIT',
  /**
   * Phase 2 UI-103: a `transfers.receive` line reports a received quantity
   * greater than the shipped quantity. Accepting would create stock from
   * nothing — operators should complete the receive at the shipped qty and
   * post a separate stock adjustment if they genuinely received more.
   */
  TRANSFER_RECEIVED_EXCEEDS_SHIPPED: 'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
  /**
   * Phase 2 UI-103: a `transfers.receive` line payload references an item id
   * that does not belong to the target transfer (or is duplicated across
   * entries).
   */
  TRANSFER_RECEIVE_LINE_MISMATCH: 'TRANSFER_RECEIVE_LINE_MISMATCH',

  // --- quotations domain (Phase 5 / Tier-2 #6) ---
  QUOTATION_NOT_FOUND: 'QUOTATION_NOT_FOUND',
  QUOTATION_ITEMS_REQUIRED: 'QUOTATION_ITEMS_REQUIRED',
  QUOTATION_PRODUCT_NOT_FOUND: 'QUOTATION_PRODUCT_NOT_FOUND',
  QUOTATION_CUSTOMER_NOT_FOUND: 'QUOTATION_CUSTOMER_NOT_FOUND',
  QUOTATION_SITE_NOT_FOUND: 'QUOTATION_SITE_NOT_FOUND',
  QUOTATION_QUANTITY_INVALID: 'QUOTATION_QUANTITY_INVALID',
  /**
   * Status transition is not allowed (e.g. moving from `converted` back to
   * `draft`). Source/target status are reported in the error details.
   */
  QUOTATION_INVALID_STATUS_TRANSITION: 'QUOTATION_INVALID_STATUS_TRANSITION',
  /** Only quotations in `draft` may be deleted; everything else is archived. */
  QUOTATION_DELETE_NOT_DRAFT: 'QUOTATION_DELETE_NOT_DRAFT',
  /** No active sequential is configured for the tenant's quotation numbering. */
  QUOTATION_SEQUENTIAL_MISSING: 'QUOTATION_SEQUENTIAL_MISSING',

  // --- receipt templates domain (Iter 2) ---
  RECEIPT_TEMPLATE_NOT_FOUND: 'RECEIPT_TEMPLATE_NOT_FOUND',
  RECEIPT_TEMPLATE_NAME_REQUIRED: 'RECEIPT_TEMPLATE_NAME_REQUIRED',
  /** Tried to delete the only active template for a kind — leave at least one. */
  RECEIPT_TEMPLATE_LAST_FOR_KIND: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
  /** A duplicate's resolved name collides with an existing one for the same kind. */
  RECEIPT_TEMPLATE_NAME_DUPLICATE: 'RECEIPT_TEMPLATE_NAME_DUPLICATE',
  /**
   * ENG-181 — defensive guard on the INSERT-RETURNING / UPDATE-RETURNING
   * pattern in `services/receipt-templates.ts`. Surfaces when a row
   * mutation succeeds but the returned row is missing; almost always
   * points to a tenant-scope mismatch or a transaction abort.
   * `details` carries `{ operation: 'insert' | 'update' | 'setDefault', templateId? }`.
   */
  RECEIPT_TEMPLATE_PERSIST_FAILED: 'RECEIPT_TEMPLATE_PERSIST_FAILED',

  // --- sales domain ---
  // Added during ENG-018 + ENG-019 while sweeping sales.ts for raw
  // TRPCError messages that bypassed the translate-by-errorCode path
  // and leaked English strings into the localized UI.
  /** Sale id does not exist in the current tenant. */
  SALE_NOT_FOUND: 'SALE_NOT_FOUND',
  /** Post-equivalence normalized quantity is zero / negative / non-finite. */
  SALE_QUANTITY_NONPOSITIVE: 'SALE_QUANTITY_NONPOSITIVE',
  /** No active sale sequential is configured for the tenant. */
  SALE_SEQUENTIAL_MISSING: 'SALE_SEQUENTIAL_MISSING',
  /** The selected customer was not found or is inactive. */
  SALE_CUSTOMER_INVALID: 'SALE_CUSTOMER_INVALID',
  /** A line references a product that is missing or inactive; details.productName. */
  SALE_PRODUCT_INVALID: 'SALE_PRODUCT_INVALID',
  /** A line references a unit assignment that is missing or inactive; details.productName. */
  SALE_UNIT_INVALID: 'SALE_UNIT_INVALID',
  /** A line requested more than the available on-hand stock; details: productName, available, requested. */
  SALE_INSUFFICIENT_STOCK: 'SALE_INSUFFICIENT_STOCK',
  /** Lot receipt quantity must be greater than zero. */
  LOT_QUANTITY_INVALID: 'LOT_QUANTITY_INVALID',
  /** Lot unit cost cannot be negative. */
  LOT_COST_INVALID: 'LOT_COST_INVALID',
  /** Lot receipt references a product that does not exist for this tenant. */
  LOT_PRODUCT_NOT_FOUND: 'LOT_PRODUCT_NOT_FOUND',
  /** ENG-199 — the referenced lot does not exist under the caller's tenant
   * (cross-tenant probes land here too). details: { lotId }. */
  LOT_NOT_FOUND: 'LOT_NOT_FOUND',
  /** ENG-199 — the lot cannot receive an expiry-discount suggestion: no
   * expiry date, already expired, depleted, inactive, or outside the tier
   * window. details: { lotId, reason }. */
  LOT_DISCOUNT_NOT_ELIGIBLE: 'LOT_DISCOUNT_NOT_ELIGIBLE',
  /** ENG-199 — the lot already carries an ACTIVE discount suggestion (the
   * partial unique index is the race-safe guard). details: { lotId }. */
  LOT_DISCOUNT_ALREADY_ACTIVE: 'LOT_DISCOUNT_ALREADY_ACTIVE',
  /** ENG-199 — dismiss targeted a suggestion id that does not exist (or is
   * not active) under the caller's tenant. details: { suggestionId }. */
  PRICE_SUGGESTION_NOT_FOUND: 'PRICE_SUGGESTION_NOT_FOUND',
  /** ENG-213 — a loyalty operation targeted a customer that does not exist
   * under the caller's tenant. details: { customerId }. */
  LOYALTY_CUSTOMER_NOT_FOUND: 'LOYALTY_CUSTOMER_NOT_FOUND',
  /** ENG-213 — a negative adjustment would leave the balance below zero.
   * details: { customerId, balance, points }. */
  LOYALTY_INSUFFICIENT_POINTS: 'LOYALTY_INSUFFICIENT_POINTS',
  /** Applied discount amount exceeds the computed sale total. */
  SALE_DISCOUNT_EXCEEDS_TOTAL: 'SALE_DISCOUNT_EXCEEDS_TOTAL',
  /** Amount received is below the sale total when the payment status is paid. */
  SALE_AMOUNT_RECEIVED_BELOW_TOTAL: 'SALE_AMOUNT_RECEIVED_BELOW_TOTAL',
  /** Update rejected because the sale is already voided. */
  SALE_UPDATE_VOIDED_FORBIDDEN: 'SALE_UPDATE_VOIDED_FORBIDDEN',
  /** Void: the target is already voided. */
  SALE_VOID_ALREADY_VOIDED: 'SALE_VOID_ALREADY_VOIDED',
  /** Void: the target is already refunded (refund and void are mutually exclusive). */
  SALE_VOID_REFUNDED_FORBIDDEN: 'SALE_VOID_REFUNDED_FORBIDDEN',
  /** Void: only completed sales can be voided. */
  SALE_VOID_NOT_COMPLETED: 'SALE_VOID_NOT_COMPLETED',
  /** Void/return: the sale has zero line items. */
  SALE_WITHOUT_ITEMS: 'SALE_WITHOUT_ITEMS',
  /** Return: voided sales cannot be refunded. */
  SALE_RETURN_VOIDED_FORBIDDEN: 'SALE_RETURN_VOIDED_FORBIDDEN',
  /** Return: only completed sales can be refunded. */
  SALE_RETURN_NOT_COMPLETED: 'SALE_RETURN_NOT_COMPLETED',
  /** Return: the sale is already refunded. */
  SALE_RETURN_ALREADY_REFUNDED: 'SALE_RETURN_ALREADY_REFUNDED',
  /** Return: a prior refund row already exists (duplicate refund). */
  SALE_RETURN_DUPLICATE: 'SALE_RETURN_DUPLICATE',
  /** Reversal transaction references a product row that no longer exists. */
  SALE_REVERSAL_PRODUCT_MISSING: 'SALE_REVERSAL_PRODUCT_MISSING',

  // --- ENG-018 park-and-resume ---
  /** Suspend/discard target is not in status='draft'. */
  SALE_DRAFT_REQUIRED: 'SALE_DRAFT_REQUIRED',
  /** Resume target has no suspension metadata. */
  SALE_NOT_SUSPENDED: 'SALE_NOT_SUSPENDED',
  /** Resume/discard attempted by a non-owner cashier without manager override. */
  SALE_SUSPEND_OWNERSHIP_REQUIRED: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',

  // --- ENG-019 receipt reprint ---
  /** Reprint requested on a draft sale (drafts have no printable receipt). */
  SALE_REPRINT_DRAFT_FORBIDDEN: 'SALE_REPRINT_DRAFT_FORBIDDEN',
  /** Cashier reprint: caller has no open cash session or the sale does not belong to it. */
  SALE_REPRINT_ACTIVE_SESSION_REQUIRED: 'SALE_REPRINT_ACTIVE_SESSION_REQUIRED',

  // --- ENG-018c draft completion ---
  /** Attempt to complete a draft that is still suspended; caller must resume first. */
  SALE_COMPLETE_DRAFT_SUSPENDED: 'SALE_COMPLETE_DRAFT_SUSPENDED',

  // --- ENG-039c restaurant table linkage ---
  /**
   * `sales.changeTable` requires the target sale to be a suspended draft
   * (`status='draft'` AND `suspended_at IS NOT NULL`). Mirrors the
   * SALE_NOT_SUSPENDED guard but distinguished so the operator UI can
   * surface "this sale already completed, transfer is no longer
   * possible" instead of the generic resume copy.
   */
  SALE_CHANGE_TABLE_INVALID_STATUS: 'SALE_CHANGE_TABLE_INVALID_STATUS',

  // --- ENG-039d3 restaurant service charge ---
  /**
   * Caller submitted a non-zero `serviceChargeAmount` but the tenant has
   * `tenants.settings.restaurant.serviceChargeRate === 0`. Protects
   * retail tenants from accidentally accumulating service charges via a
   * tampered client.
   */
  SALE_SERVICE_CHARGE_DISABLED: 'SALE_SERVICE_CHARGE_DISABLED',
  /**
   * `serviceChargeAmount` disagrees with `roundCurrency(subtotal × rate /
   * 100)` by more than the 1¢ floating-point tolerance. Stale form /
   * tampered client / drifted tenant rate all funnel into the same
   * code so the UI can prompt the operator to reload the modal.
   */
  SALE_SERVICE_CHARGE_DRIFT: 'SALE_SERVICE_CHARGE_DRIFT',

  // --- ENG-039c3 split-bill ---
  /**
   * `sales.splitDraft` requires the source sale to be a suspended draft
   * (`status='draft'` AND `suspended_at IS NOT NULL`). Mirrors
   * `SALE_CHANGE_TABLE_INVALID_STATUS` so the renderer can surface the
   * same "this sale is no longer a suspended draft" copy.
   */
  SALE_SPLIT_INVALID_STATUS: 'SALE_SPLIT_INVALID_STATUS',
  /** `saleItemIds` was empty after Zod parsed it. Should be caught
   * upstream but kept for defence-in-depth. */
  SALE_SPLIT_NO_ITEMS_SELECTED: 'SALE_SPLIT_NO_ITEMS_SELECTED',
  /**
   * One or more entries in `saleItemIds` either do not exist for the
   * caller's tenant or belong to a different sale than `sourceSaleId`.
   * Both cases collapse into the same error so the response cannot be
   * used as a cross-draft existence oracle.
   */
  SALE_SPLIT_ITEMS_NOT_FOUND: 'SALE_SPLIT_ITEMS_NOT_FOUND',

  // --- ENG-060 peripherals registry ---
  /** `peripherals.{update,setActive,test,remove}` could not find the row for the tenant. */
  PERIPHERAL_NOT_FOUND: 'PERIPHERAL_NOT_FOUND',
  /** Driver name not registered in the static dispatch table for the requested kind. */
  PERIPHERAL_DRIVER_INVALID: 'PERIPHERAL_DRIVER_INVALID',
  /** Driver-specific Zod schema rejected the supplied `config` payload. */
  PERIPHERAL_CONFIG_INVALID: 'PERIPHERAL_CONFIG_INVALID',
  /**
   * Partial unique index `idx_site_peripherals_active_per_kind` blocked
   * registering a second active peripheral of the same kind for the same
   * site. The operator must toggle the existing one to `is_active=0`
   * before swapping drivers (e.g. system → escpos).
   */
  PERIPHERAL_ACTIVE_DUPLICATE: 'PERIPHERAL_ACTIVE_DUPLICATE',

  // --- ENG-062 ESC/POS printer + cash drawer ---
  /**
   * `peripherals.printReceipt` was called for a sale that does not
   * exist or belongs to a different tenant. Mirror of the existing
   * sale-not-found patterns; surfaced as NOT_FOUND.
   */
  HARDWARE_SALE_NOT_FOUND: 'HARDWARE_SALE_NOT_FOUND',
  /**
   * `peripherals.kickCashDrawer` had no active drawer registered for
   * the site. Renderer surfaces a translated info toast; this is a
   * polite signal, NOT a hard error.
   */
  HARDWARE_NO_DRAWER_REGISTERED: 'HARDWARE_NO_DRAWER_REGISTERED',
  /**
   * The transport rejected the bytes (USB unplug / TCP unreachable /
   * paper out / driver not implemented). Renderer falls back to the
   * legacy system print path on receipt-print errors; this is the
   * codes operators see for non-fallback paths (drawer kick, test
   * pages).
   */
  HARDWARE_TRANSPORT_FAILED: 'HARDWARE_TRANSPORT_FAILED',
  /**
   * `peripherals.retryHardwareOutbox` (ENG-065a) could not find a
   * `hardware_outbox` row for the tenant. Surfaced as NOT_FOUND so
   * the Operations Center renders a polite "row not found" hint.
   */
  HARDWARE_OUTBOX_NOT_FOUND: 'HARDWARE_OUTBOX_NOT_FOUND',

  // --- ENG-064 sync contract v1 ---
  /**
   * `sync.retry` could not find a `sync_outbox` row for the tenant.
   * Surfaced as NOT_FOUND so the admin UI can render a polite "this
   * row was already drained" message.
   */
  SYNC_OUTBOX_NOT_FOUND: 'SYNC_OUTBOX_NOT_FOUND',
  /**
   * The sync outbox row exhausted `BOUNDED_EXPONENTIAL_BACKOFF`'s
   * retry budget without success. Operator-facing for ENG-065's
   * Operations Center surface.
   */
  SYNC_OUTBOX_DEAD_LETTER: 'SYNC_OUTBOX_DEAD_LETTER',

  // --- ENG-020 fiscal reports ---
  /** `reports.fiscal.getByCufe` could not find a row with that CUFE for the tenant. */
  FISCAL_DOCUMENT_NOT_FOUND: 'FISCAL_DOCUMENT_NOT_FOUND',

  // --- ENG-034 multi-country fiscal packs ---
  /**
   * Sale lifecycle attempted to dispatch a fiscal adapter for a country
   * whose pack is still parked. Mexico (CFDI 4.0) lands with `ENG-035`,
   * Chile (SII) with `ENG-036`. The caller in `sales.ts` already wraps
   * `emitFiscalDocument` in a non-blocking try/catch, so this error
   * appears in the server log warning channel rather than failing the
   * sale itself.
   */
  FISCAL_PACK_NOT_AVAILABLE: 'FISCAL_PACK_NOT_AVAILABLE',

  // --- ENG-035a pack México fundación ---
  /**
   * El RFC capturado en los ajustes fiscales de México no pasa la
   * validación SAT (longitud incorrecta, estructura mal formada,
   * fecha embebida inválida, homoclave equivocada o prefijo en lista
   * negra). Tirado por `fiscal.settings.updateMx` cuando el operador
   * intenta persistir un RFC malformado.
   */
  FISCAL_RFC_INVALID: 'FISCAL_RFC_INVALID',
  /**
   * El código de régimen fiscal MX capturado no existe en el catálogo
   * SAT (`services/fiscal/packs/mx/catalogs/regimenFiscal.ts`). El
   * catálogo ship con 23 regímenes curados; el operador eligió un
   * código fuera de esa lista. Tirado por `fiscal.settings.updateMx`.
   *
   * En ENG-036a se reusa también para giros CL fuera del catálogo
   * CIIU.cl curado — el code semánticamente cubre "el catálogo
   * rechazó el código de actividad económica del emisor" en cualquier
   * país. Si granularidad por país es necesaria, separar a
   * FISCAL_GIRO_INVALID en una iteración futura (BACKLOG).
   */
  FISCAL_REGIMEN_INVALID: 'FISCAL_REGIMEN_INVALID',

  // --- ENG-036a pack Chile fundación ---
  /**
   * El RUT capturado en los ajustes fiscales de Chile no pasa la
   * validación SII (formato, dígito verificador o estructura del
   * cuerpo numérico). Tirado por `fiscal.settings.updateCl` cuando
   * el operador intenta persistir un RUT malformado.
   */
  FISCAL_RUT_INVALID: 'FISCAL_RUT_INVALID',

  // --- ENG-184 pack Colombia config card ---
  /**
   * El NIT del emisor capturado en los ajustes fiscales de Colombia no
   * tiene un formato válido (debe ser 9-10 dígitos con dígito de
   * verificación opcional). Tirado por `fiscal.settings.updateCo`
   * cuando el operador intenta persistir un NIT malformado.
   */
  FISCAL_NIT_INVALID: 'FISCAL_NIT_INVALID',
  /**
   * El rango de numeración de la resolución DIAN capturado es inválido
   * (el consecutivo inicial es mayor que el final, o no son enteros
   * positivos). Tirado por `fiscal.settings.updateCo`.
   */
  FISCAL_NUMBERING_RANGE_INVALID: 'FISCAL_NUMBERING_RANGE_INVALID',
  /**
   * ENG-181 — `services/fiscal/orchestrator.ts` TOCTOU guard: the
   * UPDATE that advances `fiscal_numbering_resolutions.current_number`
   * reported zero rows changed, meaning a concurrent emitter raced
   * past the same sequential window. The orchestrator aborts and the
   * caller should retry with a fresh resolution lookup. `details`
   * carries `{ resolutionId, tenantId, siteId, kind, expectedConsecutive }`
   * — full coordinates so operators can pinpoint the (tenant, site,
   * document-kind) triple that raced.
   */
  FISCAL_SEQUENTIAL_NOT_ADVANCED: 'FISCAL_SEQUENTIAL_NOT_ADVANCED',
} as const;
