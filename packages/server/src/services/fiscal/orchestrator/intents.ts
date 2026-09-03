/**
 * Durable fiscal emission intents.
 *
 * Completed-sale transactions persist one frozen intent before committing the
 * Command Envelope result. Materialization is local-only: it allocates the
 * fiscal consecutive and creates the document, item snapshots and provider
 * outbox in one later transaction. A crash can therefore delay emission, but
 * cannot erase the obligation to emit.
 *
 * @module services/fiscal/orchestrator/intents
 */
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  companies,
  fiscalDocumentItems,
  fiscalDocumentItemTaxComponents,
  fiscalDocuments,
  fiscalEmissionIntents,
  fiscalNumberingResolutions,
  fiscalOutbox,
  tenants,
  type FiscalDocumentKind,
  type FiscalDocumentSource,
  type FiscalEmissionIntentRow,
} from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import type { PuntovivoLogger } from '../../../logging/logger.js';
import { resolveTenantLocale } from '../../tenant-locale.js';
import type { FiscalAdapterIssueInput } from '../adapter.js';
import { CONSUMIDOR_FINAL, type FiscalEnvironment } from '../cufe.js';
import { allocateNextFolio } from '../packs/cl/caf-allocator.js';
import { mapInternalKindToTipoDte } from '../packs/cl/mappings.js';
import { describeFiscalProvider, getFiscalAdapter, isSupportedFiscalCountry } from '../registry.js';
import {
  assertFiscalTaxHeaderParity,
  getResolvedLineTaxComponents,
  sumTaxTotals,
  toAdapterLines,
  toDocumentItemValues,
  toDocumentTaxComponentValues,
} from './tax-lines.js';
import { isCountryFiscalEnabled, isDianEnabled, splitIssueTimestamp } from './helpers.js';
import { resolveBuyer, type FiscalMonetarySnapshot } from './snapshots.js';
import type { EmitFiscalDocumentResult, ResolvedLine } from './types.js';

const INTENT_PAYLOAD_VERSION = 1;
const MAX_MATERIALIZATION_ATTEMPTS = 8;
const MATERIALIZATION_RETRY_BASE_MS = 1_000;

type FiscalAdapterInputTemplate = Omit<FiscalAdapterIssueInput, 'resolution' | 'chileAllocation'>;

interface FiscalIntentResolutionSnapshot {
  id: string;
  resolutionNumber: string;
  prefix: string;
  technicalKey: string;
  fromNumber: number;
  toNumber: number;
  validFrom: string;
  validUntil: string;
}

export interface FiscalEmissionIntentPayloadV1 {
  version: 1;
  requestedAt: string;
  countryCode: string;
  providerId: string;
  siteId: string;
  buyerCustomerId: string | null;
  resolution: FiscalIntentResolutionSnapshot | null;
  adapterInput: FiscalAdapterInputTemplate;
  amounts: FiscalMonetarySnapshot;
  lines: ResolvedLine[];
}

export interface PreparedSaleFiscalIntent {
  id: string;
  tenantId: string;
  source: FiscalDocumentSource;
  sourceId: string;
  saleId: string;
  kind: FiscalDocumentKind;
  requestedByUserId: string;
  status: 'queued' | 'blocked';
  payload: FiscalEmissionIntentPayloadV1;
  lastError: Record<string, unknown> | null;
  createdAt: string;
}

export interface PrepareSaleFiscalIntentArgs {
  db: DatabaseInstance;
  tenantId: string;
  userId: string;
  saleId: string;
  siteId: string;
  customerId: string | null;
  paymentMethod: string;
  amounts: FiscalMonetarySnapshot;
  lines: ResolvedLine[];
  completedAt: string;
  log: Pick<PuntovivoLogger, 'warn' | 'debug'>;
  source?: FiscalDocumentSource | undefined;
  sourceId?: string | undefined;
  kind?: FiscalDocumentKind | undefined;
  originalCufe?: string | undefined;
  reasonCode?: string | undefined;
  environment?: FiscalEnvironment | undefined;
}

function fiscalSettingsSnapshot(
  settings: Record<string, unknown>,
  countryCode: string
): Record<string, unknown> {
  const countryKey = countryCode.toLowerCase();
  const fiscal = settings.fiscal;
  const countrySettings =
    typeof fiscal === 'object' && fiscal !== null && !Array.isArray(fiscal)
      ? (fiscal as Record<string, unknown>)[countryKey]
      : undefined;
  const snapshot: Record<string, unknown> = {};
  if (settings.fiscal_dian_enabled !== undefined) {
    snapshot.fiscal_dian_enabled = settings.fiscal_dian_enabled;
  }
  if (settings.fiscalDianEnabled !== undefined) {
    snapshot.fiscalDianEnabled = settings.fiscalDianEnabled;
  }
  if (countrySettings !== undefined) {
    snapshot.fiscal = { [countryKey]: countrySettings };
  }
  return snapshot;
}

