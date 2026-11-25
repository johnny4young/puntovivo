import { z } from 'zod';
import { PUSH_LANGUAGES } from '../../db/schema.js';

const endpoint = z.string().trim().url().max(2048);
const base64Url = z
  .string()
  .regex(/^[A-Za-z0-9_-]+={0,2}$/)
  .max(128);

export const ownerPushStatusInput = z.object({ endpoint: endpoint.nullable() });

export const ownerPushStatusOutput = z.object({
  /** False when this installation cannot keep a push key (no database key). */
  available: z.boolean(),
  publicKey: z.string().nullable(),
  /** Whether the given endpoint is subscribed for the caller. */
  subscribed: z.boolean(),
  language: z.enum(PUSH_LANGUAGES).nullable(),
});

export const ownerPushSubscribeInput = z.object({
  endpoint,
  keys: z.object({ p256dh: base64Url, auth: base64Url }),
  language: z.enum(PUSH_LANGUAGES),
});

export const ownerPushUnsubscribeInput = z.object({ endpoint });

export const ownerPushSubscriptionOutput = z.object({ subscribed: z.boolean() });
