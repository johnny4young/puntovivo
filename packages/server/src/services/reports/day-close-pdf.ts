/**
 * server-side printable day-close evidence.
 *
 * The PDF is rendered before the irreversible sign-off transaction. It is a
 * human-readable projection of the exact report snapshot whose canonical hash
 * is printed on every artifact. The immutable JSON remains the source of truth;
 * this binary is the portable, printable representation stored beside it.
 */
import { jsPDF } from 'jspdf';
import type { ResolvedLocale } from '../tenant-locale.js';
import type { ComprehensiveDayCloseReport } from './comprehensive-day-close.js';

export const MAX_DAY_CLOSE_PDF_BYTES = 2 * 1024 * 1024;

interface RenderDayClosePdfInput {
  tenantName: string;
  report: ComprehensiveDayCloseReport;
  reportHash: string;
  signedByName: string;
  signedAt: string;
  locale: ResolvedLocale;
}

const COPY = {
  en: {
    title: 'Signed day-close report',
    immutable: 'Immutable manager evidence',
    business: 'Business',
    businessDay: 'Business day',
    generatedAt: 'Report generated',
    signedBy: 'Signed by',
    signedAt: 'Signed at',
    timeZone: 'Time zone',
    reportHash: 'SHA-256 report hash',
    sales: 'Sales summary',
    payments: 'Payment settlement',
    cash: 'Cash reconciliation',
    fiscal: 'Fiscal documents',
    adjustments: 'Voids and refunds',
    anomalies: 'Anomaly summary',
    readiness: 'Coverage and readiness',
    saleCount: 'Gross sales',
    subtotal: 'Subtotal',
    discounts: 'Discounts',
    taxes: 'Taxes',
    tips: 'Tips',
    serviceCharges: 'Service charges',
    grossRevenue: 'Gross revenue',
    refundAmount: 'Refund amount',
    netRevenue: 'Net revenue',
    paymentTransactions: 'transactions',
    noPayments: 'No eligible payments recorded',
    closedSessions: 'Closed sessions',
    openSessions: 'Open at day end',
    expectedCash: 'Expected cash',
    countedCash: 'Counted cash',
    overShort: 'Over / short',
    balancedSessions: 'Balanced sessions',
    discrepancySessions: 'Sessions with discrepancy',
    fiscalCount: 'Documents',
    fiscalAmount: 'Net fiscal amount',
    voids: 'Voids',
    refunds: 'Refunds',
    anomalyTotal: 'Total signals',
    highAnomalies: 'High severity',
    mediumAnomalies: 'Medium severity',
    readyToSign: 'Ready at signing',
    yes: 'Yes',
    no: 'No',
    blockers: 'Blockers',
    warnings: 'Warnings',
    none: 'None',
    commissionsLabel: 'Commissions',
    wasteLabel: 'Waste',
    commissions: 'Commissions are not tracked yet',
    waste: 'Waste is not tracked yet',
    footer: 'Puntovivo immutable day-close evidence',
  },
  es: {
    title: 'Reporte firmado de cierre del día',
    immutable: 'Evidencia inmutable del responsable',
    business: 'Negocio',
    businessDay: 'Día comercial',
    generatedAt: 'Reporte generado',
    signedBy: 'Firmado por',
    signedAt: 'Fecha de firma',
    timeZone: 'Zona horaria',
    reportHash: 'Huella SHA-256 del reporte',
    sales: 'Resumen de ventas',
    payments: 'Conciliación de pagos',
    cash: 'Conciliación de caja',
    fiscal: 'Documentos fiscales',
    adjustments: 'Anulaciones y devoluciones',
    anomalies: 'Resumen de anomalías',
    readiness: 'Cobertura y preparación',
    saleCount: 'Ventas brutas',
    subtotal: 'Subtotal',
    discounts: 'Descuentos',
    taxes: 'Impuestos',
    tips: 'Propinas',
    serviceCharges: 'Cargos por servicio',
    grossRevenue: 'Ingresos brutos',
    refundAmount: 'Monto devuelto',
    netRevenue: 'Ingresos netos',
    paymentTransactions: 'transacciones',
    noPayments: 'No se registraron pagos elegibles',
    closedSessions: 'Sesiones cerradas',
    openSessions: 'Abiertas al terminar el día',
    expectedCash: 'Efectivo esperado',
    countedCash: 'Efectivo contado',
    overShort: 'Diferencia de caja',
    balancedSessions: 'Sesiones cuadradas',
    discrepancySessions: 'Sesiones con diferencia',
    fiscalCount: 'Documentos',
    fiscalAmount: 'Monto fiscal neto',
    voids: 'Anulaciones',
    refunds: 'Devoluciones',
    anomalyTotal: 'Señales totales',
    highAnomalies: 'Severidad alta',
    mediumAnomalies: 'Severidad media',
    readyToSign: 'Listo al firmar',
    yes: 'Sí',
    no: 'No',
    blockers: 'Bloqueos',
    warnings: 'Advertencias',
    none: 'Ninguno',
    commissionsLabel: 'Comisiones',
    wasteLabel: 'Mermas',
    commissions: 'Las comisiones aún no se registran',
    waste: 'Las mermas aún no se registran',
    footer: 'Evidencia inmutable de cierre de Puntovivo',
  },
} as const;

