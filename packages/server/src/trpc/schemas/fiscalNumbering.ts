/**
 * Inputs of `fiscalNumbering.*`. Domain rules (overlap, two-year validity,
 * technical key for FEV) live in `services/fiscal/numbering/ranges.ts`.
 *
 * @module trpc/schemas/fiscalNumbering
 */
import { z } from 'zod';
import { fiscalNumberingEnvironmentEnum } from '../../db/schema.js';
import { AUTHORIZED_NUMBERING_KINDS } from '../../services/fiscal/numbering/ranges.js';

const isoDate = z.string().trim().min(10).max(40);
const rangeId = z.string().trim().min(1).max(64);

export const listFiscalNumberingInput = z
  .object({ siteId: z.string().trim().min(1).max(64).optional() })
  .optional();

export const fiscalNumberingUsageInput = listFiscalNumberingInput;

export const createFiscalNumberingInput = z.object({
  siteId: z.string().trim().min(1).max(64),
  kind: z.enum(AUTHORIZED_NUMBERING_KINDS),
  resolutionNumber: z.string().trim().min(1).max(40),
  resolutionDate: isoDate,
  prefix: z.string().trim().max(4).default(''),
  fromNumber: z.number().int().min(1),
  toNumber: z.number().int().min(1),
  validFrom: isoDate,
  validUntil: isoDate,
  technicalKey: z.string().trim().max(200).nullish(),
  environment: z.enum(fiscalNumberingEnvironmentEnum),
  lastIssuedNumber: z.number().int().min(1).nullish(),
  openingReason: z.string().trim().max(500).nullish(),
});

export const fiscalNumberingIdInput = z.object({ id: rangeId });

export const retireFiscalNumberingInput = z.object({
  id: rangeId,
  reason: z.string().trim().min(1).max(500),
});