function blockedError(reason: string, details?: unknown): Record<string, unknown> {
  return {
    code: 'FISCAL_INTENT_BLOCKED',
    reason,
    ...(details === undefined ? {} : { details }),
  };
}

function resolutionIsEffectiveAt(
  requestedAt: string,
  validFrom: string,
  validUntil: string
): boolean {
  const requested = Date.parse(requestedAt);
  const from = Date.parse(validFrom);
  const until = Date.parse(validUntil);
  return (
    Number.isFinite(requested) &&
    Number.isFinite(from) &&
    Number.isFinite(until) &&
    requested >= from &&
    requested <= until
  );
}

class FiscalIntentBlockedError extends Error {
  constructor(
    readonly reason: string,
    readonly details?: unknown
  ) {
    super(`Fiscal intent blocked: ${reason}`);
    this.name = 'FiscalIntentBlockedError';
  }
}

class FiscalIntentDependencyPendingError extends Error {
  constructor(readonly reason: string) {
    super(`Fiscal intent dependency pending: ${reason}`);
    this.name = 'FiscalIntentDependencyPendingError';
  }
}

/**
 * Resolve every mutable fiscal input before the sale owns the SQLite writer.
 * Once the tenant has enabled a supported fiscal pack, missing configuration
 * creates a durable `blocked` intent rather than silently dropping the work.
 */
