/**
 * SAT generic-receptor constants for CFDI 4.0 serialization (ENG-035b).
 *
 * @module services/fiscal/packs/mx/cfdi40-xml/constants
 */

/**
 * Constantes SAT genéricas usadas cuando el receptor no es un
 * cliente registrado mexicano.
 */
export const RECEPTOR_GENERICO = {
  rfcMexicano: 'XAXX010101000',
  rfcExtranjero: 'XEXX010101000',
  nombre: 'PUBLICO EN GENERAL',
  usoCfdiPublicoGeneral: 'S01',
  /** ResidenciaFiscal cuando el receptor es extranjero. ISO 3166-1 alpha-3. */
  residenciaFiscalDefault: 'USA',
  /** NumRegIdTrib cuando es extranjero — placeholder operativo. */
  numRegIdTribDefault: '0000000000',
} as const;

/** Régimen fiscal por default para el receptor "Público en general". */
export const REGIMEN_RECEPTOR_PUBLICO_GENERAL = '616';

/** Tipo de relación SAT para nota de crédito: '01' Nota de crédito. */
export const TIPO_RELACION_NC = '01';
