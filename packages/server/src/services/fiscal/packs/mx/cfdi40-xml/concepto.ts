/**
 * Concepto + aggregated-Impuestos builders for CFDI 4.0 serialization
 * (ENG-035b).
 *
 * @module services/fiscal/packs/mx/cfdi40-xml/concepto
 */

import type { FiscalAdapterLine } from '../../../adapter.js';
import {
  formatDecimal,
  inferProductClaveProdServ,
  mapTaxRateToTraslado,
  mapUnitToClaveUnidad,
  type TrasladoData,
} from '../mappings.js';
import { sanitizeName } from './format.js';
import type { ConceptoNode, ImpuestosAgregadosNode, TrasladoNodeAttrs } from './types.js';

function toTrasladoNode(traslado: TrasladoData): TrasladoNodeAttrs {
  return {
    '@_Base': traslado.Base,
    '@_Impuesto': traslado.Impuesto,
    '@_TipoFactor': traslado.TipoFactor,
    ...(traslado.TasaOCuota ? { '@_TasaOCuota': traslado.TasaOCuota } : {}),
    ...(traslado.Importe ? { '@_Importe': traslado.Importe } : {}),
  };
}

export function buildConcepto(line: FiscalAdapterLine): ConceptoNode {
  const claveProd = inferProductClaveProdServ({
    name: line.productName,
    categoryName: null,
  });
  const claveUnit = mapUnitToClaveUnidad(line.unitMeasureCode);
  const taxRateDecimal = line.taxRate > 1 ? line.taxRate / 100 : Math.max(0, line.taxRate);
  const grossAmount = line.quantity * line.unitPrice;
  const grossAfterDiscount = Math.max(0, grossAmount - line.discountAmount);
  const netAmount =
    taxRateDecimal > 0 ? grossAfterDiscount / (1 + taxRateDecimal) : grossAfterDiscount;
  const netUnitPrice = line.quantity === 0 ? 0 : netAmount / line.quantity;
  const baseGravable = netAmount;
  const traslado = mapTaxRateToTraslado(line.taxRate, line.taxAmount, baseGravable);

  const concepto: ConceptoNode = {
    '@_ClaveProdServ': claveProd.code,
    '@_Cantidad': formatDecimal(line.quantity, 6),
    '@_ClaveUnidad': claveUnit.code,
    '@_Unidad': claveUnit.name,
    '@_Descripcion': sanitizeName(line.productName),
    '@_ValorUnitario': formatDecimal(netUnitPrice, 6),
    '@_Importe': formatDecimal(netAmount, 2),
    // ObjetoImp '02' = Sí objeto del impuesto (gravamen IVA).
    // '01' = No objeto, '03' = Sí objeto pero no obligación de
    // desglose. Default '02' para retail con IVA estándar.
    '@_ObjetoImp': line.taxRate > 0 ? '02' : '01',
  };

  if (line.productSku) {
    concepto['@_NoIdentificacion'] = line.productSku;
  }

  // Solo agregamos cfdi:Impuestos al concepto cuando hay obligación
  // de desglose (ObjetoImp='02'). Conceptos sin gravamen omiten el
  // nodo Impuestos por completo.
  if (concepto['@_ObjetoImp'] === '02') {
    concepto['cfdi:Impuestos'] = {
      'cfdi:Traslados': {
        'cfdi:Traslado': toTrasladoNode(traslado),
      },
    };
  }

  return concepto;
}

/**
 * Consolida los Traslados de cada concepto agrupando por (Impuesto,
 * TipoFactor, TasaOCuota). Devuelve `null` cuando ningún concepto
 * tiene gravamen (todos exentos sin obligación de desglose).
 */
export function consolidateImpuestos(
  lines: ReadonlyArray<FiscalAdapterLine>
): ImpuestosAgregadosNode | null {
  type Key = string;
  const buckets = new Map<
    Key,
    {
      base: number;
      importe: number;
      impuesto: string;
      tipoFactor: 'Tasa' | 'Exento';
      // ENG-179b — explicit `| undefined` so `TrasladoData.TasaOCuota`
      // (which carries explicit-undefined for exento rows) maps cleanly.
      tasaOCuota?: string | undefined;
    }
  >();

  let totalTrasladados = 0;

  for (const line of lines) {
    if (line.taxRate === 0 && line.taxAmount === 0) continue;
    const taxRateDecimal = line.taxRate > 1 ? line.taxRate / 100 : Math.max(0, line.taxRate);
    const grossAmount = line.quantity * line.unitPrice;
    const grossAfterDiscount = Math.max(0, grossAmount - line.discountAmount);
    const baseGravable =
      taxRateDecimal > 0 ? grossAfterDiscount / (1 + taxRateDecimal) : grossAfterDiscount;
    const traslado = mapTaxRateToTraslado(line.taxRate, line.taxAmount, baseGravable);
    const key = `${traslado.Impuesto}|${traslado.TipoFactor}|${traslado.TasaOCuota ?? ''}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.base += baseGravable;
      existing.importe += line.taxAmount;
    } else {
      buckets.set(key, {
        base: baseGravable,
        importe: line.taxAmount,
        impuesto: traslado.Impuesto,
        tipoFactor: traslado.TipoFactor,
        tasaOCuota: traslado.TasaOCuota,
      });
    }
    totalTrasladados += line.taxAmount;
  }

  if (buckets.size === 0) return null;

  const traslados = Array.from(buckets.values()).map(bucket => ({
    '@_Base': formatDecimal(bucket.base, 2),
    '@_Impuesto': bucket.impuesto,
    '@_TipoFactor': bucket.tipoFactor,
    ...(bucket.tasaOCuota
      ? {
          '@_TasaOCuota': bucket.tasaOCuota,
          '@_Importe': formatDecimal(bucket.importe, 2),
        }
      : {}),
  }));

  return {
    '@_TotalImpuestosTrasladados': formatDecimal(totalTrasladados, 2),
    'cfdi:Traslados': {
      'cfdi:Traslado': traslados,
    },
  };
}
