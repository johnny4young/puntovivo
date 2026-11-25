import { z } from 'zod';
import { SWITCHABLE_REGISTER_ZONE_IDS } from '@puntovivo/shared/register-zones';

export const setRegisterZoneInput = z.object({
  zoneId: z.enum(SWITCHABLE_REGISTER_ZONE_IDS),
  enabled: z.boolean(),
});