export async function prepareSaleFiscalIntent(
  args: PrepareSaleFiscalIntentArgs
): Promise<PreparedSaleFiscalIntent | null> {
  const {
    db,
    tenantId,
    userId,
    saleId,
    siteId,
    customerId,
    paymentMethod,
    amounts,
    lines,
    completedAt,
  } = args;
  const source = args.source ?? 'sale';
  const sourceId = args.sourceId ?? saleId;
  const kind = args.kind ?? 'DEE';
  if (!(await isDianEnabled(db, tenantId))) return null;

  const locale = await resolveTenantLocale(db, tenantId);
  if (!isSupportedFiscalCountry(locale.countryCode)) return null;

  const tenantRow = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const tenantSettings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  if (!isCountryFiscalEnabled(tenantSettings, locale.countryCode)) return null;

  const adapter = getFiscalAdapter(locale.countryCode);
  const [buyer, companyRow, resolution] = await Promise.all([
    resolveBuyer(db, tenantId, customerId),
    db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .limit(1)
      .get(),
    db
      .select({
        id: fiscalNumberingResolutions.id,
        resolutionNumber: fiscalNumberingResolutions.resolutionNumber,
        prefix: fiscalNumberingResolutions.prefix,
        technicalKey: fiscalNumberingResolutions.technicalKey,
        fromNumber: fiscalNumberingResolutions.fromNumber,
        toNumber: fiscalNumberingResolutions.toNumber,
        validFrom: fiscalNumberingResolutions.validFrom,
        validUntil: fiscalNumberingResolutions.validUntil,
        currentNumber: fiscalNumberingResolutions.currentNumber,
      })
      .from(fiscalNumberingResolutions)
      .where(
        and(
          eq(fiscalNumberingResolutions.tenantId, tenantId),
          eq(fiscalNumberingResolutions.siteId, siteId),
          eq(fiscalNumberingResolutions.kind, kind),
          eq(fiscalNumberingResolutions.isActive, true)
        )
      )
      .get(),
  ]);
  const frozenSettings = fiscalSettingsSnapshot(tenantSettings, locale.countryCode);
  const { issueDate, issueTime } = splitIssueTimestamp(new Date(completedAt));
  const headerTaxTotals = sumTaxTotals(lines);
  const adapterInput: FiscalAdapterInputTemplate = {
    tenantId,
    source,
    sourceId,
    kind,
    issueDate,
    issueTime,
    environment: args.environment ?? '2',
    issuerNit: tenantId,
    issuerName: companyRow?.name ?? undefined,
    tenantSettings: frozenSettings,
    currencyCode: locale.currency,
    localeCode: locale.locale,
    paymentMethod,
    buyer: {
      taxId: buyer.taxId,
      taxIdTypeCode: buyer.taxIdTypeCode,
      name: buyer.name,
      email: buyer.email,
      address: buyer.address,
      city: buyer.city,
      department: buyer.department,
      country: buyer.country,
    },
    subtotal: amounts.subtotal,
    ivaAmount: headerTaxTotals.ivaAmount,
    incAmount: headerTaxTotals.incAmount,
    icaAmount: 0,
    discountAmount: amounts.discountAmount,
    totalAmount: amounts.total,
    lines: toAdapterLines(lines),
    originalCufe:
      args.originalCufe && !args.originalCufe.startsWith('pending-')
        ? args.originalCufe
        : undefined,
    reasonCode: args.reasonCode,
  };

  let status: PreparedSaleFiscalIntent['status'] = 'queued';
  let lastError: Record<string, unknown> | null = null;
  if (!resolution) {
    status = 'blocked';
    lastError = blockedError('numbering_resolution_missing', { siteId, kind });
  } else if (!resolutionIsEffectiveAt(completedAt, resolution.validFrom, resolution.validUntil)) {
    status = 'blocked';
    lastError = blockedError('numbering_resolution_not_effective', {
      resolutionId: resolution.id,
      requestedAt: completedAt,
      validFrom: resolution.validFrom,
      validUntil: resolution.validUntil,
    });
  } else if (
    resolution.currentNumber < resolution.fromNumber - 1 ||
    resolution.currentNumber >= resolution.toNumber
  ) {
    status = 'blocked';
    lastError = blockedError('numbering_resolution_exhausted', {
      resolutionId: resolution.id,
      currentNumber: resolution.currentNumber,
      fromNumber: resolution.fromNumber,
      toNumber: resolution.toNumber,
    });
  } else if (lines.length === 0) {
    status = 'blocked';
    lastError = blockedError('sale_lines_missing');
  } else {
    try {
      assertFiscalTaxHeaderParity(amounts.taxAmount, headerTaxTotals);
    } catch {
      status = 'blocked';
      lastError = blockedError('tax_header_mismatch', {
        headerTaxAmount: amounts.taxAmount,
        ...headerTaxTotals,
      });
    }
  }
  if (status === 'queued') {
    try {
      const validation = await adapter.validateConfig({
        tenantId,
        countryCode: adapter.countryCode,
        settings: frozenSettings,
      });
      if (!validation.ok) {
        status = 'blocked';
        lastError = blockedError('adapter_configuration_invalid', validation.issues);
      }
    } catch (error) {
      status = 'blocked';
      lastError = blockedError('adapter_configuration_validation_failed');
      args.log.warn(
        { err: error, tenantId, countryCode: adapter.countryCode },
        'fiscal intent configuration validation failed; preserving blocked intent'
      );
    }
  }
  const resolutionSnapshot: FiscalIntentResolutionSnapshot | null = resolution
    ? {
        id: resolution.id,
        resolutionNumber: resolution.resolutionNumber,
        prefix: resolution.prefix,
        technicalKey: resolution.technicalKey,
        fromNumber: resolution.fromNumber,
        toNumber: resolution.toNumber,
        validFrom: resolution.validFrom,
        validUntil: resolution.validUntil,
      }
    : null;

  return {
    id: nanoid(),
    tenantId,
    source,
    sourceId,
    saleId,
    kind,
    requestedByUserId: userId,
    status,
    payload: {
      version: 1,
      requestedAt: completedAt,
      countryCode: locale.countryCode,
      providerId: adapter.providerId,
      siteId,
      buyerCustomerId: buyer.customerId,
      resolution: resolutionSnapshot,
      adapterInput,
      amounts,
      lines,
    },
    lastError,
    createdAt: completedAt,
  };
}

/** Insert the prepared intent in the caller's already-open write transaction. */
export function insertFiscalIntentInTransaction(
  tx: DatabaseInstance,
  intent: PreparedSaleFiscalIntent | null
): string | null {
  if (!intent) return null;
  const existing = tx
    .select({ id: fiscalEmissionIntents.id })
    .from(fiscalEmissionIntents)
    .where(
      and(
        eq(fiscalEmissionIntents.tenantId, intent.tenantId),
        eq(fiscalEmissionIntents.source, intent.source),
        eq(fiscalEmissionIntents.sourceId, intent.sourceId),
        eq(fiscalEmissionIntents.kind, intent.kind)
      )
    )
    .get();
  if (existing) return existing.id;

  tx.insert(fiscalEmissionIntents)
    .values({
      id: intent.id,
      tenantId: intent.tenantId,
      source: intent.source,
      sourceId: intent.sourceId,
      saleId: intent.saleId,
      kind: intent.kind,
      requestedByUserId: intent.requestedByUserId,
      status: intent.status,
      payload: intent.payload as unknown as Record<string, unknown>,
      payloadVersion: INTENT_PAYLOAD_VERSION,
      fiscalDocumentId: null,
      attempts: 0,
      nextRetryAt: null,
      lastError: intent.lastError,
      claimToken: null,
      lockedAt: null,
      createdAt: intent.createdAt,
      updatedAt: intent.createdAt,
    })
    .run();
  return intent.id;
}

