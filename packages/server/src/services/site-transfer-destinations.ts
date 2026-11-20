/**
 * Site transfer destinations: the Bre-B keys, wallet numbers and bank
 * accounts a site shows customers who pay by transfer. Admins edit them;
 * registers read them with a QR payload for the amount being charged.
 *
 * @module services/site-transfer-destinations
 */
import {
  buildTransferQr,
  defaultTransferLabel,
  formatTransferAccount,
  isEmvcoQrPayload,
  normalizeTransferAccount,
  type TransferQr,
  type TransferQrDestination,
  type TransferQrLocale,
} from '@puntovivo/shared/transfer-destinations';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../db/index.js';
import {
  MAX_SITE_TRANSFER_DESTINATIONS,
  siteTransferDestinations,
  type BankAccountType,
  type TransferDestinationKind,
} from '../db/schema.js';
import { resolveTenantCurrency } from '../lib/currency.js';
import { throwServerError } from '../lib/errorCodes.js';
import { writeAuditLog } from './audit-logs.js';

type Transaction = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];
type Reader = DatabaseInstance | Transaction;

export interface TransferDestinationScope {
  tenantId: string;
  siteId: string;
  userId: string;
}

export interface TransferDestinationInput {
  id?: string | undefined;
  kind: TransferDestinationKind;
  label?: string | null | undefined;
  account: string;
  bankName?: string | null | undefined;
  accountType?: BankAccountType | null | undefined;
  holderName?: string | null | undefined;
  holderId?: string | null | undefined;
  qrPayload?: string | null | undefined;
}

export type TransferDestinationRow = TransferQrDestination & {
  id: string;
  position: number;
  label: string;
};

/** What the register and the customer display show; never internal ids beyond the row's own. */
export interface ChargeTransferDestination {
  id: string;
  kind: TransferDestinationKind;
  label: string;
  account: string;
  holderName: string | null;
  qr: TransferQr;
}

const inSite = (tenantId: string, siteId: string) =>
  and(eq(siteTransferDestinations.tenantId, tenantId), eq(siteTransferDestinations.siteId, siteId));

const columns = {
  id: siteTransferDestinations.id,
  position: siteTransferDestinations.position,
  kind: siteTransferDestinations.kind,
  label: siteTransferDestinations.label,
  account: siteTransferDestinations.account,
  bankName: siteTransferDestinations.bankName,
  accountType: siteTransferDestinations.accountType,
  holderName: siteTransferDestinations.holderName,
  holderId: siteTransferDestinations.holderId,
  qrPayload: siteTransferDestinations.qrPayload,
};

export function listSiteTransferDestinations(
  db: Reader,
  tenantId: string,
  siteId: string
): TransferDestinationRow[] {
  return db
    .select(columns)
    .from(siteTransferDestinations)
    .where(inSite(tenantId, siteId))
    .orderBy(asc(siteTransferDestinations.position))
    .all();
}

const blankToNull = (value: string | null | undefined) => value?.trim() || null;

type StoredFields = Omit<TransferDestinationRow, 'id' | 'position'>;

/** Validates and canonicalises an edit; bank fields only belong to bank accounts. */
function resolveFields(input: TransferDestinationInput): StoredFields {
  const account = normalizeTransferAccount(input.kind, input.account);
  if (!account) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_DESTINATION_ACCOUNT_INVALID',
      message: `The account is not valid for ${input.kind}`,
      details: { kind: input.kind },
    });
  }
  const isBank = input.kind === 'bank_account';
  const bankName = isBank ? blankToNull(input.bankName) : null;
  const accountType = isBank ? (input.accountType ?? null) : null;
  if (isBank && (!bankName || !accountType)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_DESTINATION_BANK_REQUIRED',
      message: 'A bank account needs the bank name and the account type',
    });
  }
  const qrPayload = blankToNull(input.qrPayload);
  if (qrPayload && !isEmvcoQrPayload(qrPayload)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_DESTINATION_QR_INVALID',
      message: 'The QR content is not a complete bank QR',
    });
  }
  return {
    kind: input.kind,
    label: blankToNull(input.label) ?? defaultTransferLabel(input.kind, bankName),
    account,
    bankName,
    accountType,
    holderName: blankToNull(input.holderName),
    holderId: blankToNull(input.holderId),
    qrPayload,
  };
}

const notFound = (): never =>
  throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'TRANSFER_DESTINATION_NOT_FOUND',
    message: 'Transfer destination not found',
  });

/**
 * Creates a destination at the end of the list, or replaces every field of
 * the one `id` names. Returns the site's destinations in order.
 */
