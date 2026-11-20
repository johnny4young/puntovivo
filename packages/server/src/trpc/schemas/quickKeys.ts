/**
 * Zod schemas for the one-touch keys a site shares across registers.
 *
 * @module trpc/schemas/quickKeys
 */
import { z } from 'zod';

import {
  MAX_SITE_QUICK_KEYS,
  SITE_QUICK_KEY_COLOURS,
  SITE_QUICK_KEY_KINDS,
} from '../../db/schema.js';

const id = z.string().min(1).max(64);

export const listQuickKeysInput = z.object({ siteId: id });

export const setQuickKeyInput = z.object({
  siteId: id,
  id: id.optional(),
  kind: z.enum(SITE_QUICK_KEY_KINDS).default('product'),
  productId: id,
  unitId: id.nullish(),
  label: z.string().trim().max(40).nullish(),
  colour: z.enum(SITE_QUICK_KEY_COLOURS).nullish(),
});

export const reorderQuickKeysInput = z.object({
  siteId: id,
  ids: z.array(id).max(MAX_SITE_QUICK_KEYS),
});

export const removeQuickKeyInput = z.object({ siteId: id, id });

export const importLocalQuickKeysInput = z.object({
  siteId: id,
  productIds: z.array(id).max(MAX_SITE_QUICK_KEYS * 4),
});
