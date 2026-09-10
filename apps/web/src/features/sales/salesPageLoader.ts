import i18next from '@/i18n';

// These namespaces are consumed by the initial POS hooks and visible children,
// not just by optional dialogs. Start their chunks with the route code instead
// of discovering them one suspended render at a time. They stay out of the
// login/global bootstrap, and loading translations never starts catalog queries.
export { SALES_INITIAL_NAMESPACES } from './salesInitialNamespaces';
import { SALES_INITIAL_NAMESPACES } from './salesInitialNamespaces';

export function loadSalesPage() {
  // This is only a head start: useTranslation remains authoritative for the
  // current language and its Suspense/error behavior. A slow or failed optional
  // namespace must not poison React.lazy or block the entire route module.
  void i18next.loadNamespaces([...SALES_INITIAL_NAMESPACES]).catch(() => {});
  return import('./SalesPage').then(module => ({ default: module.SalesPage }));
}
