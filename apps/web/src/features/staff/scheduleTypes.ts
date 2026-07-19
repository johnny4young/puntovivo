import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type ScheduledShift = RouterOutputs['employeeShifts']['schedule']['list'][number];
export type ScheduleContext = RouterOutputs['employeeShifts']['schedule']['context'];

export interface ScheduleFormValues {
  userId: string;
  siteId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  notes: string;
}
