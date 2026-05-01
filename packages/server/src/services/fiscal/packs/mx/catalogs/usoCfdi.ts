/**
 * ENG-035a — Catálogo SAT de usos de CFDI (c_UsoCFDI).
 *
 * El "uso de CFDI" es el campo que el comprador declara para
 * justificar fiscalmente la compra. El SAT publica la lista
 * cerrada en el Anexo 20; en el POS este valor se selecciona al
 * facturar a un cliente con RFC (los tickets a público en general
 * usan S01 implícitamente).
 *
 * Catálogo estático en compilación. ENG-035b lo consume cuando
 * arme el XML CFDI 4.0; ENG-035a sólo lo expone para que el form
 * `CompanyMxFiscalCard` muestre la lista en un Select cuando llegue
 * la fase de captura de cliente con RFC (por ahora la card sólo
 * configura el emisor; el uso queda capturado en futuro).
 *
 * @module services/fiscal/packs/mx/catalogs/usoCfdi
 */

export interface UsoCfdiEntry {
  /** Código SAT alfanumérico, p. ej. 'G03'. */
  code: string;
  /** Descripción oficial. */
  name: string;
  /**
   * Regímenes fiscales válidos para este uso. La lista vacía
   * significa "todos los regímenes" (raro). Se valida al armar el
   * CFDI en ENG-035b.
   */
  applicableRegimens?: ReadonlyArray<string>;
}

/**
 * 24 entradas curadas — cubre los usos más comunes en retail. Los
 * usos altamente especializados (D03 Donativos, I07 Equipo de
 * comunicaciones telefónicas, etc.) se incluyen para que el operador
 * pueda emitir comprobantes a clientes corporativos sin caer al
 * fallback S01.
 */
export const USO_CFDI_CATALOG: ReadonlyArray<UsoCfdiEntry> = [
  { code: 'G01', name: 'Adquisición de mercancías' },
  { code: 'G02', name: 'Devoluciones, descuentos o bonificaciones' },
  { code: 'G03', name: 'Gastos en general' },
  { code: 'I01', name: 'Construcciones' },
  { code: 'I02', name: 'Mobiliario y equipo de oficina por inversiones' },
  { code: 'I03', name: 'Equipo de transporte' },
  { code: 'I04', name: 'Equipo de cómputo y accesorios' },
  { code: 'I05', name: 'Dados, troqueles, moldes, matrices y herramental' },
  { code: 'I06', name: 'Comunicaciones telefónicas' },
  { code: 'I07', name: 'Comunicaciones satelitales' },
  { code: 'I08', name: 'Otra maquinaria y equipo' },
  { code: 'D01', name: 'Honorarios médicos, dentales y gastos hospitalarios' },
  { code: 'D02', name: 'Gastos médicos por incapacidad o discapacidad' },
  { code: 'D03', name: 'Gastos funerales' },
  { code: 'D04', name: 'Donativos' },
  { code: 'D05', name: 'Intereses reales efectivamente pagados por créditos hipotecarios' },
  { code: 'D06', name: 'Aportaciones voluntarias al SAR' },
  { code: 'D07', name: 'Primas por seguros de gastos médicos' },
  { code: 'D08', name: 'Gastos de transportación escolar obligatoria' },
  { code: 'D09', name: 'Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones' },
  { code: 'D10', name: 'Pagos por servicios educativos (colegiaturas)' },
  { code: 'S01', name: 'Sin efectos fiscales' },
  { code: 'CP01', name: 'Pagos' },
  { code: 'CN01', name: 'Nómina' },
];

export function findUsoCfdi(code: string): UsoCfdiEntry | undefined {
  return USO_CFDI_CATALOG.find(entry => entry.code === code);
}
