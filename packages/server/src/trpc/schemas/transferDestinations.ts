/**
 * Zod schemas for the transfer destinations a site shows at checkout.
 *
 * @module trpc/schemas/transferDestinations
 */
import { z } from 'zod';

import {
  BANK_ACCOUNT_TYPES,
  MAX_SITE_TRANSFER_DESTINATIONS,
  TRANSFER_DESTINATION_KINDS,
  TRANSFER_DESTINATION_LIMITS as LIMITS,
  TRANSFER_QR_LOCALES,
} from '../../db/schema.js';

const id = z.string().min(1).max(64);
const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const listTransferDestinationsInput = z.object({ siteId: id });

/** Replaces every field of an existing destination; omitted optional fields are cleared. */
export const setTransferDestinationInput = z.object({
  siteId: id,
  id: id.optional(),
  kind: z.enum(TRANSFER_DESTINATION_KINDS),
  label: optionalText(LIMITS.label),
  account: z.string().trim().min(1).max(LIMITS.account),
  bankName: optionalText(LIMITS.bankName),
  accountType: z.enum(BANK_ACCOUNT_TYPES).nullish(),
  holderName: optionalText(LIMITS.holderName),
  holderId: optionalText(LIMITS.holderId),
  qrPayload: optionalText(LIMITS.qrPayload),
});

export const reorderTransferDestinationsInput = z.object({
  siteId: id,
  ids: z.array(id).max(MAX_SITE_TRANSFER_DESTINATIONS),
});

export const removeTransferDestinationInput = z.object({ siteId: id, id });

export const chargeTransferDestinationsInput = z.object({
  siteId: id,
  amount: z.number().finite().nonnegative().max(1e12).nullish(),
  locale: z.enum(TRANSFER_QR_LOCALES).default('es'),
});
