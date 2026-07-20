/**
 * Catálogo SAT de regímenes fiscales (c_RegimenFiscal).
 *
 * Datos publicados por el SAT en el Anexo 20 (CFDI 4.0). Cada
 * contribuyente declara su régimen al inscribirse al RFC; el
 * régimen determina las obligaciones, deducciones y formato de
 * comprobante que aplica.
 *
 * - **PM** (persona moral): aplica sólo a personas jurídicas.
 * - **PF** (persona física): aplica sólo a personas físicas.
 * - **BOTH**: aplica a ambas (caso típico: 616 Sin obligaciones
 * fiscales, 615 Régimen de los ingresos por intereses).
 *
 * El catálogo es estático en compilación. La política de refresh
 * (TS module vs DB table con seed + cron job de SAT) se decide en
 * cuando llegue el modelado de XML CFDI; el SAT publica
 * actualizaciones ~anuales y el catálogo cambia poco.
 *
 * @module services/fiscal/packs/mx/catalogs/regimenFiscal
 */

export interface RegimenFiscalEntry {
  /** Código numérico SAT, p. ej. '601'. */
  code: string;
  /** Descripción oficial, p. ej. 'General de Ley Personas Morales'. */
  name: string;
  /** A qué tipo de contribuyente aplica el régimen. */
  appliesTo: 'PM' | 'PF' | 'BOTH';
}

/**
 * Catálogo curado de regímenes fiscales SAT vigentes a 2026-Q1.
 * 23 entradas — cubre los regímenes que un POS retail típicamente
 * encuentra. Los regímenes especiales (608 Demás ingresos,
 * 609 Consolidación, 610 Residentes en el extranjero) se incluyen
 * para completitud aún si su uso desde el POS es marginal.
 */
export const REGIMEN_FISCAL_CATALOG: ReadonlyArray<RegimenFiscalEntry> = [
  { code: '601', name: 'General de Ley Personas Morales', appliesTo: 'PM' },
  { code: '603', name: 'Personas Morales con Fines no Lucrativos', appliesTo: 'PM' },
  { code: '605', name: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', appliesTo: 'PF' },
  { code: '606', name: 'Arrendamiento', appliesTo: 'PF' },
  { code: '607', name: 'Régimen de Enajenación o Adquisición de Bienes', appliesTo: 'PF' },
  { code: '608', name: 'Demás ingresos', appliesTo: 'PF' },
  { code: '609', name: 'Consolidación', appliesTo: 'PM' },
  {
    code: '610',
    name: 'Residentes en el Extranjero sin Establecimiento Permanente en México',
    appliesTo: 'BOTH',
  },
  { code: '611', name: 'Ingresos por Dividendos (socios y accionistas)', appliesTo: 'PF' },
  {
    code: '612',
    name: 'Personas Físicas con Actividades Empresariales y Profesionales',
    appliesTo: 'PF',
  },
  { code: '614', name: 'Ingresos por intereses', appliesTo: 'PF' },
  { code: '615', name: 'Régimen de los ingresos por obtención de premios', appliesTo: 'PF' },
  { code: '616', name: 'Sin obligaciones fiscales', appliesTo: 'BOTH' },
  {
    code: '620',
    name: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos',
    appliesTo: 'PM',
  },
  { code: '621', name: 'Incorporación Fiscal', appliesTo: 'PF' },
  {
    code: '622',
    name: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
    appliesTo: 'PM',
  },
  { code: '623', name: 'Opcional para Grupos de Sociedades', appliesTo: 'PM' },
  { code: '624', name: 'Coordinados', appliesTo: 'PM' },
  {
    code: '625',
    name: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
    appliesTo: 'PF',
  },
  { code: '626', name: 'Régimen Simplificado de Confianza (RESICO)', appliesTo: 'BOTH' },
  { code: '628', name: 'Hidrocarburos', appliesTo: 'PM' },
  {
    code: '629',
    name: 'De los Regímenes Fiscales Preferentes y de las Empresas Multinacionales',
    appliesTo: 'PM',
  },
  { code: '630', name: 'Enajenación de acciones en bolsa de valores', appliesTo: 'PF' },
];

/**
 * Búsqueda case-sensitive por código SAT. Devuelve `undefined` si
 * el código no está en el catálogo — el caller decide si rechazar
 * (validateConfig MISSING_RESOLUTION) o aceptar (futuro: catálogo
 * dinámico con refresh SAT).
 */
export function findRegimenFiscal(code: string): RegimenFiscalEntry | undefined {
  return REGIMEN_FISCAL_CATALOG.find(entry => entry.code === code);
}
