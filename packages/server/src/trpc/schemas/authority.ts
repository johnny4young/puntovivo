import { z } from 'zod';

export const createPairingCodeInput = z.object({
  siteId: z.string().min(1),
  deviceName: z.string().trim().min(1).max(120).optional(),
  expiresInMinutes: z.number().int().min(1).max(60).optional(),
});

export const consumePairingCodeInput = z.object({
  code: z.string().trim().min(4).max(32),
  deviceId: z.string().min(8).max(64),
});

export const revokeAuthorityDeviceInput = z.object({
  deviceId: z.string().min(8).max(64),
});

export type CreatePairingCodeInput = z.infer<typeof createPairingCodeInput>;
export type ConsumePairingCodeInput = z.infer<typeof consumePairingCodeInput>;
export type RevokeAuthorityDeviceInput = z.infer<typeof revokeAuthorityDeviceInput>;
