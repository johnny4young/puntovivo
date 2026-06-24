/**
 * Public + private node types for CFDI 4.0 serialization (ENG-035b).
 *
 * @module services/fiscal/packs/mx/cfdi40-xml/types
 */

/**
 * Resultado de la serialización: el UUID generado localmente y el
 * string XML listo para persistir.
 */
export interface SerializedCfdi40 {
  /** UUID v4 local (placeholder hasta que ENG-035c lo reemplace por el folio fiscal SAT). */
  uuid: string;
  /** XML CFDI 4.0 serializado, encoding UTF-8, listo para almacenar en `fiscal_documents.xml_ref`. */
  xml: string;
  /** Datos del emisor que el adapter persiste como contexto para auditoría. */
  emisorRfc: string;
  /** Datos del receptor (consumidor final genérico vs foreign vs cliente registrado). */
  receptorRfc: string;
  /** Tipo de comprobante CFDI ('I' = ingreso, 'E' = egreso). Útil para tests. */
  tipoComprobante: 'I' | 'E';
}

export interface ResolvedReceptor {
  rfc: string;
  nombre: string;
  domicilioFiscal: string;
  regimenFiscal: string;
  usoCfdi: string;
  residenciaFiscal?: string;
  numRegIdTrib?: string;
}

export interface ConceptoNode {
  '@_ClaveProdServ': string;
  '@_NoIdentificacion'?: string;
  '@_Cantidad': string;
  '@_ClaveUnidad': string;
  '@_Unidad'?: string;
  '@_Descripcion': string;
  '@_ValorUnitario': string;
  '@_Importe': string;
  '@_Descuento'?: string;
  '@_ObjetoImp': string;
  'cfdi:Impuestos'?: {
    'cfdi:Traslados': {
      'cfdi:Traslado': TrasladoNodeAttrs;
    };
  };
}

export interface TrasladoNodeAttrs {
  '@_Base': string;
  '@_Impuesto': string;
  '@_TipoFactor': 'Tasa' | 'Exento';
  '@_TasaOCuota'?: string;
  '@_Importe'?: string;
}

export interface ImpuestosAgregadosNode {
  '@_TotalImpuestosTrasladados': string;
  'cfdi:Traslados': {
    'cfdi:Traslado': Array<{
      '@_Base': string;
      '@_Impuesto': string;
      '@_TipoFactor': 'Tasa' | 'Exento';
      '@_TasaOCuota'?: string;
      '@_Importe'?: string;
    }>;
  };
}