function isIntentPayloadV1(value: unknown): value is FiscalEmissionIntentPayloadV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<FiscalEmissionIntentPayloadV1>;
  return (
    candidate.version === 1 &&
    typeof candidate.requestedAt === 'string' &&
    typeof candidate.countryCode === 'string' &&
    typeof candidate.providerId === 'string' &&
    typeof candidate.siteId === 'string' &&
    typeof candidate.adapterInput === 'object' &&
    candidate.adapterInput !== null &&
    typeof candidate.amounts === 'object' &&
    candidate.amounts !== null &&
    Array.isArray(candidate.lines)
  );
}

function readFiscalDocumentResult(
  db: DatabaseInstance,
  tenantId: string,
  fiscalDocumentId: string
): EmitFiscalDocumentResult | null {
  return (
    db
      .select({
        id: fiscalDocuments.id,
        cufe: fiscalDocuments.cufe,
        documentNumber: fiscalDocuments.documentNumber,
        status: fiscalDocuments.status,
      })
      .from(fiscalDocuments)
      .where(and(eq(fiscalDocuments.id, fiscalDocumentId), eq(fiscalDocuments.tenantId, tenantId)))
      .get() ?? null
  );
}

function materializeClaimedIntent(
  db: DatabaseInstance,
  row: FiscalEmissionIntentRow,
  claimToken: string
): EmitFiscalDocumentResult {
  if (row.payloadVersion !== INTENT_PAYLOAD_VERSION || !isIntentPayloadV1(row.payload)) {
    throw new Error('Unsupported or malformed fiscal intent payload');
  }
  const payload = row.payload;
  if (
    payload.adapterInput.tenantId !== row.tenantId ||
    payload.adapterInput.source !== row.source ||
    payload.adapterInput.sourceId !== row.sourceId ||
    payload.adapterInput.kind !== row.kind
  ) {
    throw new Error('Fiscal intent identity does not match its frozen payload');
  }
  const resolutionSnapshot = payload.resolution;
  if (!resolutionSnapshot) {
    throw new FiscalIntentBlockedError('numbering_resolution_missing');
  }
  if (payload.lines.length === 0) {
    throw new FiscalIntentBlockedError('sale_lines_missing');
  }

  return db.transaction(tx => {
    const duplicate = tx
      .select({
        id: fiscalDocuments.id,
        cufe: fiscalDocuments.cufe,
        documentNumber: fiscalDocuments.documentNumber,
        status: fiscalDocuments.status,
      })
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.tenantId, row.tenantId),
          eq(fiscalDocuments.source, row.source),
          eq(fiscalDocuments.sourceId, row.sourceId),
          eq(fiscalDocuments.kind, row.kind)
        )
      )
      .get();
    if (duplicate) {
      const linked = tx
        .update(fiscalEmissionIntents)
        .set({
          status: 'materialized',
          fiscalDocumentId: duplicate.id,
          claimToken: null,
          lockedAt: null,
          nextRetryAt: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(fiscalEmissionIntents.id, row.id),
            eq(fiscalEmissionIntents.tenantId, row.tenantId),
            eq(fiscalEmissionIntents.status, 'materializing'),
            eq(fiscalEmissionIntents.claimToken, claimToken)
          )
        )
        .run();
      if (linked.changes !== 1) throw new Error('Fiscal intent claim was lost');
      return duplicate;
    }

    const resolution = tx
      .select({
        id: fiscalNumberingResolutions.id,
        resolutionNumber: fiscalNumberingResolutions.resolutionNumber,
        prefix: fiscalNumberingResolutions.prefix,
        technicalKey: fiscalNumberingResolutions.technicalKey,
        fromNumber: fiscalNumberingResolutions.fromNumber,
        toNumber: fiscalNumberingResolutions.toNumber,
        currentNumber: fiscalNumberingResolutions.currentNumber,
        validFrom: fiscalNumberingResolutions.validFrom,
        validUntil: fiscalNumberingResolutions.validUntil,
        isActive: fiscalNumberingResolutions.isActive,
      })
      .from(fiscalNumberingResolutions)
      .where(
        and(
          eq(fiscalNumberingResolutions.id, resolutionSnapshot.id),
          eq(fiscalNumberingResolutions.tenantId, row.tenantId),
          eq(fiscalNumberingResolutions.siteId, payload.siteId),
          eq(fiscalNumberingResolutions.kind, row.kind)
        )
      )
      .get();
    if (!resolution) {
      throw new FiscalIntentBlockedError('numbering_resolution_missing', {
        resolutionId: resolutionSnapshot.id,
      });
    }
    if (
      !resolution.isActive ||
      resolution.resolutionNumber !== resolutionSnapshot.resolutionNumber ||
      resolution.prefix !== resolutionSnapshot.prefix ||
      resolution.technicalKey !== resolutionSnapshot.technicalKey ||
      resolution.fromNumber !== resolutionSnapshot.fromNumber ||
      resolution.toNumber !== resolutionSnapshot.toNumber ||
      resolution.validFrom !== resolutionSnapshot.validFrom ||
      resolution.validUntil !== resolutionSnapshot.validUntil
    ) {
      throw new FiscalIntentBlockedError('numbering_resolution_changed', {
        resolutionId: resolutionSnapshot.id,
      });
    }
    if (
      !resolutionIsEffectiveAt(
        payload.requestedAt,
        resolutionSnapshot.validFrom,
        resolutionSnapshot.validUntil
      )
    ) {
      throw new FiscalIntentBlockedError('numbering_resolution_not_effective', {
        resolutionId: resolutionSnapshot.id,
        requestedAt: payload.requestedAt,
        validFrom: resolutionSnapshot.validFrom,
        validUntil: resolutionSnapshot.validUntil,
      });
    }

    const headerTaxTotals = sumTaxTotals(payload.lines);
    assertFiscalTaxHeaderParity(payload.amounts.taxAmount, {
      ivaAmount: headerTaxTotals.ivaAmount,
      incAmount: headerTaxTotals.incAmount,
    });

    const consecutive = resolution.currentNumber + 1;
    if (consecutive < resolutionSnapshot.fromNumber || consecutive > resolutionSnapshot.toNumber) {
      throw new FiscalIntentBlockedError('numbering_resolution_exhausted', {
        resolutionId: resolutionSnapshot.id,
        currentNumber: resolution.currentNumber,
        fromNumber: resolutionSnapshot.fromNumber,
        toNumber: resolutionSnapshot.toNumber,
      });
    }
    const documentNumber = `${resolutionSnapshot.prefix}${consecutive
      .toString()
      .padStart(10, '0')}`;
    const originalDocument =
      row.kind === 'NC'
        ? tx
            .select({
              cufe: fiscalDocuments.cufe,
              customerId: fiscalDocuments.customerId,
              buyerTaxId: fiscalDocuments.buyerTaxId,
              buyerTaxIdTypeCode: fiscalDocuments.buyerTaxIdTypeCode,
              buyerName: fiscalDocuments.buyerName,
              buyerEmail: fiscalDocuments.buyerEmail,
              buyerAddress: fiscalDocuments.buyerAddress,
              buyerCity: fiscalDocuments.buyerCity,
              buyerDepartment: fiscalDocuments.buyerDepartment,
              buyerCountry: fiscalDocuments.buyerCountry,
              currencyCode: fiscalDocuments.currencyCode,
              localeCode: fiscalDocuments.localeCode,
              providerId: fiscalDocuments.providerId,
              status: fiscalDocuments.status,
            })
            .from(fiscalDocuments)
            .where(
              and(
                eq(fiscalDocuments.tenantId, row.tenantId),
                eq(fiscalDocuments.source, 'sale'),
                eq(fiscalDocuments.sourceId, row.saleId),
                eq(fiscalDocuments.kind, 'DEE')
              )
            )
            .get()
        : undefined;
    let originalCufe = payload.adapterInput.originalCufe;
    if (row.kind === 'NC') {
      if (!originalDocument || originalDocument.cufe.startsWith('pending-')) {
        throw new FiscalIntentDependencyPendingError('original_dee_not_accepted');
      }
      const originalProvider = originalDocument.providerId
        ? describeFiscalProvider(originalDocument.providerId)
        : null;
      // Mock/draft packs produce local evidence, not authority acceptance.
      // Only known non-certified packs may reference their emitted draft;
      // never relax the acceptance requirement for a certified/unknown pack.
      const localDraft =
        originalProvider &&
        originalProvider.maturity !== 'certified' &&
        (originalDocument.status === 'sent' || originalDocument.status === 'pending');
      if (originalDocument.status !== 'accepted' && !localDraft) {
        throw new FiscalIntentDependencyPendingError('original_dee_not_accepted');
      }
      if (originalCufe && originalCufe !== originalDocument.cufe) {
        throw new FiscalIntentBlockedError('original_dee_changed', {
          saleId: row.saleId,
        });
      }
      if (
        (originalProvider && originalProvider.countryCode !== payload.countryCode) ||
        originalDocument.providerId !== payload.providerId
      ) {
        throw new FiscalIntentBlockedError('original_dee_contract_changed', {
          saleId: row.saleId,
        });
      }
      originalCufe = originalDocument.cufe;
    }
    const adapterInput: FiscalAdapterIssueInput = {
      ...payload.adapterInput,
      originalCufe,
      // A credit note references immutable fiscal evidence, never a customer's
      // current catalog record or a later tenant currency change.
      buyer: originalDocument
        ? {
            taxId: originalDocument.buyerTaxId,
            taxIdTypeCode: originalDocument.buyerTaxIdTypeCode,
            name: originalDocument.buyerName,
            email: originalDocument.buyerEmail,
            address: originalDocument.buyerAddress,
            city: originalDocument.buyerCity,
            department: originalDocument.buyerDepartment,
            country: originalDocument.buyerCountry,
          }
        : payload.adapterInput.buyer,
      currencyCode: originalDocument?.currencyCode ?? payload.adapterInput.currencyCode,
      localeCode: originalDocument?.localeCode ?? payload.adapterInput.localeCode,
      resolution: {
        id: resolutionSnapshot.id,
        resolutionNumber: resolutionSnapshot.resolutionNumber,
        prefix: resolutionSnapshot.prefix,
        technicalKey: resolutionSnapshot.technicalKey,
        consecutive,
        documentNumber,
      },
    };
    if (payload.countryCode === 'CL') {
      const buyerHasRut =
        !!adapterInput.buyer.taxId && adapterInput.buyer.taxId !== CONSUMIDOR_FINAL.taxId;
      const tipoDte = mapInternalKindToTipoDte(row.source, buyerHasRut);
      const allocation = allocateNextFolio(tx, { tenantId: row.tenantId, tipoDte });
      adapterInput.chileAllocation = {
        cafId: allocation.cafId,
        folio: allocation.folio,
        tipoDte: allocation.tipoDte,
        rutEmisor: allocation.rutEmisor,
        rawCafXml: allocation.rawCafXml,
        rangeRemaining: allocation.rangeRemaining,
      };
    }

    const fiscalDocumentId = nanoid();
    const placeholderCufe = `pending-${nanoid(40)}`;
    const now = new Date().toISOString();
    const buyer = adapterInput.buyer;
    tx.insert(fiscalDocuments)
      .values({
        id: fiscalDocumentId,
        tenantId: row.tenantId,
        source: row.source,
        sourceId: row.sourceId,
        kind: row.kind,
        resolutionId: resolutionSnapshot.id,
        consecutive,
        documentNumber,
        cufe: placeholderCufe,
        status: 'pending',
        customerId: originalDocument ? originalDocument.customerId : payload.buyerCustomerId,
        buyerTaxId: buyer.taxId,
        buyerTaxIdTypeCode: buyer.taxIdTypeCode,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        buyerAddress: buyer.address,
        buyerCity: buyer.city,
        buyerDepartment: buyer.department,
        buyerCountry: buyer.country,
        subtotal: payload.amounts.subtotal,
        taxAmount: payload.amounts.taxAmount,
        discountAmount: payload.amounts.discountAmount,
        totalAmount: payload.amounts.total,
        currencyCode: adapterInput.currencyCode,
        localeCode: adapterInput.localeCode,
        originalCufe: adapterInput.originalCufe ?? null,
        reasonCode: payload.adapterInput.reasonCode ?? null,
        providerId: payload.providerId,
        providerResponse: null,
        xmlRef: null,
        retries: 0,
        emittedByUserId: row.requestedByUserId,
        emittedAt: payload.requestedAt,
        updatedAt: now,
      })
      .run();

    for (const line of payload.lines) {
      const fiscalDocumentItemId = nanoid();
      tx.insert(fiscalDocumentItems)
        .values({ id: fiscalDocumentItemId, ...toDocumentItemValues(fiscalDocumentId, line) })
        .run();
      for (const component of getResolvedLineTaxComponents(line)) {
        tx.insert(fiscalDocumentItemTaxComponents)
          .values({
            id: nanoid(),
            ...toDocumentTaxComponentValues(row.tenantId, fiscalDocumentItemId, component),
            createdAt: now,
          })
          .run();
      }
    }

    const advanced = tx
      .update(fiscalNumberingResolutions)
      .set({ currentNumber: consecutive, updatedAt: now })
      .where(
        and(
          eq(fiscalNumberingResolutions.id, resolution.id),
          eq(fiscalNumberingResolutions.tenantId, row.tenantId),
          eq(fiscalNumberingResolutions.siteId, payload.siteId),
          eq(fiscalNumberingResolutions.kind, row.kind),
          eq(fiscalNumberingResolutions.currentNumber, resolution.currentNumber)
        )
      )
      .run();
    if (advanced.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'FISCAL_SEQUENTIAL_NOT_ADVANCED',
        message: 'Fiscal numbering resolution was not advanced',
        details: { resolutionId: resolution.id, tenantId: row.tenantId, kind: row.kind },
      });
    }

    tx.insert(fiscalOutbox)
      .values({
        id: nanoid(),
        tenantId: row.tenantId,
        status: 'queued',
        kind: 'emit',
        fiscalDocumentId,
        providerId: payload.providerId,
        cufe: null,
        payload: {
          countryCode: payload.countryCode,
          providerId: payload.providerId,
          fiscalDocumentId,
          adapterInput,
        },
        payloadVersion: 1,
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        priority: 0,
        claimToken: null,
        lockedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const completed = tx
      .update(fiscalEmissionIntents)
      .set({
        status: 'materialized',
        fiscalDocumentId,
        claimToken: null,
        lockedAt: null,
        nextRetryAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(fiscalEmissionIntents.id, row.id),
          eq(fiscalEmissionIntents.tenantId, row.tenantId),
          eq(fiscalEmissionIntents.status, 'materializing'),
          eq(fiscalEmissionIntents.claimToken, claimToken)
        )
      )
      .run();
    if (completed.changes !== 1) throw new Error('Fiscal intent claim was lost');

    return { id: fiscalDocumentId, cufe: placeholderCufe, documentNumber, status: 'pending' };
  });
}

