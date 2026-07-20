/**
 * Public + private node types for DTE 1.0 serialization ().
 *
 * @module services/fiscal/packs/cl/dte10-xml/types
 */

/**
 * Resultado de la serialización: el string XML + los datos clave que
 * el adapter persiste como contexto observable en
 * `fiscal_documents.provider_response`.
 */
export interface SerializedDte10 {
  xml: string;
  /** TipoDTE serializado (33/39/61/...). */
  tipoDte: string;
  /** Folio asignado por el CAF allocator. */
  folio: number;
  /** RUT emisor (settings.fiscal.cl.rut). */
  emisorRut: string;
  /** RUT receptor (cliente identificado o '66666666-6' boleta consumidor final). */
  receptorRut: string;
  /** Monto total en CLP (entero). */
  mntTotal: number;
}

export interface DetalleItemNode {
  NroLinDet: number;
  NmbItem: string;
  QtyItem: number;
  UnmdItem: string;
  PrcItem: number;
  MontoItem: number;
  IndExe?: 1;
}

export interface TotalesNode {
  MntNeto: number;
  MntExe?: number;
  TasaIVA?: number;
  IVA?: number;
  MntTotal: number;
}

export interface ReferenciaNode {
  NroLinRef: number;
  TpoDocRef: string;
  FolioRef: string;
  FchRef: string;
  CodRef: 1 | 2 | 3;
  RazonRef?: string;
}

export interface TedDdInput {
  rutEmisor: string;
  tipoDte: string;
  folio: number;
  fchEmis: string;
  rutReceptor: string;
  rznSocReceptor: string;
  mntTotal: number;
  primerItem: string;
  cafDaBlock: string;
  tsted: string;
}

export interface TedNode {
  '@_version': string;
  DD: {
    RE: string;
    TD: string;
    F: number;
    FE: string;
    RR: string;
    RSR: string;
    MNT: number;
    IT1: string;
    CAF: string;
    TSTED: string;
  };
  FRMT: {
    '@_algoritmo': string;
    '#text': string;
  };
}
