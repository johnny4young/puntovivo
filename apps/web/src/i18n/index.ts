import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readLanguagePreference, resolveLocale, toSupportedAppLocale } from './resolveLocale';

// Locale resources — bundled at build time (no async fetch needed, works offline)
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enNav from './locales/en/nav.json';
import enDashboard from './locales/en/dashboard.json';
import enSales from './locales/en/sales.json';
import enOrders from './locales/en/orders.json';
import enPurchases from './locales/en/purchases.json';
import enInventory from './locales/en/inventory.json';
import enProducts from './locales/en/products.json';
import enCustomers from './locales/en/customers.json';
import enSettings from './locales/en/settings.json';
import enErrors from './locales/en/errors.json';

import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';
import esNav from './locales/es/nav.json';
import esDashboard from './locales/es/dashboard.json';
import esSales from './locales/es/sales.json';
import esOrders from './locales/es/orders.json';
import esPurchases from './locales/es/purchases.json';
import esInventory from './locales/es/inventory.json';
import esProducts from './locales/es/products.json';
import esCustomers from './locales/es/customers.json';
import esSettings from './locales/es/settings.json';
import esErrors from './locales/es/errors.json';

const preference = readLanguagePreference();
const lng = resolveLocale(preference);

function syncDocumentLanguage(language: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = language;
}

function syncElectronMainLocale(language: string) {
  if (typeof window === 'undefined') {
    return;
  }

  void window.electron?.updateMainLocale?.(toSupportedAppLocale(language));
}

void i18next.use(initReactI18next).init({
  lng,
  // Fallback chain: es-CO → es → en
  // i18next resolves regional tags automatically: "es-CO" falls back to "es" then "en"
  fallbackLng: {
    'es-CO': ['es', 'en'],
    'es-MX': ['es', 'en'],
    'es-AR': ['es', 'en'],
    es: ['en'],
    default: ['en'],
  },
  defaultNS: 'common',
  ns: ['common', 'auth', 'nav', 'dashboard', 'sales', 'orders', 'purchases', 'inventory', 'products', 'customers', 'settings', 'errors'],
  resources: {
    en: {
      common: enCommon,
      auth: enAuth,
      nav: enNav,
      dashboard: enDashboard,
      sales: enSales,
      orders: enOrders,
      purchases: enPurchases,
      inventory: enInventory,
      products: enProducts,
      customers: enCustomers,
      settings: enSettings,
      errors: enErrors,
    },
    es: {
      common: esCommon,
      auth: esAuth,
      nav: esNav,
      dashboard: esDashboard,
      sales: esSales,
      orders: esOrders,
      purchases: esPurchases,
      inventory: esInventory,
      products: esProducts,
      customers: esCustomers,
      settings: esSettings,
      errors: esErrors,
    },
  },
  interpolation: {
    // React already escapes values — disable double-escaping
    escapeValue: false,
  },
});

syncDocumentLanguage(lng);
syncElectronMainLocale(lng);
i18next.on('languageChanged', syncDocumentLanguage);
i18next.on('languageChanged', syncElectronMainLocale);

export default i18next;
