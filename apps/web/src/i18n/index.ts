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
import enQuotations from './locales/en/quotations.json';
import enDelivery from './locales/en/delivery.json';
import enPosTouch from './locales/en/posTouch.json';
import enReceiptTemplates from './locales/en/receiptTemplates.json';
import enAuditLogs from './locales/en/auditLogs.json';
import enFiscal from './locales/en/fiscal.json';
import enSettings from './locales/en/settings.json';
import enErrors from './locales/en/errors.json';
import enLocaleSettings from './locales/en/localeSettings.json';
import enAISettings from './locales/en/aiSettings.json';
import enAIAnomalies from './locales/en/aiAnomalies.json';
import enCopilot from './locales/en/copilot.json';
import enAIShared from './locales/en/aiShared.json';
import enInvoiceOcr from './locales/en/invoiceOcr.json';
import enSemanticSearch from './locales/en/semanticSearch.json';
import enReceipts from './locales/en/receipts.json';
import enPeripherals from './locales/en/peripherals.json';
import enOperations from './locales/en/operations.json';
import enModules from './locales/en/modules.json';
import enSurfaces from './locales/en/surfaces.json';
import enVoice from './locales/en/voice.json';
import enRestaurants from './locales/en/restaurants.json';
import enKds from './locales/en/kds.json';
import enSetup from './locales/en/setup.json';

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
import esQuotations from './locales/es/quotations.json';
import esDelivery from './locales/es/delivery.json';
import esPosTouch from './locales/es/posTouch.json';
import esReceiptTemplates from './locales/es/receiptTemplates.json';
import esAuditLogs from './locales/es/auditLogs.json';
import esFiscal from './locales/es/fiscal.json';
import esSettings from './locales/es/settings.json';
import esErrors from './locales/es/errors.json';
import esLocaleSettings from './locales/es/localeSettings.json';
import esAISettings from './locales/es/aiSettings.json';
import esAIAnomalies from './locales/es/aiAnomalies.json';
import esCopilot from './locales/es/copilot.json';
import esAIShared from './locales/es/aiShared.json';
import esInvoiceOcr from './locales/es/invoiceOcr.json';
import esSemanticSearch from './locales/es/semanticSearch.json';
import esReceipts from './locales/es/receipts.json';
import esPeripherals from './locales/es/peripherals.json';
import esOperations from './locales/es/operations.json';
import esModules from './locales/es/modules.json';
import esSurfaces from './locales/es/surfaces.json';
import esVoice from './locales/es/voice.json';
import esRestaurants from './locales/es/restaurants.json';
import esKds from './locales/es/kds.json';
import esSetup from './locales/es/setup.json';

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
  ns: ['common', 'auth', 'nav', 'dashboard', 'sales', 'orders', 'purchases', 'inventory', 'products', 'customers', 'quotations', 'delivery', 'posTouch', 'receiptTemplates', 'auditLogs', 'fiscal', 'settings', 'errors', 'localeSettings', 'aiSettings', 'aiAnomalies', 'copilot', 'aiShared', 'invoiceOcr', 'semanticSearch', 'receipts', 'peripherals', 'operations', 'modules', 'surfaces', 'voice', 'restaurants', 'kds', 'setup'],
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
      quotations: enQuotations,
      delivery: enDelivery,
      posTouch: enPosTouch,
      receiptTemplates: enReceiptTemplates,
      auditLogs: enAuditLogs,
      fiscal: enFiscal,
      settings: enSettings,
      errors: enErrors,
      localeSettings: enLocaleSettings,
      aiSettings: enAISettings,
      aiAnomalies: enAIAnomalies,
      copilot: enCopilot,
      aiShared: enAIShared,
      invoiceOcr: enInvoiceOcr,
      semanticSearch: enSemanticSearch,
      receipts: enReceipts,
      peripherals: enPeripherals,
      operations: enOperations,
      modules: enModules,
      surfaces: enSurfaces,
      voice: enVoice,
      restaurants: enRestaurants,
      kds: enKds,
      setup: enSetup,
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
      quotations: esQuotations,
      delivery: esDelivery,
      posTouch: esPosTouch,
      receiptTemplates: esReceiptTemplates,
      auditLogs: esAuditLogs,
      fiscal: esFiscal,
      settings: esSettings,
      errors: esErrors,
      localeSettings: esLocaleSettings,
      aiSettings: esAISettings,
      aiAnomalies: esAIAnomalies,
      copilot: esCopilot,
      aiShared: esAIShared,
      invoiceOcr: esInvoiceOcr,
      semanticSearch: esSemanticSearch,
      receipts: esReceipts,
      peripherals: esPeripherals,
      operations: esOperations,
      modules: esModules,
      surfaces: esSurfaces,
      voice: esVoice,
      restaurants: esRestaurants,
      kds: esKds,
      setup: esSetup,
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
