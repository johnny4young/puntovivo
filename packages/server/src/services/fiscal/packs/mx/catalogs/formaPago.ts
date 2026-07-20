/**
 * Catálogo SAT de formas de pago (c_FormaPago).
 *
 * El SAT publica una lista cerrada de formas de pago aceptadas en
 * un CFDI. Cada forma tiene un código de 2 dígitos que va dentro
 * del nodo Pago (cuando aplica complemento de Pago) o como atributo
 * MétodoPago en el comprobante principal.
 *
 * En  este catálogo se mapea al `payment_method` interno
 * del POS (`cash` → 01 Efectivo, `card_credit` → 04 Tarjeta de
 * crédito, etc.). El mapeo vive en el adapter MX porque cada país
 * traduce el método interno a su propia taxonomía.
 *
 * @module services/fiscal/packs/mx/catalogs/formaPago
 */

export interface FormaPagoEntry {
  /** Código SAT de 2 dígitos, p. ej. '01'. */
  code: string;
  /** Descripción oficial. */
  name: string;
  /**
   * Si el SAT considera la forma de pago como "definitiva" (pagada
   * al momento) o "diferida" (parcialidades / crédito). El POS por
   * default usa formas definitivas; las diferidas requieren el
   * complemento de Pago 2.0 que llega en .
   */
  isDefinitive: boolean;
}

/**
 * 22 entradas — catálogo SAT 2026 estable. Se incluye '99 Por
 * definir' como fallback cuando el comprobante se emite antes de
 * conocer la forma de pago real (caso anticipo).
 */
export const FORMA_PAGO_CATALOG: ReadonlyArray<FormaPagoEntry> = [
  { code: '01', name: 'Efectivo', isDefinitive: true },
  { code: '02', name: 'Cheque nominativo', isDefinitive: true },
  { code: '03', name: 'Transferencia electrónica de fondos', isDefinitive: true },
  { code: '04', name: 'Tarjeta de crédito', isDefinitive: true },
  { code: '05', name: 'Monedero electrónico', isDefinitive: true },
  { code: '06', name: 'Dinero electrónico', isDefinitive: true },
  { code: '08', name: 'Vales de despensa', isDefinitive: true },
  { code: '12', name: 'Dación en pago', isDefinitive: true },
  { code: '13', name: 'Pago por subrogación', isDefinitive: true },
  { code: '14', name: 'Pago por consignación', isDefinitive: true },
  { code: '15', name: 'Condonación', isDefinitive: true },
  { code: '17', name: 'Compensación', isDefinitive: true },
  { code: '23', name: 'Novación', isDefinitive: true },
  { code: '24', name: 'Confusión', isDefinitive: true },
  { code: '25', name: 'Remisión de deuda', isDefinitive: true },
  { code: '26', name: 'Prescripción o caducidad', isDefinitive: true },
  { code: '27', name: 'A satisfacción del acreedor', isDefinitive: true },
  { code: '28', name: 'Tarjeta de débito', isDefinitive: true },
  { code: '29', name: 'Tarjeta de servicios', isDefinitive: true },
  { code: '30', name: 'Aplicación de anticipos', isDefinitive: true },
  { code: '31', name: 'Intermediario pagos', isDefinitive: true },
  { code: '99', name: 'Por definir', isDefinitive: false },
];

export function findFormaPago(code: string): FormaPagoEntry | undefined {
  return FORMA_PAGO_CATALOG.find(entry => entry.code === code);
}
