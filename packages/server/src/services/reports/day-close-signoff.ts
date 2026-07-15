/**
 * ENG-141b — immutable manager sign-off for the comprehensive day close.
 *
 * One row is allowed per tenant business date. The service freezes the exact
 * report presented to the manager, hashes its canonical JSON representation,
 * and writes the sign-off plus its audit row in one immediate SQLite
 * transaction. Reads verify both the schema and hash before returning legal
 * evidence to the UI.
 */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { DAY_CLOSE_SIGNOFF_SCHEMA_VERSION, dayCloseSignoffs, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../audit-logs.js';
import { hashCanonicalInput } from '../idempotency/keyHasher.js';
import {
  comprehensiveDayCloseReportOutput,
  type DayCloseSignoffMetadataOutput,
  type DayCloseSignoffOutput,
} from '../../trpc/schemas/reports.js';
import { computeComprehensiveDayCloseReport } from './comprehensive-day-close.js';

interface SignDayCloseInput {
  tenantId: string;
  actorId: string;
  date: string;
  operationId: string;
  now?: Date;
}

const signoffSelection = {
  id: dayCloseSignoffs.id,
  businessDate: dayCloseSignoffs.businessDate,
  schemaVersion: dayCloseSignoffs.schemaVersion,
  timeZone: dayCloseSignoffs.timeZone,
  currencyCode: dayCloseSignoffs.currencyCode,
  reportSnapshot: dayCloseSignoffs.reportSnapshot,
  reportHash: dayCloseSignoffs.reportHash,
  signedByUserId: dayCloseSignoffs.signedByUserId,
  signedByName: dayCloseSignoffs.signedByName,
  signedAt: dayCloseSignoffs.signedAt,
} as const;

type SignoffRow = {
  id: string;
  businessDate: string;
  schemaVersion: number;
  timeZone: string;
  currencyCode: string;
  reportSnapshot: Record<string, unknown>;
  reportHash: string;
  signedByUserId: string;
  signedByName: string;
  signedAt: string;
};

function throwAlreadySigned(date: string, signoffId?: string): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'DAY_CLOSE_ALREADY_SIGNED',
    message: 'The business day already has an immutable manager sign-off',
    details: { date, ...(signoffId ? { signoffId } : {}) },
  });
}

function throwIntegrityFailed(row: Pick<SignoffRow, 'id' | 'businessDate'>): never {
  return throwServerError({
    trpcCode: 'INTERNAL_SERVER_ERROR',
    errorCode: 'DAY_CLOSE_SIGNOFF_INTEGRITY_FAILED',
    message: 'The signed day-close snapshot failed schema or hash verification',
    details: { signoffId: row.id, date: row.businessDate },
  });
}

function metadataFromRow(row: SignoffRow): DayCloseSignoffMetadataOutput {
  if (row.schemaVersion !== DAY_CLOSE_SIGNOFF_SCHEMA_VERSION) {
    throwIntegrityFailed(row);
  }
  return {
    id: row.id,
    date: row.businessDate,
    schemaVersion: DAY_CLOSE_SIGNOFF_SCHEMA_VERSION,
    timeZone: row.timeZone,
    currencyCode: row.currencyCode,
    reportHash: row.reportHash,
    signedAt: row.signedAt,
    signedBy: { id: row.signedByUserId, name: row.signedByName },
  };
}

function presentVerifiedSignoff(row: SignoffRow): DayCloseSignoffOutput {
  if (hashCanonicalInput(row.reportSnapshot) !== row.reportHash) {
    throwIntegrityFailed(row);
  }
  const parsedReport = comprehensiveDayCloseReportOutput.safeParse(row.reportSnapshot);
  if (!parsedReport.success) {
    throwIntegrityFailed(row);
  }
  const metadata = metadataFromRow(row);
  if (
    parsedReport.data.date !== metadata.date ||
    parsedReport.data.timeZone !== metadata.timeZone ||
    parsedReport.data.currencyCode !== metadata.currencyCode
  ) {
    throwIntegrityFailed(row);
  }
  return { ...metadata, report: parsedReport.data };
}

function findSignoffRow(
  db: DatabaseInstance,
  tenantId: string,
  date: string
): SignoffRow | undefined {
  return db
    .select(signoffSelection)
    .from(dayCloseSignoffs)
    .where(and(eq(dayCloseSignoffs.tenantId, tenantId), eq(dayCloseSignoffs.businessDate, date)))
    .get();
}

export function getDayCloseSignoff(
  db: DatabaseInstance,
  tenantId: string,
  date: string
): DayCloseSignoffOutput | null {
  const row = findSignoffRow(db, tenantId, date);
  return row ? presentVerifiedSignoff(row) : null;
}

function isDayCloseUniqueConstraint(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    typeof candidate.message === 'string' &&
    candidate.message.includes('day_close_signoffs.tenant_id') &&
    candidate.message.includes('day_close_signoffs.business_date')
  );
}

export async function signDayClose(
  db: DatabaseInstance,
  input: SignDayCloseInput
): Promise<DayCloseSignoffMetadataOutput> {
  const existing = findSignoffRow(db, input.tenantId, input.date);
  if (existing) throwAlreadySigned(input.date, existing.id);

  const signer = db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.id, input.actorId), eq(users.tenantId, input.tenantId)))
    .get();
  if (!signer) {
    throwServerError({
      trpcCode: 'UNAUTHORIZED',
      errorCode: 'AUTH_USER_NOT_FOUND',
      message: 'The authenticated signer no longer exists in this tenant',
    });
  }

  const report = await computeComprehensiveDayCloseReport(db, {
    tenantId: input.tenantId,
    date: input.date,
    ...(input.now ? { now: input.now } : {}),
  });
  if (!report.readiness.readyToSign) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'DAY_CLOSE_NOT_READY',
      message: 'The day-close report still has blocking reconciliation items',
      details: { date: input.date, blockers: report.readiness.blockers },
    });
  }

  const id = nanoid();
  const signedAt = (input.now ?? new Date()).toISOString();
  const reportSnapshot = report as unknown as Record<string, unknown>;
  const reportHash = hashCanonicalInput(reportSnapshot);
  const row: SignoffRow = {
    id,
    businessDate: input.date,
    schemaVersion: DAY_CLOSE_SIGNOFF_SCHEMA_VERSION,
    timeZone: report.timeZone,
    currencyCode: report.currencyCode,
    reportSnapshot,
    reportHash,
    signedByUserId: signer.id,
    signedByName: signer.name,
    signedAt,
  };

  try {
    db.transaction(
      tx => {
        const concurrent = findSignoffRow(tx, input.tenantId, input.date);
        if (concurrent) throwAlreadySigned(input.date, concurrent.id);

        tx.insert(dayCloseSignoffs)
          .values({
            ...row,
            tenantId: input.tenantId,
          })
          .run();

        writeAuditLog({
          tx,
          tenantId: input.tenantId,
          actorId: signer.id,
          action: 'day_close.sign_off',
          resourceType: 'day_close_signoff',
          resourceId: id,
          before: null,
          after: {
            businessDate: input.date,
            schemaVersion: DAY_CLOSE_SIGNOFF_SCHEMA_VERSION,
            timeZone: report.timeZone,
            currencyCode: report.currencyCode,
            reportHash,
            signedAt,
          },
          metadata: { attestationAccepted: true },
          operationId: input.operationId,
        });
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    if (isDayCloseUniqueConstraint(error)) throwAlreadySigned(input.date);
    throw error;
  }

  return metadataFromRow(row);
}
