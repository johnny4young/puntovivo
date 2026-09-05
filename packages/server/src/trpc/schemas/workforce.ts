/** Bounded effective employment contracts; amounts remain administrator-only. */
import { z } from 'zod';
import {
  employmentContractTermsSchema,
  workforceDateSchema,
} from '../../services/labor/employment-contract.js';

const identifier = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(10).max(500);
const target = z
  .object({
    id: identifier,
    siteId: identifier,
    expectedVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    reason,
  })
  .strict();

export const createEmploymentContractInput = z
  .object({ terms: employmentContractTermsSchema, reason })
  .strict();
export const endEmploymentContractInput = target.extend({ effectiveUntil: workforceDateSchema });
export const voidEmploymentContractInput = target;
export const replaceEmploymentContractInput = target.extend({
  terms: employmentContractTermsSchema,
});
export const getEmploymentContractInput = z.object({ id: identifier, siteId: identifier }).strict();
export const listEmploymentAssignmentsInput = z
  .object({
    siteId: identifier.optional(),
    userId: identifier.optional(),
    onDate: workforceDateSchema.optional(),
    cursor: z.object({ effectiveFrom: workforceDateSchema, id: identifier }).strict().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export const listEmploymentContractsInput = listEmploymentAssignmentsInput.extend({
  includeVoided: z.boolean().default(false),
});
export const listEmploymentContractEventsInput = getEmploymentContractInput.extend({
  beforeVersion: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

/** Optimistic target; the reason is private evidence, not a generic log message. */
export type EmploymentContractTarget = z.infer<typeof target>;
/** Manager-safe page of effective assignments without compensation or private history. */
export type ListEmploymentAssignmentsInput = z.infer<typeof listEmploymentAssignmentsInput>;
/** Administrator-only page with explicit inclusion of corrected/voided evidence. */
export type ListEmploymentContractsInput = z.infer<typeof listEmploymentContractsInput>;