function retryDelayMs(attempts: number): number {
  return Math.min(MATERIALIZATION_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), 60_000);
}

function safeMaterializationError(error: unknown): Record<string, unknown> {
  if (error instanceof FiscalIntentDependencyPendingError) {
    return {
      code: 'FISCAL_INTENT_DEPENDENCY_PENDING',
      reason: error.reason,
    };
  }
  return {
    code: 'FISCAL_INTENT_MATERIALIZATION_FAILED',
    message: error instanceof Error ? error.message.slice(0, 500) : 'Unknown materialization error',
  };
}

async function validateFrozenAdapterContract(row: FiscalEmissionIntentRow): Promise<void> {
  if (row.payloadVersion !== INTENT_PAYLOAD_VERSION || !isIntentPayloadV1(row.payload)) return;
  const payload = row.payload;
  const adapter = getFiscalAdapter(payload.countryCode);
  if (adapter.providerId !== payload.providerId) {
    throw new FiscalIntentBlockedError('fiscal_provider_changed', {
      expectedProviderId: payload.providerId,
    });
  }
  const validation = await adapter.validateConfig({
    tenantId: row.tenantId,
    countryCode: payload.countryCode,
    settings: payload.adapterInput.tenantSettings ?? {},
  });
  if (!validation.ok) {
    throw new FiscalIntentBlockedError('adapter_configuration_invalid', validation.issues);
  }
}

