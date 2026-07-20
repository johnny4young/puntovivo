/**
 * Customer privacy disposition planning primitives.
 *
 * A customer can be physically deleted only when no operational record keeps
 * a foreign-key reference. Otherwise the mutable profile is anonymized while
 * fiscal and financial evidence remains intact under its original retention
 * obligations.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  customerLedgerEntries,
  customers,
  deliveryOrders,
  fiscalDocuments,
  quotations,
  sales,
} from '../../db/schema.js';

export const ANONYMIZED_CUSTOMER_NAME = '—';

export const CUSTOMER_PRIVACY_DISPOSITIONS = ['delete', 'anonymize'] as const;
export type CustomerPrivacyDisposition = (typeof CUSTOMER_PRIVACY_DISPOSITIONS)[number];

export interface CustomerPrivacyLinkedRecordCounts {
  sales: number;
  quotations: number;
  ledgerEntries: number;
  deliveryOrders: number;
  fiscalDocuments: number;
}

function countLinkedRows(
  db: DatabaseInstance,
  table:
    | typeof sales
    | typeof quotations
    | typeof customerLedgerEntries
    | typeof deliveryOrders
    | typeof fiscalDocuments,
  tenantId: string,
  customerId: string
) {
  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(and(eq(table.tenantId, tenantId), eq(table.customerId, customerId)))
      .get()?.count ?? 0
  );
}

export function getCustomerPrivacyLinkedRecordCounts(
  db: DatabaseInstance,
  tenantId: string,
  customerId: string
): CustomerPrivacyLinkedRecordCounts {
  return {
    sales: countLinkedRows(db, sales, tenantId, customerId),
    quotations: countLinkedRows(db, quotations, tenantId, customerId),
    ledgerEntries: countLinkedRows(db, customerLedgerEntries, tenantId, customerId),
    deliveryOrders: countLinkedRows(db, deliveryOrders, tenantId, customerId),
    fiscalDocuments: countLinkedRows(db, fiscalDocuments, tenantId, customerId),
  };
}

export function getCustomerPrivacyDispositionPreview(
  db: DatabaseInstance,
  tenantId: string,
  customerId: string
) {
  const customer = db
    .select({
      id: customers.id,
      name: customers.name,
      version: customers.version,
      syncVersion: customers.syncVersion,
      privacyStatus: customers.privacyStatus,
    })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)))
    .get();

  if (!customer) {
    return null;
  }

  const linkedRecordCounts = getCustomerPrivacyLinkedRecordCounts(db, tenantId, customerId);
  const totalLinkedRecords = Object.values(linkedRecordCounts).reduce(
    (total, count) => total + count,
    0
  );
  const disposition: CustomerPrivacyDisposition = totalLinkedRecords === 0 ? 'delete' : 'anonymize';

  return {
    customer,
    disposition,
    linkedRecordCounts,
    totalLinkedRecords,
    retentionReason: disposition === 'anonymize' ? ('linked_records' as const) : null,
  };
}

export type CustomerPrivacyDispositionPreview = NonNullable<
  ReturnType<typeof getCustomerPrivacyDispositionPreview>
>;
