import { useMemo } from 'react';
import { dateTimeFormatter } from '@/lib/dateTimeFormatter';

/** Time, long date and weekday in the business timezone, shared by both Hoy screens. */
export function useTodayFormatters(language: string, timeZone: string | undefined) {
  return useMemo(() => {
    const time = dateTimeFormatter(language, { hour: 'numeric', minute: '2-digit', timeZone });
    const long = dateTimeFormatter(language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone,
    });
    const weekday = dateTimeFormatter(language, { weekday: 'long', timeZone });
    return {
      time: (iso: string) => time.format(new Date(iso)),
      longDate: (iso: string) => {
        const text = long.format(new Date(iso));
        return text.charAt(0).toLocaleUpperCase(language) + text.slice(1);
      },
      weekday: (iso: string) => weekday.format(new Date(iso)),
    };
  }, [language, timeZone]);
}
