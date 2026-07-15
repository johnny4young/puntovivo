import { z } from 'zod';

export const clockInEmployeeShiftInput = z
  .object({
    siteId: z.string().trim().min(1, 'Site is required'),
  })
  .strict();

export const clockOutEmployeeShiftInput = z.object({}).strict();

export type ClockInEmployeeShiftInput = z.infer<typeof clockInEmployeeShiftInput>;
export type ClockOutEmployeeShiftInput = z.infer<typeof clockOutEmployeeShiftInput>;