const PAYMENT_METHODS = {
  en: { cash: 'Cash', card: 'Card', transfer: 'Transfer', credit: 'Credit', other: 'Other' },
  es: {
    cash: 'Efectivo',
    card: 'Tarjeta',
    transfer: 'Transferencia',
    credit: 'Crédito',
    other: 'Otro',
  },
} as const;

const READINESS_LABELS = {
  en: {
    open_sessions: 'Open cash sessions',
    cash_discrepancies: 'Cash discrepancies',
    fiscal_pending: 'Fiscal documents in progress',
    fiscal_rejected: 'Rejected fiscal documents',
    high_anomalies: 'High-severity anomalies',
    commissions_not_tracked: 'Commissions are not tracked yet',
    waste_not_tracked: 'Waste is not tracked yet',
  },
  es: {
    open_sessions: 'Sesiones de caja abiertas',
    cash_discrepancies: 'Diferencias de caja',
    fiscal_pending: 'Documentos fiscales en proceso',
    fiscal_rejected: 'Documentos fiscales rechazados',
    high_anomalies: 'Anomalías de severidad alta',
    commissions_not_tracked: 'Las comisiones aún no se registran',
    waste_not_tracked: 'Las mermas aún no se registran',
  },
} as const;

const FISCAL_STATUS_LABELS = {
  en: {
    pending: 'Pending',
    sent: 'Sent',
    accepted: 'Accepted',
    rejected: 'Rejected',
    contingency: 'Contingency',
    voided: 'Voided',
    notified_correction: 'Correction requested',
    partial_send: 'Partially sent',
  },
  es: {
    pending: 'Pendientes',
    sent: 'Enviados',
    accepted: 'Aceptados',
    rejected: 'Rechazados',
    contingency: 'Contingencia',
    voided: 'Anulados',
    notified_correction: 'Corrección solicitada',
    partial_send: 'Envío parcial',
  },
} as const;

const ANOMALY_KIND_LABELS = {
  en: {
    ticketsPerHourSpike: 'Tickets per hour',
    voidRate: 'Void rate',
    refundAmount: 'Refund amount',
    noSaleSessions: 'No-sale sessions',
  },
  es: {
    ticketsPerHourSpike: 'Tickets por hora',
    voidRate: 'Tasa de anulaciones',
    refundAmount: 'Monto de devoluciones',
    noSaleSessions: 'Sesiones sin venta',
  },
} as const;

type SupportedLanguage = keyof typeof COPY;

function supportedLanguage(language: string): SupportedLanguage {
  return language === 'es' ? 'es' : 'en';
}

export function buildDayClosePdfFilename(date: string, reportHash: string): string {
  return `puntovivo-cierre-${date}-${reportHash.slice(0, 8)}.pdf`;
}

