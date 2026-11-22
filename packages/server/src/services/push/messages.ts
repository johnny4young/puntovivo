/**
 * Notification copy for the owner's phone, rendered on the server in the
 * language the person chose when turning notifications on. Spanish uses usted.
 *
 * @module services/push/messages
 */
import type { ManagerApprovalAction, PushLanguage } from '../../db/schema.js';
import { formatReceiptAmount } from '../receipt-renderer/format-helpers.js';

export interface PushFormat {
  /** Tenant locale for Intl, e.g. es-CO. */
  locale: string;
  displayDecimals: number;
}

export type OwnerPushMessage =
  | {
      kind: 'approval_waiting';
      action: ManagerApprovalAction;
      requesterName: string;
      siteName: string;
      amount: number | null;
      currencyCode: string | null;
    }
  | {
      kind: 'handoff_done';
      registerName: string;
      fromName: string;
      toName: string;
      outgoingCount: number;
      receivedCount: number | null;
      currencyCode: string;
    }
  | {
      kind: 'day_sealed';
      date: string;
      signerName: string;
      netRevenue: number | null;
      salesCount: number | null;
      currencyCode: string;
    }
  | { kind: 'enabled' };

export interface RenderedPush {
  title: string;
  body: string;
}

const ACTION_NOUNS: Record<PushLanguage, Record<ManagerApprovalAction, string>> = {
  es: {
    credit_override: 'excepción de crédito',
    sale_void: 'anulación',
    sale_discount: 'descuento',
    sale_price_override: 'cambio de precio',
    cash_drawer_open: 'apertura del cajón',
    sale_refund: 'devolución',
    credit_sale: 'venta a crédito',
    sale_after_hours: 'cobro fuera de horario',
  },
  en: {
    credit_override: 'credit exception',
    sale_void: 'void',
    sale_discount: 'discount',
    sale_price_override: 'price change',
    cash_drawer_open: 'drawer opening',
    sale_refund: 'refund',
    credit_sale: 'credit sale',
    sale_after_hours: 'after-hours sale',
  },
};

function money(amount: number, currency: string, format: PushFormat): string {
  try {
    return formatReceiptAmount(amount, {
      ...format,
      currency,
      legalDecimals: format.displayDecimals,
    });
  } catch {
    return `${currency} ${amount}`;
  }
}

function dayLabel(date: string, language: PushLanguage): string {
  const [year, month, day] = date.split('-').map(Number);
  // Noon UTC keeps the calendar day whatever the server's zone.
  const instant = new Date(Date.UTC(year!, month! - 1, day!, 12));
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'long', timeZone: 'UTC' }).format(
    instant
  );
  return `${weekday} ${day}`;
}

export function renderOwnerPush(
  message: OwnerPushMessage,
  language: PushLanguage,
  format: PushFormat
): RenderedPush {
  const es = language === 'es';
  switch (message.kind) {
    case 'approval_waiting': {
      const noun = ACTION_NOUNS[language][message.action];
      const amount =
        message.amount !== null && message.currencyCode && message.action !== 'cash_drawer_open'
          ? money(message.amount, message.currencyCode, format)
          : null;
      const what = amount ? `${noun} ${es ? 'de' : 'of'} ${amount}` : noun;
      return es
        ? {
            title: `Le toca a usted: ${what}`,
            body: `${message.requesterName} pide su aprobación en ${message.siteName}.`,
          }
        : {
            title: `Your call: ${what}`,
            body: `${message.requesterName} is asking for your approval at ${message.siteName}.`,
          };
    }
    case 'handoff_done': {
      const outgoing = money(message.outgoingCount, message.currencyCode, format);
      const handed = es
        ? `${message.fromName} entregó ${outgoing}.`
        : `${message.fromName} handed over ${outgoing}.`;
      let counted: string;
      if (message.receivedCount === null) {
        counted = es
          ? `${message.toName} abrió con cajón nuevo.`
          : `${message.toName} opened with a new drawer.`;
      } else if (Math.abs(message.receivedCount - message.outgoingCount) < 0.005) {
        counted = es ? `${message.toName} contó lo mismo.` : `${message.toName} counted the same.`;
      } else {
        const received = money(message.receivedCount, message.currencyCode, format);
        counted = es
          ? `${message.toName} contó ${received}.`
          : `${message.toName} counted ${received}.`;
      }
      return {
        title: es
          ? `Relevo de ${message.registerName} hecho`
          : `${message.registerName} handoff done`,
        body: `${handed} ${counted}`,
      };
    }
    case 'day_sealed': {
      const day = dayLabel(message.date, language);
      const signed = es ? `Firmó ${message.signerName}.` : `Signed by ${message.signerName}.`;
      const sold =
        message.netRevenue !== null && message.salesCount !== null
          ? es
            ? ` Vendido ${money(message.netRevenue, message.currencyCode, format)} en ${message.salesCount} ventas.`
            : ` Sold ${money(message.netRevenue, message.currencyCode, format)} in ${message.salesCount} sales.`
          : '';
      return {
        title: es ? `Día sellado: ${day}` : `Day sealed: ${day}`,
        body: `${signed}${sold}`,
      };
    }
    case 'enabled':
      return es
        ? {
            title: 'Avisos activados',
            body: 'Aprobaciones, relevos de caja y el día sellado llegan a este teléfono.',
          }
        : {
            title: 'Notifications on',
            body: 'Approvals, register handoffs and the sealed day arrive on this phone.',
          };
  }
}
