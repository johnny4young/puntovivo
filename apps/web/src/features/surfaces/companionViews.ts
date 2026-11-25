import { ISO_DATE_ONLY_PATTERN } from '@puntovivo/shared/iso-date';
import { MANAGER_OR_ADMIN_ROLES } from '@puntovivo/shared/roles';
import { addCalendarDays } from '@/features/staff/scheduleDate';

export type CompanionView = 'today' | 'day' | 'registers' | 'more';

const OWNER_VIEWS: readonly CompanionView[] = ['today', 'day', 'registers', 'more'];
const VIEWER_VIEWS: readonly CompanionView[] = ['today', 'more'];

/** Admins and managers decide from the phone; viewers keep the read-only pulse. */
export function isCompanionOwner(role: string | undefined): boolean {
  return (MANAGER_OR_ADMIN_ROLES as readonly string[]).includes(role ?? '');
}

/** Weekday names start lowercase in Spanish; a title starts uppercase. */
export function capitalize(text: string, language: string): string {
  return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
}

export function companionViews(owner: boolean): readonly CompanionView[] {
  return owner ? OWNER_VIEWS : VIEWER_VIEWS;
}

export function parseCompanionView(value: string | null, owner: boolean): CompanionView {
  return companionViews(owner).find(view => view === value) ?? 'today';
}

/** The sealed day to show: an explicit date, today once signed, otherwise yesterday. */
export function sealedDayDate(
  requested: string | null,
  businessDay: string,
  todaySigned: boolean
): string {
  if (requested && ISO_DATE_ONLY_PATTERN.test(requested)) return requested;
  return todaySigned ? businessDay : addCalendarDays(businessDay, -1);
}