/** Claim and materialize one exact intent. Safe under concurrent worker ticks. */
export async function materializeFiscalEmissionIntent(args: {
  db: DatabaseInstance;
  tenantId: string;
  intentId: string;
  log: Pick<PuntovivoLogger, 'warn' | 'debug'>;
}): Promise<EmitFiscalDocumentResult | null> {
  const existing = await args.db
    .select()
    .from(fiscalEmissionIntents)
    .where(
      and(
        eq(fiscalEmissionIntents.id, args.intentId),
        eq(fiscalEmissionIntents.tenantId, args.tenantId)
      )
    )
    .get();
  if (!existing) return null;
  if (existing.status === 'materialized' && existing.fiscalDocumentId) {
    return readFiscalDocumentResult(args.db, args.tenantId, existing.fiscalDocumentId);
  }
  if (existing.status === 'blocked' || existing.status === 'dead_letter') return null;

  const now = new Date().toISOString();
  if (existing.status === 'retrying' && existing.nextRetryAt && existing.nextRetryAt > now) {
    return null;
  }
  const claimToken = nanoid();
  const claimed = await args.db
    .update(fiscalEmissionIntents)
    .set({ status: 'materializing', claimToken, lockedAt: now, updatedAt: now })
    .where(
      and(
        eq(fiscalEmissionIntents.id, existing.id),
        eq(fiscalEmissionIntents.tenantId, existing.tenantId),
        or(
          eq(fiscalEmissionIntents.status, 'queued'),
          eq(fiscalEmissionIntents.status, 'retrying')
        ),
        isNull(fiscalEmissionIntents.claimToken)
      )
    )
    .run();
  if (claimed.changes !== 1) return null;

  try {
    // A manual re-arm never substitutes live tenant configuration or a new
    // provider. Validate the exact frozen contract before allocating a number.
    await validateFrozenAdapterContract(existing);
    return materializeClaimedIntent(args.db, existing, claimToken);
  } catch (error) {
    if (error instanceof FiscalIntentBlockedError) {
      const blockedAt = new Date().toISOString();
      await args.db
        .update(fiscalEmissionIntents)
        .set({
          status: 'blocked',
          nextRetryAt: null,
          lastError: blockedError(error.reason, error.details),
          claimToken: null,
          lockedAt: null,
          updatedAt: blockedAt,
        })
        .where(
          and(
            eq(fiscalEmissionIntents.id, existing.id),
            eq(fiscalEmissionIntents.tenantId, existing.tenantId),
            eq(fiscalEmissionIntents.status, 'materializing'),
            eq(fiscalEmissionIntents.claimToken, claimToken)
          )
        )
        .run();
      args.log.warn(
        {
          tenantId: existing.tenantId,
          intentId: existing.id,
          reason: error.reason,
        },
        'fiscal intent requires operator intervention'
      );
      return null;
    }
    // Waiting for the original document is not a transient execution failure.
    // Keep it visible and retry at a bounded pace without exhausting attempts.
    const dependencyPending = error instanceof FiscalIntentDependencyPendingError;
    const attempts = existing.attempts + (dependencyPending ? 0 : 1);
    const terminal = !dependencyPending && attempts >= MAX_MATERIALIZATION_ATTEMPTS;
    const failedAt = new Date().toISOString();
    await args.db
      .update(fiscalEmissionIntents)
      .set({
        status: terminal ? 'dead_letter' : 'retrying',
        attempts,
        nextRetryAt: terminal
          ? null
          : new Date(
              Date.now() + (dependencyPending ? 60_000 : retryDelayMs(attempts))
            ).toISOString(),
        lastError: safeMaterializationError(error),
        claimToken: null,
        lockedAt: null,
        updatedAt: failedAt,
      })
      .where(
        and(
          eq(fiscalEmissionIntents.id, existing.id),
          eq(fiscalEmissionIntents.tenantId, existing.tenantId),
          eq(fiscalEmissionIntents.status, 'materializing'),
          eq(fiscalEmissionIntents.claimToken, claimToken)
        )
      )
      .run();
    args.log.warn(
      { err: error, tenantId: existing.tenantId, intentId: existing.id, attempts },
      'fiscal intent materialization failed'
    );
    return null;
  }
}

