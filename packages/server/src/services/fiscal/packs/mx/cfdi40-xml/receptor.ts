/**
 * Receptor resolution for CFDI 4.0 serialization (): registered
 * customer vs consumidor final vs foreign buyer.
 *
 * @module services/fiscal/packs/mx/cfdi40-xml/receptor
 */

import type { FiscalAdapterIssueInput } from '../../../adapter.js';
import { RECEPTOR_GENERICO, REGIMEN_RECEPTOR_PUBLICO_GENERAL } from './constants.js';
import { sanitizeName } from './format.js';
import type { ResolvedReceptor } from './types.js';

function buildPublicReceptor(domicilioFiscal: string): ResolvedReceptor {
  return {
    rfc: RECEPTOR_GENERICO.rfcMexicano,
    nombre: RECEPTOR_GENERICO.nombre,
    domicilioFiscal,
    regimenFiscal: REGIMEN_RECEPTOR_PUBLICO_GENERAL,
    usoCfdi: RECEPTOR_GENERICO.usoCfdiPublicoGeneral,
  };
}

function isPostalCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{5}$/.test(value.trim());
}

function toSatCountryCode(value: string | null | undefined): string {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) return RECEPTOR_GENERICO.residenciaFiscalDefault;

  const aliases: Record<string, string> = {
    US: 'USA',
    USA: 'USA',
    'UNITED STATES': 'USA',
    'ESTADOS UNIDOS': 'USA',
    MX: 'MEX',
    MEX: 'MEX',
    MEXICO: 'MEX',
    MÉXICO: 'MEX',
    CO: 'COL',
    COL: 'COL',
    COLOMBIA: 'COL',
  };
  return aliases[normalized] ?? normalized;
}

export function buildReceptor(
  input: FiscalAdapterIssueInput,
  fallbackPostalCode: string
): ResolvedReceptor {
  // Consumidor final: el orchestrator setea taxIdTypeCode='31'
  // (NIT en CO) + taxId='222222222222' cuando customerId es null.
  // Ese mismo path en MX se traduce a XAXX010101000 + UsoCFDI S01.
  const isConsumidorFinal = input.buyer.taxId === '222222222222';
  if (isConsumidorFinal) {
    return buildPublicReceptor(fallbackPostalCode);
  }

  // Receptor extranjero: si país != MX usamos el RFC genérico
  // extranjero + ResidenciaFiscal del país del cliente + UsoCFDI
  // S01 (sin efectos fiscales).
  const isForeign =
    input.buyer.country !== null &&
    input.buyer.country !== undefined &&
    input.buyer.country.toUpperCase() !== 'MX' &&
    input.buyer.country.toUpperCase() !== 'MEX';
  if (isForeign) {
    return {
      rfc: RECEPTOR_GENERICO.rfcExtranjero,
      nombre: sanitizeName(input.buyer.name),
      domicilioFiscal: isPostalCode(input.buyer.city)
        ? input.buyer.city.trim()
        : fallbackPostalCode,
      regimenFiscal: REGIMEN_RECEPTOR_PUBLICO_GENERAL,
      usoCfdi: RECEPTOR_GENERICO.usoCfdiPublicoGeneral,
      residenciaFiscal: toSatCountryCode(input.buyer.country),
      numRegIdTrib: input.buyer.taxId || RECEPTOR_GENERICO.numRegIdTribDefault,
    };
  }

  // El modelo actual de customers no tiene RegimenFiscalReceptor y
  // `city` es texto libre, no código postal. Hasta que
  // capture perfil fiscal MX del receptor, no serializamos esos
  // campos como si fueran datos SAT: caemos a público general.
  return buildPublicReceptor(fallbackPostalCode);
}
