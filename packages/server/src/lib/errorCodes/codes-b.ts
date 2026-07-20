/**
 * Server error-code registry — part B ( split).
 *
 * Domains sync-resolve … optimistic-concurrency. Merged with part A in
 * `registry.ts`. Leaf module.
 *
 * @module lib/errorCodes/codes-b
 */
export const SERVER_ERROR_CODES_B = {
  // ---  sync resolve TOCTOU close-out ---
  /**
   * `sync.resolve` refused a `local_wins` or `merged` resolution because the
   * local record no longer exists at the moment the transaction opens. The
   * caller should either delete the queued change or pick `remote_wins`.
   * Detected inside the transaction so the conflict row stays `pending` and
   * the queue is unchanged on this throw.
   */
  SYNC_LOCAL_RECORD_MISSING: 'SYNC_LOCAL_RECORD_MISSING',

  // ---  device registry + command envelope ---
  /**
   * The `x-device-id` header is missing, malformed, or names a device row
   * that does not exist for the active tenant (or has been deactivated).
   * The renderer must call `auth.registerDevice` to obtain a fresh id and
   * persist it (Electron userData file or browser localStorage) before
   * retrying the critical mutation.
   */
  DEVICE_NOT_REGISTERED: 'DEVICE_NOT_REGISTERED',
  // ---  Authority Node pairing + health ---
  AUTHORITY_SITE_NOT_FOUND: 'AUTHORITY_SITE_NOT_FOUND',
  AUTHORITY_PAIRING_CODE_INVALID: 'AUTHORITY_PAIRING_CODE_INVALID',
  AUTHORITY_PAIRING_CODE_EXPIRED: 'AUTHORITY_PAIRING_CODE_EXPIRED',
  AUTHORITY_PAIRING_CODE_USED: 'AUTHORITY_PAIRING_CODE_USED',
  AUTHORITY_DEVICE_NOT_REVOKABLE: 'AUTHORITY_DEVICE_NOT_REVOKABLE',
  /**
   * pairing-code generator exhausted its allocation retries
   * without finding a unique value. `services/devices/authority/pairing.ts`
   * picks a random 8-character code (formatted as XXXX-XXXX), and a saturated
   * keyspace under heavy onboarding load could cause this. `details` carries
   * `{ tenantId, siteId, attempts }`.
   */
  DEVICE_PAIRING_CODE_ALLOCATION_EXHAUSTED: 'DEVICE_PAIRING_CODE_ALLOCATION_EXHAUSTED',
  /**
   * A procedure decorated with `criticalCommandProcedure` (per ADR-0002)
   * received an empty or malformed Command Envelope header. Renderers
   * must mint `operationId`, `idempotencyKey`, and `clientCreatedAt`
   * before invoking critical mutations.
   */
  MISSING_COMMAND_ENVELOPE: 'MISSING_COMMAND_ENVELOPE',
  /**
   * The same `idempotencyKey` was replayed against the same procedure
   * with a different canonical input hash. The cached result is intact;
   * the caller must mint a new key for the new payload or resend the
   * original payload that produced the cached result. `details` carries
   * `{ providedHash, storedHash, operationKind }`.
   */
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  /**
   * The same `idempotencyKey` + canonical input was retried while the
   * original critical command is still running. The caller should wait
   * for the first request to finish instead of executing the command
   * again.
   */
  COMMAND_IN_PROGRESS: 'COMMAND_IN_PROGRESS',

  // ---  AI foundation ---
  /**
   * AI features are turned off at the tenant level
   * (`tenants.settings.ai.enabled === false`). The renderer should gray
   * out AI-driven UI surfaces; the server short-circuits before any
   * provider call so no audit-log row is written.
   */
  AI_DISABLED: 'AI_DISABLED',
  /**
   * The current month's AI spend is at or above the tenant's
   * `monthlyBudgetUsd`. Pre-checked before each call. Caller should
   * raise the budget, wait for next month, or disable the feature.
   */
  AI_BUDGET_EXCEEDED: 'AI_BUDGET_EXCEEDED',
  /**
   * the active site has already consumed the per-site
   * monthly quota for an AI feature (e.g. 800 Co-pilot questions or
   * 200 OCR invoices). Pre-checked BEFORE the provider call so a
   * blocked request never produces an audit row. The error `details`
   * carry `{ feature, used, limit, resetsAt }` so the client toast can
   * render "800/800 — renews on YYYY-MM-01" without a follow-up
   * round-trip. Errored prior calls (provider 5xx, etc.) do NOT
   * consume quota — only successful audit rows count.
   */
  AI_QUOTA_EXCEEDED: 'AI_QUOTA_EXCEEDED',
  /**
   * The configured provider is unreachable, unconfigured (no env-var
   * key), or returned an error. Wraps the original SDK / network
   * error in `details.cause`.
   */
  AI_PROVIDER_ERROR: 'AI_PROVIDER_ERROR',
  /**
   * The conversational analytics co-pilot rejected generated SQL before
   * execution. Only single-statement SELECT/WITH queries over the bounded
   * analytics snapshot are allowed.
   */
  AI_COPILOT_SQL_REJECTED: 'AI_COPILOT_SQL_REJECTED',
  /**
   * The co-pilot analytics snapshot would exceed its server-side row caps.
   * The caller must provide a narrower date/site context before retrying.
   */
  AI_COPILOT_QUERY_LIMIT_EXCEEDED: 'AI_COPILOT_QUERY_LIMIT_EXCEEDED',

  // ---  AI Wave 2 vision slice ---
  /**
   * The tenant's configured AI provider does not implement a vision
   * model (e.g. Ollama stub). The caller should switch providers or
   * disable the surface that triggered the OCR call.
   */
  AI_VISION_NOT_AVAILABLE: 'AI_VISION_NOT_AVAILABLE',
  /**
   * The vision model returned a response that did not match the
   * required invoice schema. The renderer should let the operator
   * retry with a clearer photo or transcribe the invoice manually.
   * `details.cause` carries the raw error message for diagnostics.
   */
  AI_VISION_PARSE_FAILED: 'AI_VISION_PARSE_FAILED',
  /**
   * The uploaded invoice image exceeds the per-call byte budget
   * (`INVOICE_OCR_MAX_BYTES`, 10 MB raw after base64 decode). The
   * renderer should re-encode or downscale before retrying.
   */
  AI_VISION_IMAGE_TOO_LARGE: 'AI_VISION_IMAGE_TOO_LARGE',

  // ---  slice 1 — voice / Whisper transcription ---
  /**
   * The tenant's configured AI provider does not implement a
   * transcription model (Anthropic + Ollama today). The caller should
   * switch providers or disable the surface that triggered the
   * transcription call.
   */
  AI_VOICE_NOT_AVAILABLE: 'AI_VOICE_NOT_AVAILABLE',
  /**
   * The transcription model returned an empty / malformed response.
   * The renderer should let the operator re-record. `details.cause`
   * carries the raw error message for diagnostics.
   */
  AI_VOICE_PARSE_FAILED: 'AI_VOICE_PARSE_FAILED',
  /**
   * The uploaded audio payload exceeds the per-call byte budget
   * (`VOICE_TRANSCRIBE_MAX_BYTES`, 10 MB raw after base64 decode).
   * The renderer should trim the recording before retrying.
   */
  AI_VOICE_AUDIO_TOO_LARGE: 'AI_VOICE_AUDIO_TOO_LARGE',
  /**
   * slice 3 — the cart-command parser couldn't extract any
   * actions from the transcript (either empty input or the cashier
   * said something that wasn't an "agregar producto" command). The
   * common path returns `mode='unrecognized'` instead so the modal
   * can render the reason inline; this code only fires when the
   * server explicitly throws (empty/oversize transcript guard).
   */
  AI_VOICE_COMMAND_UNRECOGNIZED: 'AI_VOICE_COMMAND_UNRECOGNIZED',

  // --- module activation kernel () ---
  /**
   * The caller hit a procedure that requires a tenant module that
   * is currently deactivated. Distinct from a role-based FORBIDDEN
   * so the renderer can show a "feature not available for your
   * plan" toast instead of an authentication / authorization toast.
   *
   * Cause carries `{ moduleId: ModuleId }`.
   */
  MODULE_NOT_ACTIVATED: 'MODULE_NOT_ACTIVATED',
  /**
   * Caller passed an unknown module id to `modules.setActive`.
   * Indicates a stale client; the input list is enforced via Zod
   * refine against the manifest.
   */
  MODULE_UNKNOWN: 'MODULE_UNKNOWN',
  /**
   * Pack Chile DTE 1.0. The orchestrator tried to emit a
   * fiscal document for a CL tenant but no active CAF (Código de
   * Autorización de Folios) exists for the resolved (tenantId, tipoDte).
   * The operator must register a CAF from the SII portal before any
   * emission of that document type can proceed.
   *
   * Cause carries `{ tenantId, tipoDte }`.
   */
  CAF_NOT_AVAILABLE: 'CAF_NOT_AVAILABLE',
  /**
   * Pack Chile DTE 1.0. The active CAF's folio cursor has
   * exceeded `folio_hasta`; the allocator atomically flipped the row
   * to `status='exhausted'`. The operator must register the next CAF
   * range from the SII portal. SII forbids reusing exhausted folios.
   *
   * Cause carries `{ tenantId, tipoDte, cafId, folioHasta }`.
   */
  CAF_EXHAUSTED: 'CAF_EXHAUSTED',
  /**
   * slice 2 — payment provider credential settings. The admin
   * tried to save a credential map for a rail but included a field key
   * that the rail does not declare in
   * `services/payments/manifest.ts::CREDENTIAL_FIELDS_BY_RAIL`. Tirado
   * por `paymentSettings.updateRail` antes de cualquier persistencia
   * para evitar que campos no declarados aterricen en el blob de
   * settings.
   *
   * Cause carries `{ railId, unknownKey }`.
   */
  PAYMENT_CREDENTIAL_UNKNOWN_FIELD: 'PAYMENT_CREDENTIAL_UNKNOWN_FIELD',
  /**
   * reconciliation matcher could not find any provider
   * statement row matching a POS tender. Carries
   * `{ tenantId, salePaymentId, reference }`. Surfaced from the
   * server-side worker logs and (via translateServerError) the
   * Operations Center mismatch tooltips once  ships the
   * retry UI.
   */
  PAYMENT_RECONCILIATION_NO_MATCH: 'PAYMENT_RECONCILIATION_NO_MATCH',
  /**
   * reconciliation matcher found multiple plausible matches
   * for the same statement row and the AI tie-break path was either
   * disabled, over-budget, or returned a non-decisive answer. Carries
   * `{ tenantId, statementReference, candidates }`. The worker keeps
   * the mismatch surfaced for operator review.
   */
  PAYMENT_RECONCILIATION_AMBIGUOUS: 'PAYMENT_RECONCILIATION_AMBIGUOUS',
  /**
   * AI tie-break call failed (provider unavailable, budget
   * exceeded, module off) AND the matcher had to degrade to a
   * deterministic suggestion. Operator-visible warning; not a fatal
   * error. Carries `{ tenantId, reason }` where reason is one of
   * `'ai-disabled' | 'ai-budget-exceeded' | 'ai-provider-error'`.
   */
  PAYMENT_RECONCILIATION_AI_DEGRADED: 'PAYMENT_RECONCILIATION_AI_DEGRADED',
  /**
   * admin tried to act on a `payment_outbox` row that does
   * not exist for the active tenant. The lookup is tenant-scoped so a
   * cross-tenant attempt collapses to NOT_FOUND (not FORBIDDEN) — never
   * leak existence across tenants. Mirrors `HARDWARE_OUTBOX_NOT_FOUND`.
   *
   * Cause carries `{ tenantId, outboxId }`.
   */
  PAYMENT_OUTBOX_NOT_FOUND: 'PAYMENT_OUTBOX_NOT_FOUND',
  /**
   * admin tried to retry a `payment_outbox` row that is in
   * a terminal status the matcher should not undo via a retry gesture
   * (today this is just `settled`; the operator can still use
   * mark-settled to reverse-confirm if needed). Cause carries
   * `{ outboxId, currentStatus }` for the UI hint.
   */
  PAYMENT_OUTBOX_NOT_RETRIABLE: 'PAYMENT_OUTBOX_NOT_RETRIABLE',
  /**
   * admin tried to act on a `restaurant_tables` row that
   * does not exist for the active tenant. The lookup is tenant-scoped
   * so a cross-tenant attempt collapses to NOT_FOUND (not FORBIDDEN) —
   * never leak existence across tenants. Mirrors the
   * `PAYMENT_OUTBOX_NOT_FOUND` pattern.
   */
  RESTAURANT_TABLE_NOT_FOUND: 'RESTAURANT_TABLE_NOT_FOUND',
  /**
   * partial-unique conflict on `(tenant_id, site_id, name)`
   * among active `restaurant_tables` rows. Archived rows are excluded
   * from the unique index so the same display name can be re-created
   * after archiving the original. Cause carries `{ siteId, name }`.
   */
  RESTAURANT_TABLE_NAME_DUPLICATE: 'RESTAURANT_TABLE_NAME_DUPLICATE',

  // --- kitchen display () ---
  /**
   * `kds_orders` row not found for the (tenant, id) pair.
   * Mirrors the cross-tenant collapse contract: a card from another
   * tenant returns NOT_FOUND with this code so existence never leaks.
   * Also raised by `markReady` / `recall` when the row has already
   * been deleted by a racing `discardDraft` or `voidSale`.
   */
  KDS_ORDER_NOT_FOUND: 'KDS_ORDER_NOT_FOUND',
  /**
   * `kds.recall` was called on a row whose status is not
   * `ready`. Cause carries the actual `currentStatus` so the UI can
   * render the right toast.
   */
  KDS_ORDER_NOT_READY: 'KDS_ORDER_NOT_READY',

  // --- credit sales domain () ---
  /**
   * `completeSale` refused the credit-sale payload because the projected
   * balance (`currentBalance + grandTotal`) would exceed the customer's
   * configured `creditLimit`. `details` carries
   * `{ creditLimit, currentBalance, projectedBalance, attemptedAmount }`
   * so the cashier UI can render a precise "Cupo superado por $X" toast
   * and offer the admin-override checkbox without an extra round-trip.
   * The override path bypasses this throw entirely.
   */
  CREDIT_LIMIT_EXCEEDED: 'CREDIT_LIMIT_EXCEEDED',
  /**
   * `completeSale` received `paymentMethod === 'credit'` without a
   * `customerId`. Credit sales are per-customer by definition; the
   * UI's payment-method tile is gated to hide the credit choice when
   * no customer is attached, so this code is a server-side guard
   * against drift / direct API consumers.
   */
  CREDIT_SALE_CUSTOMER_REQUIRED: 'CREDIT_SALE_CUSTOMER_REQUIRED',
  /**
   * A non-admin caller set `creditOverride: true` on `sales.create`.
   * Only admins can bypass the cupo limit; the router rejects manager
   * and cashier callers at the input layer before the sale tx runs.
   */
  CREDIT_OVERRIDE_FORBIDDEN: 'CREDIT_OVERRIDE_FORBIDDEN',
  /**
   * A caller without credit-lending authority attempted to complete a
   * sale with `paymentMethod === 'credit'`. Managers and admins can lend
   * credit; cashiers need the follow-up approval queue before they can
   * request an admin co-sign in-app.
   */
  CREDIT_SALE_FORBIDDEN: 'CREDIT_SALE_FORBIDDEN',
  /**
   * refund of a sale that included a credit tender (split
   * cash + credit, "apartado") is not yet supported because reversing
   * a partial-credit sale requires reversing both the cash session
   * movement and the customer-ledger entry, with operator-facing copy
   * for partial reversals. The dedicated flow lives behind a future
   * ticket; until it lands, `returnSale` blocks the refund with this
   * code so an operator cannot leave a half-reversed sale in the DB.
   */
  REFUND_PARTIAL_CREDIT_NOT_SUPPORTED: 'REFUND_PARTIAL_CREDIT_NOT_SUPPORTED',
  /**
   * `recordCreditSaleLedger` refused a non-positive /
   * non-finite credit amount. The completeSale resolver already
   * rounds + validates earlier, so this surfaces as a defensive
   * guard against a caller that bypasses the application service.
   * `details` carries `{ creditAmount, customerId }`.
   */
  CREDIT_LEDGER_INVALID_AMOUNT: 'CREDIT_LEDGER_INVALID_AMOUNT',

  // ---  optimistic concurrency ---
  /**
   * a catalog `*.update` mutation (products / customers /
   * providers / categories / tenant locale) received a `version` that no
   * longer matches the stored row, meaning another tab or operator already
   * saved an edit. The write is rejected instead of silently clobbering the
   * other change; the renderer reloads the row (now carrying the new
   * version) before letting the operator retry. Guards the *live-edit*
   * layer — distinct from ADR-0004's sync-layer auto-LWW reconciliation.
   * `details` carries `{ entity, suppliedVersion }`. The renderer reloads the
   * row to fetch the current version instead of doing an extra server read in
   * the failed UPDATE path.
   */
  STALE_VERSION: 'STALE_VERSION',
} as const;
