/** Canonical employment-contract evidence frozen into immutable pre-payroll sources. */
import { z } from 'zod';
import type { EmploymentContractRow } from '../../db/schema.js';

const contractPay = z.discriminatedUnion('basis', [
  z.object({ basis: z.literal('hourly'), amount: z.number().finite().nonnegative() }).strict(),
  z
    .object({
      basis: z.literal('monthly'),
      amount: z.number().finite().nonnegative(),
      costingHourlyRate: z.number().finite().nonnegative().nullable(),
    })
    .strict(),
]);

export const payrollContractEvidenceSchema = z
  .object({
    terms: z
      .object({
        userId: z.string().min(1),
        siteId: z.string().min(1),
        position: z.string().min(1),
        effectiveFrom: z.iso.date(),
        effectiveUntil: z.iso.date().nullable(),
        currencyCode: z.string().length(3),
        pay: contractPay,
      })
      .strict(),
    timeZone: z.string().min(1),
    version: z.number().int().positive(),
    voidedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type PayrollContractEvidence = z.infer<typeof payrollContractEvidenceSchema>;

/** Freeze exactly the contract facts that can influence payroll or its provenance. */
export function freezePayrollContract(row: EmploymentContractRow): PayrollContractEvidence {
  return {
    terms: {
      userId: row.userId,
      siteId: row.siteId,
      position: row.position,
      effectiveFrom: row.effectiveFrom,
      effectiveUntil: row.effectiveUntil,
      currencyCode: row.currencyCode,
      pay:
        row.payBasis === 'hourly'
          ? { basis: 'hourly', amount: row.payAmount }
          : {
              basis: 'monthly',
              amount: row.payAmount,
              costingHourlyRate: row.costingHourlyRate,
            },
    },
    timeZone: row.timeZone,
    version: row.version,
    voidedAt: row.voidedAt,
  };
}

/** Validate persisted JSON before an adjustment is allowed to consume frozen authority. */
export function parsePayrollContractEvidence(value: unknown): PayrollContractEvidence | null {
  const parsed = payrollContractEvidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
