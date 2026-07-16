import { z } from 'zod';

export const clockInEmployeeShiftInput = z
  .object({
    siteId: z.string().trim().min(1, 'Site is required'),
  })
  .strict();

export const clockOutEmployeeShiftInput = z.object({}).strict();

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a 24-hour HH:mm time');
const scheduleNotes = z.string().trim().max(500).nullable().optional();

const scheduleWindowFields = {
  startDate: localDate,
  startTime: localTime,
  endDate: localDate,
  endTime: localTime,
} as const;

export const listScheduledShiftsInput = z
  .object({
    fromDate: localDate,
    toDate: localDate,
    siteId: z.string().trim().min(1).optional(),
    includeCancelled: z.boolean().default(false),
  })
  .strict();

export const createScheduledShiftInput = z
  .object({
    userId: z.string().trim().min(1),
    siteId: z.string().trim().min(1),
    ...scheduleWindowFields,
    notes: scheduleNotes,
  })
  .strict();

export const updateScheduledShiftInput = z
  .object({
    id: z.string().trim().min(1),
    version: z.number().int().positive(),
    userId: z.string().trim().min(1),
    siteId: z.string().trim().min(1),
    ...scheduleWindowFields,
    notes: scheduleNotes,
  })
  .strict();

export const cancelScheduledShiftInput = z
  .object({
    id: z.string().trim().min(1),
    version: z.number().int().positive(),
  })
  .strict();

export const employeeBreakCommandInput = z.object({}).strict();

export const listEmployeeAttendanceInput = z
  .object({
    fromDate: localDate,
    toDate: localDate,
    siteId: z.string().trim().min(1).optional(),
    userId: z.string().trim().min(1).optional(),
    page: z.number().int().positive().default(1),
    perPage: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export type ClockInEmployeeShiftInput = z.infer<typeof clockInEmployeeShiftInput>;
export type ClockOutEmployeeShiftInput = z.infer<typeof clockOutEmployeeShiftInput>;
export type ListScheduledShiftsInput = z.infer<typeof listScheduledShiftsInput>;
export type CreateScheduledShiftInput = z.infer<typeof createScheduledShiftInput>;
export type UpdateScheduledShiftInput = z.infer<typeof updateScheduledShiftInput>;
export type CancelScheduledShiftInput = z.infer<typeof cancelScheduledShiftInput>;
export type EmployeeBreakCommandInput = z.infer<typeof employeeBreakCommandInput>;
export type ListEmployeeAttendanceInput = z.infer<typeof listEmployeeAttendanceInput>;