/** Render a compact A4 report without accessing browser APIs. */
export function renderDayClosePdf(input: RenderDayClosePdfInput): Buffer {
  const language = supportedLanguage(input.locale.language);
  const copy = COPY[language];
  const report = input.report;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const valueX = margin + 79;
  const valueWidth = pageWidth - margin - valueX;
  let y = margin;

  const currency = new Intl.NumberFormat(input.locale.locale, {
    style: 'currency',
    currency: report.currencyCode,
    minimumFractionDigits: input.locale.displayDecimals,
    maximumFractionDigits: input.locale.displayDecimals,
  });
  const dateTime = new Intl.DateTimeFormat(input.locale.locale, {
    timeZone: report.timeZone,
    dateStyle: 'medium',
    timeStyle: 'medium',
  });

  const addPageIfNeeded = (height: number) => {
    if (y + height <= pageHeight - 17) return;
    doc.addPage();
    y = margin;
  };
  const row = (label: string, value: string) => {
    const valueLines = doc.splitTextToSize(value, valueWidth) as string[];
    const height = Math.max(5, valueLines.length * 4.2);
    addPageIfNeeded(height + 1);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(84, 94, 112);
    doc.text(label, margin, y);
    doc.setTextColor(20, 30, 48);
    doc.text(valueLines, valueX, y);
    y += height;
  };
  const section = (title: string) => {
    addPageIfNeeded(13);
    y += 2;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, y - 5, contentWidth, 8, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 58, 95);
    doc.text(title, margin + 3, y);
    y += 9;
  };
  const eventSummary = (count: number, amount: number) => `${count} · ${currency.format(amount)}`;

  doc.setProperties({
    title: `${copy.title} ${report.date}`,
    subject: copy.immutable,
    author: input.tenantName,
    creator: 'Puntovivo',
  });
  doc.setCreationDate(new Date(input.signedAt));
  doc.setFileId(input.reportHash.slice(0, 32).toUpperCase());

  doc.setFillColor(30, 94, 165);
  doc.roundedRect(margin, y, contentWidth, 27, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(copy.title, margin + 5, y + 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(copy.immutable, margin + 5, y + 18);
  y += 35;

  row(copy.business, input.tenantName);
  row(copy.businessDay, report.date);
  row(copy.generatedAt, dateTime.format(new Date(report.generatedAt)));
  row(copy.signedBy, input.signedByName);
  row(copy.signedAt, dateTime.format(new Date(input.signedAt)));
  row(copy.timeZone, report.timeZone);
  row(copy.reportHash, input.reportHash);

  section(copy.sales);
  row(copy.saleCount, String(report.sales.count));
  row(copy.subtotal, currency.format(report.sales.subtotal));
  row(copy.discounts, currency.format(report.sales.discounts));
  row(copy.taxes, currency.format(report.sales.taxes));
  row(copy.tips, currency.format(report.sales.tips));
  row(copy.serviceCharges, currency.format(report.sales.serviceCharges));
  row(copy.grossRevenue, currency.format(report.sales.grossRevenue));
  row(copy.refundAmount, currency.format(report.sales.refundAmount));
  row(copy.netRevenue, currency.format(report.sales.netRevenue));

  section(copy.payments);
  if (report.payments.length === 0) {
    row(copy.payments, copy.noPayments);
  } else {
    for (const payment of report.payments) {
      row(
        PAYMENT_METHODS[language][payment.method],
        `${currency.format(payment.amount)} · ${payment.transactionCount} ${copy.paymentTransactions}`
      );
    }
  }

  section(copy.cash);
  row(copy.closedSessions, String(report.cash.closedSessions));
  row(copy.openSessions, String(report.cash.openSessions));
  row(copy.expectedCash, currency.format(report.cash.expected));
  row(copy.countedCash, currency.format(report.cash.counted));
  row(copy.overShort, currency.format(report.cash.overShort));
  row(copy.balancedSessions, String(report.cash.balancedSessions));
  row(copy.discrepancySessions, String(report.cash.discrepancySessions));

  section(copy.fiscal);
  row(copy.fiscalCount, String(report.fiscal.total));
  row(copy.fiscalAmount, currency.format(report.fiscal.totalAmount));
  for (const [status, count] of Object.entries(report.fiscal.byStatus)) {
    if (count > 0) {
      row(
        FISCAL_STATUS_LABELS[language][status as keyof typeof report.fiscal.byStatus],
        String(count)
      );
    }
  }

  section(copy.adjustments);
  row(copy.voids, eventSummary(report.adjustments.voids.count, report.adjustments.voids.amount));
  row(
    copy.refunds,
    eventSummary(report.adjustments.refunds.count, report.adjustments.refunds.amount)
  );

  section(copy.anomalies);
  row(copy.anomalyTotal, String(report.anomalies.total));
  row(copy.highAnomalies, String(report.anomalies.high));
  row(copy.mediumAnomalies, String(report.anomalies.medium));
  for (const [kind, count] of Object.entries(report.anomalies.byKind)) {
    if (count > 0) {
      row(
        ANOMALY_KIND_LABELS[language][kind as keyof typeof report.anomalies.byKind],
        String(count)
      );
    }
  }

  section(copy.readiness);
  row(copy.readyToSign, report.readiness.readyToSign ? copy.yes : copy.no);
  row(
    copy.blockers,
    report.readiness.blockers.map(code => READINESS_LABELS[language][code]).join(', ') || copy.none
  );
  row(
    copy.warnings,
    report.readiness.warnings.map(code => READINESS_LABELS[language][code]).join(', ') || copy.none
  );
  row(copy.commissionsLabel, copy.commissions);
  row(copy.wasteLabel, copy.waste);

  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(copy.footer, margin, pageHeight - 8);
    doc.text(`${pageNumber}/${pageCount}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  const pdf = Buffer.from(doc.output('arraybuffer'));
  if (pdf.byteLength > MAX_DAY_CLOSE_PDF_BYTES) {
    throw new Error(`Day-close PDF exceeds ${MAX_DAY_CLOSE_PDF_BYTES} bytes`);
  }
  return pdf;
}
