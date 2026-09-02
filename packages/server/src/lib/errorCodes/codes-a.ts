/**
 * Server error-code registry — part A ( split).
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
   * the `auth.login` procedure refused the attempt because the
   * per-IP or per-username rate-limit bucket is saturated. `details` carries
   * `{ kind: 'ip' | 'username', key, max, secondsUntilReset }` so the
   * frontend can render a precise retry-after message.
   */
  AUTH_RATE_LIMIT_EXCEEDED: 'AUTH_RATE_LIMIT_EXCEEDED',
  /** the six-digit staff PIN did not match. */
  AUTH_STAFF_PIN_INVALID: 'AUTH_STAFF_PIN_INVALID',

  // --- employee shifts domain () ---
  EMPLOYEE_SHIFT_ALREADY_CLOCKED_IN: 'EMPLOYEE_SHIFT_ALREADY_CLOCKED_IN',
  EMPLOYEE_SHIFT_NOT_CLOCKED_IN: 'EMPLOYEE_SHIFT_NOT_CLOCKED_IN',
  EMPLOYEE_SHIFT_SITE_INACTIVE: 'EMPLOYEE_SHIFT_SITE_INACTIVE',
  EMPLOYEE_SHIFT_PERSIST_FAILED: 'EMPLOYEE_SHIFT_PERSIST_FAILED',
  // labor/cash lifecycle integration.
  EMPLOYEE_SHIFT_CASH_SESSION_OPEN: 'EMPLOYEE_SHIFT_CASH_SESSION_OPEN',
  // --- attendance breaks domain () ---
  EMPLOYEE_SHIFT_BREAK_ALREADY_ACTIVE: 'EMPLOYEE_SHIFT_BREAK_ALREADY_ACTIVE',
  EMPLOYEE_SHIFT_BREAK_NOT_ACTIVE: 'EMPLOYEE_SHIFT_BREAK_NOT_ACTIVE',
  EMPLOYEE_SHIFT_BREAK_ACTIVE: 'EMPLOYEE_SHIFT_BREAK_ACTIVE',
  EMPLOYEE_SHIFT_BREAK_PERSIST_FAILED: 'EMPLOYEE_SHIFT_BREAK_PERSIST_FAILED',
  EMPLOYEE_SHIFT_ATTENDANCE_RANGE_INVALID: 'EMPLOYEE_SHIFT_ATTENDANCE_RANGE_INVALID',
  EMPLOYEE_SHIFT_ATTENDANCE_EMPLOYEE_NOT_FOUND: 'EMPLOYEE_SHIFT_ATTENDANCE_EMPLOYEE_NOT_FOUND',
  EMPLOYEE_SHIFT_ATTENDANCE_SITE_NOT_FOUND: 'EMPLOYEE_SHIFT_ATTENDANCE_SITE_NOT_FOUND',
  // --- immutable attendance corrections () ---
  EMPLOYEE_SHIFT_CORRECTION_NOT_FOUND: 'EMPLOYEE_SHIFT_CORRECTION_NOT_FOUND',
  EMPLOYEE_SHIFT_CORRECTION_ACTIVE: 'EMPLOYEE_SHIFT_CORRECTION_ACTIVE',
  EMPLOYEE_SHIFT_CORRECTION_WINDOW_INVALID: 'EMPLOYEE_SHIFT_CORRECTION_WINDOW_INVALID',
  EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID: 'EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID',
  EMPLOYEE_SHIFT_CORRECTION_PERSIST_FAILED: 'EMPLOYEE_SHIFT_CORRECTION_PERSIST_FAILED',

  // --- labor schedule domain () ---
  SCHEDULE_DATE_RANGE_INVALID: 'SCHEDULE_DATE_RANGE_INVALID',
  SCHEDULE_WINDOW_INVALID: 'SCHEDULE_WINDOW_INVALID',
  SCHEDULE_EMPLOYEE_NOT_FOUND: 'SCHEDULE_EMPLOYEE_NOT_FOUND',
  SCHEDULE_SITE_NOT_FOUND: 'SCHEDULE_SITE_NOT_FOUND',
  SCHEDULE_SHIFT_NOT_FOUND: 'SCHEDULE_SHIFT_NOT_FOUND',
  SCHEDULE_SHIFT_OVERLAP: 'SCHEDULE_SHIFT_OVERLAP',
  SCHEDULE_SHIFT_CANCELLED: 'SCHEDULE_SHIFT_CANCELLED',

  // --- manager approval rail () ---
  MANAGER_APPROVAL_NOT_FOUND: 'MANAGER_APPROVAL_NOT_FOUND',
  MANAGER_APPROVAL_NOT_PENDING: 'MANAGER_APPROVAL_NOT_PENDING',
  MANAGER_APPROVAL_EXPIRED: 'MANAGER_APPROVAL_EXPIRED',
  MANAGER_APPROVAL_PIN_INVALID: 'MANAGER_APPROVAL_PIN_INVALID',
  MANAGER_APPROVAL_SITE_REQUIRED: 'MANAGER_APPROVAL_SITE_REQUIRED',
  MANAGER_APPROVAL_REQUIRED: 'MANAGER_APPROVAL_REQUIRED',
  MANAGER_APPROVAL_MISMATCH: 'MANAGER_APPROVAL_MISMATCH',
  MANAGER_APPROVAL_UNAVAILABLE: 'MANAGER_APPROVAL_UNAVAILABLE',
  // --- deterministic loss-prevention alerts () ---
  LOSS_PREVENTION_ALERT_NOT_FOUND: 'LOSS_PREVENTION_ALERT_NOT_FOUND',

  // --- cash sessions domain ---
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
   * `cashSessions.dayCloseSummary` was asked for a session id that
   * does not exist under the caller's tenant, or belongs to another cashier
   * when the caller is not privileged (both probes are indistinguishable by
   * design). `details` carries `{ sessionId }`.
   */
  CASH_SESSION_NOT_FOUND: 'CASH_SESSION_NOT_FOUND',
  /**
   * the day-close summary only exists for a closed session; the
   * ritual fires from the close mutation's success path, so hitting this
   * means a stale/forged session id. `details` carries `{ sessionId }`.
   */
  CASH_SESSION_NOT_CLOSED: 'CASH_SESSION_NOT_CLOSED',
  /**
   * defensive load failure right after creating / closing a
   * cash session. Should never reach a happy-path UI; surfaces if the
   * SELECT-after-INSERT pattern is broken (DB closed, replication lag,
   * etc.). `details` carries
   * `{ tenantId, sessionId, operation: 'open' | 'close' }`.
   */
  CASH_SESSION_LOAD_FAILED: 'CASH_SESSION_LOAD_FAILED',
  /**
   * a manager requested a comprehensive day-close preview for a
   * tenant-local calendar day that has not started yet.
   */
  DAY_CLOSE_FUTURE_DATE: 'DAY_CLOSE_FUTURE_DATE',
  /** the tenant business date already has immutable signed evidence. */
  DAY_CLOSE_ALREADY_SIGNED: 'DAY_CLOSE_ALREADY_SIGNED',
  /** a report with readiness blockers cannot be attested. */
  DAY_CLOSE_NOT_READY: 'DAY_CLOSE_NOT_READY',
  /** the persisted snapshot no longer matches its canonical hash or schema. */
  DAY_CLOSE_SIGNOFF_INTEGRITY_FAILED: 'DAY_CLOSE_SIGNOFF_INTEGRITY_FAILED',
  /**
   * `services/cash-session.ts:insertCashMovement` rejected a
   * non-positive / non-finite amount.  already rounds
   * at the boundary; this code surfaces if a future caller bypasses
   * `roundMoney()` and feeds a sub-cent or negative value. `details`
   * carries `{ amount }`.
   */
  CASH_MOVEMENT_INVALID_AMOUNT: 'CASH_MOVEMENT_INVALID_AMOUNT',
  /**
   * unknown / unhandled `cash_movements.type` reached
   * `getCashMovementSignedAmount`. Indicates a schema enum value the
   * helper has not been taught about. `details` carries `{ type }`.
   */
  CASH_MOVEMENT_UNSUPPORTED_TYPE: 'CASH_MOVEMENT_UNSUPPORTED_TYPE',
  /**
   * defensive guard on the SELECT-after-INSERT pattern in
   * `application/cash-sessions/recordCashMovement.ts`. Surfaces when
   * the freshly inserted cash movement row cannot be re-read; almost
   * always points to an underlying DB / FK issue. `details` carries
   * `{ tenantId, sessionId, type, amount, stage: 'insert' | 'post-tx' | 'reload', movementId? }`
   * `stage` discriminates the three guard sites (in-transaction
   * insert, post-tx null-id check, post-tx reload-row check).
   */
  CASH_MOVEMENT_PERSIST_FAILED: 'CASH_MOVEMENT_PERSIST_FAILED',

  // --- measurement units domain ---
  /** A tenant already owns the requested unit abbreviation. */
  UNIT_ABBREVIATION_CONFLICT: 'UNIT_ABBREVIATION_CONFLICT',

  // --- fraction policy domain () ---
  /** Admin config: sellByFraction=true but fractionStep is missing / ≤ 0. */
  PRODUCT_FRACTION_STEP_REQUIRED: 'PRODUCT_FRACTION_STEP_REQUIRED',
  /** Admin config: sellByFraction=true but fractionMinimum is missing / ≤ 0. */
  PRODUCT_FRACTION_MINIMUM_REQUIRED: 'PRODUCT_FRACTION_MINIMUM_REQUIRED',
  /** Admin config: fractionMinimum < fractionStep. */
  PRODUCT_FRACTION_MINIMUM_BELOW_STEP: 'PRODUCT_FRACTION_MINIMUM_BELOW_STEP',
  /** Admin config: fractionMinimum is not a multiple of fractionStep. */
  PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED: 'PRODUCT_FRACTION_MINIMUM_NOT_ALIGNED',
  /** : enabling lot tracking would orphan existing/opening stock. */
  PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK: 'PRODUCT_LOT_TRACKING_REQUIRES_ZERO_STOCK',
  /** : a direct stock edit would bypass lot and FEFO evidence. */
  PRODUCT_LOT_TRACKING_STOCK_MANAGED: 'PRODUCT_LOT_TRACKING_STOCK_MANAGED',
  /** : a lot receipt targeted a product without lot tracking enabled. */
  PRODUCT_LOT_TRACKING_REQUIRED: 'PRODUCT_LOT_TRACKING_REQUIRED',
  /** : disabling lot tracking would strand non-zero lot inventory. */
  PRODUCT_LOT_TRACKING_HAS_ACTIVE_LOTS: 'PRODUCT_LOT_TRACKING_HAS_ACTIVE_LOTS',
  /** changing stock, lot, or serial mode would reinterpret dispatched physical custody. */
  PRODUCT_TRACKING_HAS_IN_TRANSIT_TRANSFER: 'PRODUCT_TRACKING_HAS_IN_TRANSIT_TRANSFER',
  /** a service item cannot combine with lot or serial tracking. */
  PRODUCT_SERVICE_TRACKING_CONFLICT: 'PRODUCT_SERVICE_TRACKING_CONFLICT',
  /** a service item cannot hold or receive stock. */
  PRODUCT_SERVICE_REQUIRES_ZERO_STOCK: 'PRODUCT_SERVICE_REQUIRES_ZERO_STOCK',
  /** fail-closed at the balance boundary: no writer may stock a service. */
  PRODUCT_SERVICE_STOCK_NOT_TRACKED: 'PRODUCT_SERVICE_STOCK_NOT_TRACKED',
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
  /** : per-unit identities cannot be moved onto matrix children implicitly. */
  PRODUCT_SERIAL_VARIANT_PARENT_UNSUPPORTED: 'PRODUCT_SERIAL_VARIANT_PARENT_UNSUPPORTED',
  /** : only a zero-stock standard product can become a matrix parent. */
  PRODUCT_VARIANT_PARENT_REQUIRES_ZERO_STOCK: 'PRODUCT_VARIANT_PARENT_REQUIRES_ZERO_STOCK',
  /** : the selected matrix source no longer exists for this tenant. */
  PRODUCT_VARIANT_PARENT_NOT_FOUND: 'PRODUCT_VARIANT_PARENT_NOT_FOUND',
  /** : later document reversals/receipts could restock the matrix parent. */
  PRODUCT_VARIANT_PARENT_HAS_HISTORY: 'PRODUCT_VARIANT_PARENT_HAS_HISTORY',
  /** : the selected product is already a parent or child in a matrix. */
  PRODUCT_VARIANT_MATRIX_EXISTS: 'PRODUCT_VARIANT_MATRIX_EXISTS',
  /** : generated child SKUs collide with tenant catalog rows. */
  PRODUCT_VARIANT_SKU_CONFLICT: 'PRODUCT_VARIANT_SKU_CONFLICT',
  /** : a matrix parent is catalog metadata, never a sellable stock item. */
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
  /** GS1 total-price labels cannot represent fractional stock quantity safely. */
  GS1_PRICE_FRACTIONAL_PRODUCT_UNSUPPORTED: 'GS1_PRICE_FRACTIONAL_PRODUCT_UNSUPPORTED',
  /** GS1 weight labels require an explicit mass base unit for safe conversion. */
  GS1_WEIGHT_UNIT_UNSUPPORTED: 'GS1_WEIGHT_UNIT_UNSUPPORTED',
  /** Split-payment input: Σ(payments.amount) does not match the sale total. */
  SALE_PAYMENTS_SUM_MISMATCH: 'SALE_PAYMENTS_SUM_MISMATCH',

  // --- inventory transfers domain ---
  TRANSFER_SITES_IDENTICAL: 'TRANSFER_SITES_IDENTICAL',
  TRANSFER_SITE_NOT_FOUND: 'TRANSFER_SITE_NOT_FOUND',
  TRANSFER_PRODUCT_NOT_FOUND: 'TRANSFER_PRODUCT_NOT_FOUND',
  TRANSFER_QUANTITY_INVALID: 'TRANSFER_QUANTITY_INVALID',
  TRANSFER_ITEMS_REQUIRED: 'TRANSFER_ITEMS_REQUIRED',
  TRANSFER_INSUFFICIENT_STOCK: 'TRANSFER_INSUFFICIENT_STOCK',
  /** A tenant-wide adjustment debit exceeds stock held at the selected site. */
  INVENTORY_ADJUSTMENT_SITE_STOCK_INSUFFICIENT: 'INVENTORY_ADJUSTMENT_SITE_STOCK_INSUFFICIENT',
  /** Manual stock deltas cannot impersonate sale/purchase/transfer/return aggregates. */
  INVENTORY_MANUAL_MOVEMENT_TYPE_RESERVED: 'INVENTORY_MANUAL_MOVEMENT_TYPE_RESERVED',
  /** A stock delta or its resulting balance is not finite. */
  INVENTORY_QUANTITY_OUT_OF_RANGE: 'INVENTORY_QUANTITY_OUT_OF_RANGE',
  /** Blind aggregate counts cannot reconcile lot or serial identity safely. */
  INVENTORY_COUNT_IDENTITY_TRACKING_REQUIRED: 'INVENTORY_COUNT_IDENTITY_TRACKING_REQUIRED',
  /** One of the requested products is already part of an unfinished count at this site. */
  INVENTORY_COUNT_ALREADY_OPEN: 'INVENTORY_COUNT_ALREADY_OPEN',
  /** The count session or one of its lines changed after the caller loaded it. */
  INVENTORY_COUNT_STALE_VERSION: 'INVENTORY_COUNT_STALE_VERSION',
  /** The requested count transition is not valid from the persisted status. */
  INVENTORY_COUNT_INVALID_STATUS: 'INVENTORY_COUNT_INVALID_STATUS',
  /** A count cannot be submitted until every selected product has a quantity. */
  INVENTORY_COUNT_INCOMPLETE: 'INVENTORY_COUNT_INCOMPLETE',
  /** Site stock changed after the count snapshot, so approval must not rebase silently. */
  INVENTORY_COUNT_BALANCE_CHANGED: 'INVENTORY_COUNT_BALANCE_CHANGED',
  /** Product activity or base-unit identity changed after the count snapshot. */
  INVENTORY_COUNT_CATALOG_CHANGED: 'INVENTORY_COUNT_CATALOG_CHANGED',
  /** A purchase-order draft can only be submitted once from the draft state. */
  ORDER_DRAFT_INVALID_STATUS: 'ORDER_DRAFT_INVALID_STATUS',
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
   * a `transfers.receive` line reports a received quantity
   * greater than the shipped quantity. Accepting would create stock from
   * nothing — operators should complete the receive at the shipped qty and
   * post a separate stock adjustment if they genuinely received more.
   */
  TRANSFER_RECEIVED_EXCEEDS_SHIPPED: 'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
  /**
   * a `transfers.receive` line payload references an item id
   * that does not belong to the target transfer (or is duplicated across
   * entries).
   */
  TRANSFER_RECEIVE_LINE_MISMATCH: 'TRANSFER_RECEIVE_LINE_MISMATCH',

  // --- quotations domain () ---
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
  /** A new quotation cannot freeze an authoritative base-unit assignment. */
  QUOTATION_BASE_UNIT_MISSING: 'QUOTATION_BASE_UNIT_MISSING',
  /** A quotation already owns an immutable link to a completed sale. */
  QUOTATION_ALREADY_CONVERTED: 'QUOTATION_ALREADY_CONVERTED',
  /** Only an accepted quotation may enter the checkout path. */
  QUOTATION_NOT_ACCEPTED: 'QUOTATION_NOT_ACCEPTED',
  /** The accepted quotation passed its frozen validity timestamp. */
  QUOTATION_EXPIRED: 'QUOTATION_EXPIRED',
  /** Checkout attempted to consume a quotation from another site. */
  QUOTATION_SITE_MISMATCH: 'QUOTATION_SITE_MISMATCH',
  /** A historical quotation line has no uniquely provable unit snapshot. */
  QUOTATION_UNIT_SNAPSHOT_MISSING: 'QUOTATION_UNIT_SNAPSHOT_MISSING',
  /** The checkout payload differs from the accepted quotation snapshot. */
  QUOTATION_CONVERSION_MISMATCH: 'QUOTATION_CONVERSION_MISMATCH',

  // --- supplier accounts payable ---
  PROVIDER_PAYABLE_SITE_REQUIRED: 'PROVIDER_PAYABLE_SITE_REQUIRED',
  PROVIDER_PAYABLE_PROVIDER_NOT_FOUND: 'PROVIDER_PAYABLE_PROVIDER_NOT_FOUND',
  PROVIDER_PAYABLE_DOCUMENT_DUPLICATE: 'PROVIDER_PAYABLE_DOCUMENT_DUPLICATE',
  PROVIDER_PAYABLE_PURCHASE_MISMATCH: 'PROVIDER_PAYABLE_PURCHASE_MISMATCH',
  PROVIDER_PAYABLE_PURCHASE_ALREADY_INVOICED: 'PROVIDER_PAYABLE_PURCHASE_ALREADY_INVOICED',
  PROVIDER_PAYABLE_PURCHASE_NOT_COMPLETED: 'PROVIDER_PAYABLE_PURCHASE_NOT_COMPLETED',
  PROVIDER_PAYABLE_ALLOCATION_TOTAL_MISMATCH: 'PROVIDER_PAYABLE_ALLOCATION_TOTAL_MISMATCH',
  PROVIDER_PAYABLE_ALLOCATION_DUPLICATE: 'PROVIDER_PAYABLE_ALLOCATION_DUPLICATE',
  PROVIDER_PAYABLE_INVOICE_NOT_FOUND: 'PROVIDER_PAYABLE_INVOICE_NOT_FOUND',
  PROVIDER_PAYABLE_ALLOCATION_EXCEEDS_OUTSTANDING:
    'PROVIDER_PAYABLE_ALLOCATION_EXCEEDS_OUTSTANDING',
  /** The selected site has no purchase numbering configured. */
  PURCHASE_SEQUENTIAL_MISSING: 'PURCHASE_SEQUENTIAL_MISSING',
  /** The selected site has no purchase-order numbering configured. */
  ORDER_SEQUENTIAL_MISSING: 'ORDER_SEQUENTIAL_MISSING',
  /** A numeric line override does not match an active tenant rate of the product's tax kind. */
  TAX_RATE_KIND_INVALID: 'TAX_RATE_KIND_INVALID',
  /** A normalized line has no components, more than four, duplicates, or an invalid rate. */
  TAX_COMPONENTS_INVALID: 'TAX_COMPONENTS_INVALID',
  /** The active country pack cannot encode the selected component combination without loss. */
  TAX_COMPONENTS_UNREPRESENTABLE: 'TAX_COMPONENTS_UNREPRESENTABLE',

  // --- receipt templates domain (Iter 2) ---
  RECEIPT_TEMPLATE_NOT_FOUND: 'RECEIPT_TEMPLATE_NOT_FOUND',
  RECEIPT_TEMPLATE_NAME_REQUIRED: 'RECEIPT_TEMPLATE_NAME_REQUIRED',
  /** Tried to delete the only active template for a kind — leave at least one. */
  RECEIPT_TEMPLATE_LAST_FOR_KIND: 'RECEIPT_TEMPLATE_LAST_FOR_KIND',
  /** A duplicate's resolved name collides with an existing one for the same kind. */
  RECEIPT_TEMPLATE_NAME_DUPLICATE: 'RECEIPT_TEMPLATE_NAME_DUPLICATE',
  /**
   * defensive guard on the INSERT-RETURNING / UPDATE-RETURNING
   * pattern in `services/receipt-templates.ts`. Surfaces when a row
   * mutation succeeds but the returned row is missing; almost always
   * points to a tenant-scope mismatch or a transaction abort.
   * `details` carries `{ operation: 'insert' | 'update' | 'setDefault', templateId? }`.
   */
  RECEIPT_TEMPLATE_PERSIST_FAILED: 'RECEIPT_TEMPLATE_PERSIST_FAILED',

  // --- sales domain ---
  // Added during  +  while sweeping sales.ts for raw
  // TRPCError messages that bypassed the translate-by-errorCode path
  // and leaked English strings into the localized UI.
  /** Sale id does not exist in the current tenant. */
  SALE_NOT_FOUND: 'SALE_NOT_FOUND',
  /** Post-equivalence normalized quantity is zero / negative / non-finite. */
  SALE_QUANTITY_NONPOSITIVE: 'SALE_QUANTITY_NONPOSITIVE',
  /** No active sale sequential is configured for the tenant. */
  SALE_SEQUENTIAL_MISSING: 'SALE_SEQUENTIAL_MISSING',
  /** A document number could not be reserved from the selected sequential. */
  DOCUMENT_SEQUENTIAL_CHANGED: 'DOCUMENT_SEQUENTIAL_CHANGED',
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
  /** A lot-aware mutation omitted its exact physical allocations. */
  LOT_ALLOCATION_REQUIRED: 'LOT_ALLOCATION_REQUIRED',
  /** The same lot identity appeared more than once in one mutation. */
  LOT_ALLOCATION_DUPLICATE: 'LOT_ALLOCATION_DUPLICATE',
  /** Exact lot quantities do not reconcile to the aggregate line quantity. */
  LOT_ALLOCATION_QUANTITY_MISMATCH: 'LOT_ALLOCATION_QUANTITY_MISMATCH',
  /** A return tried to consume more provenance than the source receipt froze. */
  LOT_ALLOCATION_PROVENANCE_EXCEEDED: 'LOT_ALLOCATION_PROVENANCE_EXCEEDED',
  /** A selected lot cannot cover the requested exact quantity. */
  LOT_INSUFFICIENT_STOCK: 'LOT_INSUFFICIENT_STOCK',
  /** The lot changed between authoritative read and versioned write. */
  LOT_STALE_STOCK: 'LOT_STALE_STOCK',
  /** Re-receipt attempted to assign a second expiry to the same physical batch. */
  LOT_EXPIRY_CONFLICT: 'LOT_EXPIRY_CONFLICT',
  /** Lot unit cost is negative, non-finite, or outside exact safe cents. */
  LOT_COST_INVALID: 'LOT_COST_INVALID',
  /** Lot receipt references a product that does not exist for this tenant. */
  LOT_PRODUCT_NOT_FOUND: 'LOT_PRODUCT_NOT_FOUND',
  /** A lot-tracked sale cannot be fully allocated from currently sellable lots.
   * details: { productId, requested, available, shortfall }. */
  LOT_STOCK_INCONSISTENT: 'LOT_STOCK_INCONSISTENT',
  /** the referenced lot does not exist under the caller's tenant
   * (cross-tenant probes land here too). details: { lotId }. */
  LOT_NOT_FOUND: 'LOT_NOT_FOUND',
  /** the lot cannot receive an expiry-discount suggestion: no
   * expiry date, already expired, depleted, inactive, or outside the tier
   * window. details: { lotId, reason }. */
  LOT_DISCOUNT_NOT_ELIGIBLE: 'LOT_DISCOUNT_NOT_ELIGIBLE',
  /** the lot already carries an ACTIVE discount suggestion (the
   * partial unique index is the race-safe guard). details: { lotId }. */
  LOT_DISCOUNT_ALREADY_ACTIVE: 'LOT_DISCOUNT_ALREADY_ACTIVE',
  /** dismiss targeted a suggestion id that does not exist (or is
   * not active) under the caller's tenant. details: { suggestionId }. */
  PRICE_SUGGESTION_NOT_FOUND: 'PRICE_SUGGESTION_NOT_FOUND',
  PROMOTION_NOT_FOUND: 'PROMOTION_NOT_FOUND',
  PROMOTION_TARGET_INVALID: 'PROMOTION_TARGET_INVALID',
  PROMOTION_STATE_INVALID: 'PROMOTION_STATE_INVALID',
  /** Checkout preview no longer matches active versioned rules or totals. */
  PROMOTION_QUOTE_STALE: 'PROMOTION_QUOTE_STALE',
  /** Pharmacy tenants never convert expiry pressure into an automatic price. */
  PROMOTION_EXPIRY_PHARMACY_FORBIDDEN: 'PROMOTION_EXPIRY_PHARMACY_FORBIDDEN',
  /** a loyalty operation targeted a customer that does not exist
   * under the caller's tenant. details: { customerId }. */
  LOYALTY_CUSTOMER_NOT_FOUND: 'LOYALTY_CUSTOMER_NOT_FOUND',
  /** A redemption or discretionary negative adjustment lacks available points.
   * Return/void clawbacks may create auditable debt instead of blocking goods. */
  LOYALTY_INSUFFICIENT_POINTS: 'LOYALTY_INSUFFICIENT_POINTS',
  LOYALTY_REDEMPTION_DISABLED: 'LOYALTY_REDEMPTION_DISABLED',
  LOYALTY_TENDER_AMOUNT_MISMATCH: 'LOYALTY_TENDER_AMOUNT_MISMATCH',
  LOYALTY_TENDER_SOURCE_MISSING: 'LOYALTY_TENDER_SOURCE_MISSING',
  LOYALTY_TENDER_RESTORE_INVALID: 'LOYALTY_TENDER_RESTORE_INVALID',
  CUSTOMER_VALUE_TENDER_CUSTOMER_REQUIRED: 'CUSTOMER_VALUE_TENDER_CUSTOMER_REQUIRED',
  CUSTOMER_VALUE_TENDER_LEGACY_FORBIDDEN: 'CUSTOMER_VALUE_TENDER_LEGACY_FORBIDDEN',
  /** Applied discount amount exceeds the computed sale total. */
  SALE_DISCOUNT_EXCEEDS_TOTAL: 'SALE_DISCOUNT_EXCEEDS_TOTAL',
  /** Amount received is below the sale total when the payment status is paid. */
  SALE_AMOUNT_RECEIVED_BELOW_TOTAL: 'SALE_AMOUNT_RECEIVED_BELOW_TOTAL',
  /** Update rejected because the sale is already voided. */
  SALE_UPDATE_VOIDED_FORBIDDEN: 'SALE_UPDATE_VOIDED_FORBIDDEN',
  /** Refund payment states are derived from immutable sale-return evidence. */
  SALE_PAYMENT_STATUS_RETURN_MANAGED: 'SALE_PAYMENT_STATUS_RETURN_MANAGED',
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
  /** Return: a selected line does not belong to the sale. */
  SALE_RETURN_LINE_NOT_FOUND: 'SALE_RETURN_LINE_NOT_FOUND',
  /** Return: the same line was submitted more than once. */
  SALE_RETURN_LINE_DUPLICATE: 'SALE_RETURN_LINE_DUPLICATE',
  /** Return: requested quantity exceeds the unreturned quantity. */
  SALE_RETURN_QUANTITY_EXCEEDS_AVAILABLE: 'SALE_RETURN_QUANTITY_EXCEEDS_AVAILABLE',
  /** Return: there is no remaining quantity or refundable balance. */
  SALE_RETURN_NOTHING_AVAILABLE: 'SALE_RETURN_NOTHING_AVAILABLE',
  SALE_RETURN_LOT_DUPLICATE: 'SALE_RETURN_LOT_DUPLICATE',
  SALE_RETURN_LOT_QUANTITY_EXCEEDS_AVAILABLE: 'SALE_RETURN_LOT_QUANTITY_EXCEEDS_AVAILABLE',
  SALE_RETURN_LOT_ALLOCATION_MISMATCH: 'SALE_RETURN_LOT_ALLOCATION_MISMATCH',
  SALE_RETURN_LOT_NOT_FOUND: 'SALE_RETURN_LOT_NOT_FOUND',
  SALE_RETURN_LOT_CHANGED: 'SALE_RETURN_LOT_CHANGED',
  /** Return: the live lot mode no longer matches immutable sale provenance. */
  SALE_RETURN_LOT_TRACKING_CHANGED: 'SALE_RETURN_LOT_TRACKING_CHANGED',
  SALE_RETURN_SERIAL_QUANTITY_INVALID: 'SALE_RETURN_SERIAL_QUANTITY_INVALID',
  SALE_RETURN_SERIAL_SELECTION_MISMATCH: 'SALE_RETURN_SERIAL_SELECTION_MISMATCH',
  /** Return: the live serial mode no longer matches immutable sale provenance. */
  SALE_RETURN_SERIAL_TRACKING_CHANGED: 'SALE_RETURN_SERIAL_TRACKING_CHANGED',
  SALE_RETURN_EXTERNAL_REFERENCE_REQUIRED: 'SALE_RETURN_EXTERNAL_REFERENCE_REQUIRED',
  SALE_RETURN_PAYMENT_ALLOCATION_MISMATCH: 'SALE_RETURN_PAYMENT_ALLOCATION_MISMATCH',
  /** Return: frozen component tax no longer reconstructs the sale-line tax summary. */
  SALE_RETURN_TAX_COMPONENT_MISMATCH: 'SALE_RETURN_TAX_COMPONENT_MISMATCH',
  SALE_RETURN_CUSTOMER_REQUIRED: 'SALE_RETURN_CUSTOMER_REQUIRED',
  SALE_RETURN_SITE_REQUIRED: 'SALE_RETURN_SITE_REQUIRED',
  SALE_RETURN_SITE_MISMATCH: 'SALE_RETURN_SITE_MISMATCH',
  SALE_RETURN_CHANGED: 'SALE_RETURN_CHANGED',
  STORE_CREDIT_AMOUNT_INVALID: 'STORE_CREDIT_AMOUNT_INVALID',
  STORE_CREDIT_BALANCE_CHANGED: 'STORE_CREDIT_BALANCE_CHANGED',
  STORE_CREDIT_INSUFFICIENT_BALANCE: 'STORE_CREDIT_INSUFFICIENT_BALANCE',
  STORE_CREDIT_SOURCE_MISSING: 'STORE_CREDIT_SOURCE_MISSING',
  STORE_CREDIT_RESTORE_INVALID: 'STORE_CREDIT_RESTORE_INVALID',
  SALE_EXCHANGE_RETURN_NOT_FOUND: 'SALE_EXCHANGE_RETURN_NOT_FOUND',
  SALE_EXCHANGE_ALREADY_LINKED: 'SALE_EXCHANGE_ALREADY_LINKED',
  SALE_EXCHANGE_CUSTOMER_MISMATCH: 'SALE_EXCHANGE_CUSTOMER_MISMATCH',
  /** Reversal transaction references a product row that no longer exists. */
  SALE_REVERSAL_PRODUCT_MISSING: 'SALE_REVERSAL_PRODUCT_MISSING',

  // ---  park-and-resume ---
  /** Suspend/discard target is not in status='draft'. */
  SALE_DRAFT_REQUIRED: 'SALE_DRAFT_REQUIRED',
  /** Resume target has no suspension metadata. */
  SALE_NOT_SUSPENDED: 'SALE_NOT_SUSPENDED',
  /** Resume/discard attempted by a non-owner cashier without manager override. */
  SALE_SUSPEND_OWNERSHIP_REQUIRED: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
  /** Client resumed a draft with a tier that differs from its frozen snapshot. */
  SALE_PRICE_TIER_MISMATCH: 'SALE_PRICE_TIER_MISMATCH',
  /** Draft inventory and checkout must remain at the reserving site. */
  SALE_DRAFT_SITE_MISMATCH: 'SALE_DRAFT_SITE_MISMATCH',

  // ---  receipt reprint ---
  /** Reprint requested on a draft sale (drafts have no printable receipt). */
  SALE_REPRINT_DRAFT_FORBIDDEN: 'SALE_REPRINT_DRAFT_FORBIDDEN',
  /** Cashier reprint: caller has no open cash session or the sale does not belong to it. */
  SALE_REPRINT_ACTIVE_SESSION_REQUIRED: 'SALE_REPRINT_ACTIVE_SESSION_REQUIRED',

  // ---  draft completion ---
  /** Attempt to complete a draft that is still suspended; caller must resume first. */
  SALE_COMPLETE_DRAFT_SUSPENDED: 'SALE_COMPLETE_DRAFT_SUSPENDED',

  // ---  restaurant table linkage ---
  /**
   * `sales.changeTable` requires the target sale to be a suspended draft
   * (`status='draft'` AND `suspended_at IS NOT NULL`). Mirrors the
   * SALE_NOT_SUSPENDED guard but distinguished so the operator UI can
   * surface "this sale already completed, transfer is no longer
   * possible" instead of the generic resume copy.
   */
  SALE_CHANGE_TABLE_INVALID_STATUS: 'SALE_CHANGE_TABLE_INVALID_STATUS',

  // ---  restaurant service charge ---
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

  // ---  split-bill ---
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

  // ---  peripherals registry ---
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

  // ---  ESC/POS printer + cash drawer ---
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
   * `peripherals.retryHardwareOutbox` () could not find a
   * `hardware_outbox` row for the tenant. Surfaced as NOT_FOUND so
   * the Operations Center renders a polite "row not found" hint.
   */
  HARDWARE_OUTBOX_NOT_FOUND: 'HARDWARE_OUTBOX_NOT_FOUND',

  // ---  sync contract v1 ---
  /**
   * `sync.retry` could not find a `sync_outbox` row for the tenant.
   * Surfaced as NOT_FOUND so the admin UI can render a polite "this
   * row was already drained" message.
   */
  SYNC_OUTBOX_NOT_FOUND: 'SYNC_OUTBOX_NOT_FOUND',
  /**
   * The sync outbox row exhausted `BOUNDED_EXPONENTIAL_BACKOFF`'s
   * retry budget without success. Operator-facing for 's
   * Operations Center surface.
   */
  SYNC_OUTBOX_DEAD_LETTER: 'SYNC_OUTBOX_DEAD_LETTER',

  // ---  fiscal reports ---
  /** `reports.fiscal.getByCufe` could not find a row with that CUFE for the tenant. */
  FISCAL_DOCUMENT_NOT_FOUND: 'FISCAL_DOCUMENT_NOT_FOUND',

  // ---  multi-country fiscal packs ---
  /**
   * Sale lifecycle attempted to dispatch a fiscal adapter for a country
   * whose pack is still parked. Mexico (CFDI 4.0) lands with ,
   * Chile (SII) with . The caller in `sales.ts` already wraps
   * `emitFiscalDocument` in a non-blocking try/catch, so this error
   * appears in the server log warning channel rather than failing the
   * sale itself.
   */
  FISCAL_PACK_NOT_AVAILABLE: 'FISCAL_PACK_NOT_AVAILABLE',

  // ---  pack México fundación ---
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
   * En  se reusa también para giros CL fuera del catálogo
   * CIIU.cl curado — el code semánticamente cubre "el catálogo
   * rechazó el código de actividad económica del emisor" en cualquier
   * país. Si granularidad por país es necesaria, separar a
   * FISCAL_GIRO_INVALID en una iteración futura (deferred).
   */
  FISCAL_REGIMEN_INVALID: 'FISCAL_REGIMEN_INVALID',

  // ---  pack Chile fundación ---
  /**
   * El RUT capturado en los ajustes fiscales de Chile no pasa la
   * validación SII (formato, dígito verificador o estructura del
   * cuerpo numérico). Tirado por `fiscal.settings.updateCl` cuando
   * el operador intenta persistir un RUT malformado.
   */
  FISCAL_RUT_INVALID: 'FISCAL_RUT_INVALID',

  // ---  pack Colombia config card ---
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
   * `services/fiscal/orchestrator.ts` TOCTOU guard: the
   * UPDATE that advances `fiscal_numbering_resolutions.current_number`
   * reported zero rows changed, meaning a concurrent emitter raced
   * past the same sequential window. The orchestrator aborts and the
   * caller should retry with a fresh resolution lookup. `details`
   * carries `{ resolutionId, tenantId, siteId, kind, expectedConsecutive }`
   * full coordinates so operators can pinpoint the (tenant, site,
   * document-kind) triple that raced.
   */
  FISCAL_SEQUENTIAL_NOT_ADVANCED: 'FISCAL_SEQUENTIAL_NOT_ADVANCED',
  /** Frozen IVA + INC line buckets do not reconstruct the sale header tax total. */
  FISCAL_TAX_TOTAL_MISMATCH: 'FISCAL_TAX_TOTAL_MISMATCH',
} as const;
