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
    version: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
    userId: z.string().trim().min(1),
    siteId: z.string().trim().min(1),
    ...scheduleWindowFields,
    notes: scheduleNotes,
  })
  .strict();

export const cancelScheduledShiftInput = z
  .object({
    id: z.string().trim().min(1),
    version: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER - 1),
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

/** bounded, unpaginated input for payroll/accounting handoff exports. */
export const exportEmployeeAttendanceInput = listEmployeeAttendanceInput.omit({
  page: true,
  perPage: true,
});

const correctionBreakInput = z
  .object({
    id: z.string().trim().min(1).optional(),
    startDate: localDate,
    startTime: localTime,
    endDate: localDate,
    endTime: localTime,
  })
  .strict();

/** a complete effective snapshot, never a patch to raw evidence. */
export const createEmployeeAttendanceCorrectionInput = z
  .object({
    employeeShiftId: z.string().trim().min(1),
    expectedVersion: z.number().int().min(0),
    startDate: localDate,
    startTime: localTime,
    endDate: localDate,
    endTime: localTime,
    breaks: z.array(correctionBreakInput).max(12),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export const listEmployeeAttendanceCorrectionsInput = z
  .object({ employeeShiftId: z.string().trim().min(1) })
  .strict();

export const listPlanActualInput = z
  .object({
    fromDate: localDate,
    toDate: localDate,
    siteId: z.string().trim().min(1).optional(),
    userId: z.string().trim().min(1).optional(),
    cursor: z
      .object({ startsAt: z.iso.datetime(), id: z.string().trim().min(1) })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();

export const listAttendanceReconciliationCandidatesInput = z
  .object({ scheduledShiftId: z.string().trim().min(1) })
  .strict();

const reconciliationCommandBase = {
  scheduledShiftId: z.string().trim().min(1),
  scheduledShiftVersion: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER - 1),
  expectedVersion: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER - 1),
  reason: z.string().trim().min(10).max(500),
} as const;

export const recordAttendanceReconciliationInput = z.discriminatedUnion('outcome', [
  z
    .object({
      ...reconciliationCommandBase,
      outcome: z.literal('attended'),
      employeeShiftId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      ...reconciliationCommandBase,
      outcome: z.literal('no_show'),
      employeeShiftId: z.null().default(null),
    })
    .strict(),
]);

/** Admin-only operational costing window; the same 31-day bound applies as attendance exports. */
export const listLaborCostInput = exportEmployeeAttendanceInput;

export type ClockInEmployeeShiftInput = z.infer<typeof clockInEmployeeShiftInput>;
export type ClockOutEmployeeShiftInput = z.infer<typeof clockOutEmployeeShiftInput>;
export type ListScheduledShiftsInput = z.infer<typeof listScheduledShiftsInput>;
export type CreateScheduledShiftInput = z.infer<typeof createScheduledShiftInput>;
export type UpdateScheduledShiftInput = z.infer<typeof updateScheduledShiftInput>;
export type CancelScheduledShiftInput = z.infer<typeof cancelScheduledShiftInput>;
export type EmployeeBreakCommandInput = z.infer<typeof employeeBreakCommandInput>;
export type ListEmployeeAttendanceInput = z.infer<typeof listEmployeeAttendanceInput>;
export type ExportEmployeeAttendanceInput = z.infer<typeof exportEmployeeAttendanceInput>;
export type CreateEmployeeAttendanceCorrectionInput = z.infer<
  typeof createEmployeeAttendanceCorrectionInput
>;
export type ListEmployeeAttendanceCorrectionsInput = z.infer<
  typeof listEmployeeAttendanceCorrectionsInput
>;
/** Bounded keyset window for manager-safe planned-vs-actual rows. */
export type ListPlanActualInput = z.infer<typeof listPlanActualInput>;
/** One schedule identity used to discover eligible unclaimed attendance evidence. */
export type ListAttendanceReconciliationCandidatesInput = z.infer<
  typeof listAttendanceReconciliationCandidatesInput
>;
/** Exact-version manager decision; no-show never carries an attendance id. */
export type RecordAttendanceReconciliationInput = z.infer<
  typeof recordAttendanceReconciliationInput
>;
/** Bounded filters for regular operational labor-cost estimates. */
export type ListLaborCostInput = z.infer<typeof listLaborCostInput>;
