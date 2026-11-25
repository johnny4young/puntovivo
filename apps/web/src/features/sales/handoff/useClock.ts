import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateTimeFormatter } from '@/lib/dateTimeFormatter';
import { getActiveTenantLocale } from '@/lib/utils';

/** The current minute and a short clock formatter in the store's time zone. */
export function useClock() {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const tenant = getActiveTenantLocale();
  // The store's locale keeps its own clock style (a. m./p. m. in Colombia).
  const locale = tenant?.locale?.startsWith(i18n.language) ? tenant.locale : i18n.language;
  const formatter = dateTimeFormatter(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(tenant?.timezone ? { timeZone: tenant.timezone } : {}),
  });
  return { now, time: (value: string | Date) => formatter.format(new Date(value)) };
}