/** Materialize the oldest eligible intent for a tenant, if any. */
export async function materializeNextFiscalEmissionIntent(args: {
  db: DatabaseInstance;
  tenantId: string;
  log: Pick<PuntovivoLogger, 'warn' | 'debug'>;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const candidate = await args.db
    .select({ id: fiscalEmissionIntents.id })
    .from(fiscalEmissionIntents)
    .where(
      and(
        eq(fiscalEmissionIntents.tenantId, args.tenantId),
        or(
          eq(fiscalEmissionIntents.status, 'queued'),
          and(
            eq(fiscalEmissionIntents.status, 'retrying'),
            or(
              isNull(fiscalEmissionIntents.nextRetryAt),
              lte(fiscalEmissionIntents.nextRetryAt, now)
            )
          )
        ),
        isNull(fiscalEmissionIntents.claimToken)
      )
    )
    .orderBy(fiscalEmissionIntents.createdAt)
    .get();
  if (!candidate) return false;
  await materializeFiscalEmissionIntent({ ...args, intentId: candidate.id });
  return true;
}

/** Reclaim a process that died while materializing a local intent. */
export async function sweepStaleFiscalIntentClaims(
  db: DatabaseInstance,
  cutoffIso: string
): Promise<void> {
  await db
    .update(fiscalEmissionIntents)
    .set({
      status: 'queued',
      claimToken: null,
      lockedAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(fiscalEmissionIntents.status, 'materializing'),
        lte(fiscalEmissionIntents.lockedAt, cutoffIso)
      )
    );
}

/** Resolve the intent id created by a completed-sale transaction. */
export async function findSaleFiscalIntentId(
  db: DatabaseInstance,
  tenantId: string,
  saleId: string
): Promise<string | null> {
  const row = await db
    .select({ id: fiscalEmissionIntents.id })
    .from(fiscalEmissionIntents)
    .where(
      and(
        eq(fiscalEmissionIntents.tenantId, tenantId),
        eq(fiscalEmissionIntents.source, 'sale'),
        eq(fiscalEmissionIntents.sourceId, saleId),
        eq(fiscalEmissionIntents.kind, 'DEE')
      )
    )
    .get();
  return row?.id ?? null;
}