export function setSiteTransferDestination(
  db: DatabaseInstance,
  scope: TransferDestinationScope,
  input: TransferDestinationInput
): TransferDestinationRow[] {
  const fields = resolveFields(input);

  db.transaction(tx => {
    const rows = listSiteTransferDestinations(tx, scope.tenantId, scope.siteId);
    if (
      rows.some(
        row => row.id !== input.id && row.kind === fields.kind && row.account === fields.account
      )
    ) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'TRANSFER_DESTINATION_DUPLICATE',
        message: 'This site already has this destination',
      });
    }
    const now = new Date().toISOString();
    const audit = {
      tx,
      tenantId: scope.tenantId,
      actorId: scope.userId,
      resourceType: 'transfer_destination' as const,
      metadata: { siteId: scope.siteId },
    };

    if (input.id) {
      const existing = rows.find(row => row.id === input.id) ?? notFound();
      tx.update(siteTransferDestinations)
        .set({ ...fields, updatedAt: now, updatedBy: scope.userId })
        .where(
          and(eq(siteTransferDestinations.id, existing.id), inSite(scope.tenantId, scope.siteId))
        )
        .run();
      writeAuditLog({
        ...audit,
        action: 'transfer_destination.update',
        resourceId: existing.id,
        before: { ...existing },
        after: { ...existing, ...fields },
      });
      return;
    }

    if (rows.length >= MAX_SITE_TRANSFER_DESTINATIONS) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_DESTINATION_LIMIT_REACHED',
        message: `A site can have at most ${MAX_SITE_TRANSFER_DESTINATIONS} transfer destinations`,
        details: { max: MAX_SITE_TRANSFER_DESTINATIONS },
      });
    }
    const id = nanoid();
    const position = (rows.at(-1)?.position ?? -1) + 1;
    tx.insert(siteTransferDestinations)
      .values({
        id,
        tenantId: scope.tenantId,
        siteId: scope.siteId,
        position,
        ...fields,
        createdBy: scope.userId,
        updatedBy: scope.userId,
      })
      .run();
    writeAuditLog({
      ...audit,
      action: 'transfer_destination.create',
      resourceId: id,
      after: { id, position, ...fields },
    });
  });

  return listSiteTransferDestinations(db, scope.tenantId, scope.siteId);
}

/** `ids` must list every destination of the site exactly once, in the new order. */
export function reorderSiteTransferDestinations(
  db: DatabaseInstance,
  scope: TransferDestinationScope,
  ids: readonly string[]
): TransferDestinationRow[] {
  db.transaction(tx => {
    const rows = listSiteTransferDestinations(tx, scope.tenantId, scope.siteId);
    const sameSet =
      ids.length === rows.length &&
      new Set(ids).size === ids.length &&
      rows.every(row => ids.includes(row.id));
    if (!sameSet) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_DESTINATION_ORDER_INVALID',
        message: 'The new order must list every destination of the site once',
      });
    }
    const current = new Map(rows.map(row => [row.id, row.position]));
    const now = new Date().toISOString();
    ids.forEach((id, position) => {
      if (current.get(id) === position) return;
      tx.update(siteTransferDestinations)
        .set({ position, updatedAt: now, updatedBy: scope.userId })
        .where(and(eq(siteTransferDestinations.id, id), inSite(scope.tenantId, scope.siteId)))
        .run();
    });
  });
  return listSiteTransferDestinations(db, scope.tenantId, scope.siteId);
}

export function removeSiteTransferDestination(
  db: DatabaseInstance,
  scope: TransferDestinationScope,
  id: string
): TransferDestinationRow[] {
  db.transaction(tx => {
    const deleted =
      tx
        .delete(siteTransferDestinations)
        .where(and(eq(siteTransferDestinations.id, id), inSite(scope.tenantId, scope.siteId)))
        .returning(columns)
        .get() ?? notFound();
    tx.update(siteTransferDestinations)
      .set({
        position: sql`${siteTransferDestinations.position} - 1`,
        updatedAt: new Date().toISOString(),
        updatedBy: scope.userId,
      })
      .where(
        and(
          inSite(scope.tenantId, scope.siteId),
          gt(siteTransferDestinations.position, deleted.position)
        )
      )
      .run();
    writeAuditLog({
      tx,
      tenantId: scope.tenantId,
      actorId: scope.userId,
      action: 'transfer_destination.delete',
      resourceType: 'transfer_destination',
      resourceId: id,
      before: { ...deleted },
      metadata: { siteId: scope.siteId },
    });
  });
  return listSiteTransferDestinations(db, scope.tenantId, scope.siteId);
}

/**
 * The site's destinations as the register charges `amount`: label, readable
 * account and the QR to show. Payment is still confirmed by hand.
 */
export function listChargeTransferDestinations(
  db: DatabaseInstance,
  args: { tenantId: string; siteId: string; amount: number | null; locale: TransferQrLocale }
): { currency: string; destinations: ChargeTransferDestination[] } {
  const currency = resolveTenantCurrency(db, args.tenantId);
  const destinations = listSiteTransferDestinations(db, args.tenantId, args.siteId).map(row => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    account: formatTransferAccount(row.account),
    holderName: row.holderName,
    qr: buildTransferQr(row, { amount: args.amount, currency, locale: args.locale }),
  }));
  return { currency, destinations };
}
