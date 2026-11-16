import { z } from 'zod';

import { cashHandoffReceiveModeEnum } from '../../db/schema.js';
import { STAFF_PIN_PATTERN } from '../../security/staffPins.js';
import { cashSessionDenominationInput } from './cashSessions.js';

const denominations = z.array(cashSessionDenominationInput).max(40).default([]);

export const handOutPreviewInput = z.object({ denominations }).optional();

export const handOutShiftInput = z.object({
  actualCount: z.number().min(0, 'Closing count cannot be negative'),
  denominations,
  note: z.string().trim().max(500, 'The note must be 500 characters or fewer').nullish(),
});

export const receiveShiftInput = z.object({
  handoffId: z.string().min(1),
  mode: z.enum(cashHandoffReceiveModeEnum),
  denominations: z.array(cashSessionDenominationInput).min(1).max(40),
  pin: z.string().regex(STAFF_PIN_PATTERN).nullish(),
});
