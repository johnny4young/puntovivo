/**
 * ENG-036a — Catálogo SII de giros comerciales (subset curado del
 * CIIU.cl revisión 4).
 *
 * El SII pide al menos un giro declarado al emitir cualquier DTE.
 * El catálogo CIIU.cl tiene ~600 códigos a 5 dígitos; aquí
 * incluimos un subset de ~30 entradas que cubren retail típico
 * LATAM: comercio al por menor, restaurantes, abarrotes, ropa,
 * ferretería, servicios. Son los mismos giros que un operador
 * típico de Puntovivo declararía en su inscripción.
 *
 * Los códigos siguen el formato `NNNN` (4 dígitos sin punto en su
 * representación canónica del SII). El SII también acepta el
 * formato `NN.NN` que se ve en docu antigua, pero el formato sin
 * punto es el vigente desde 2014.
 *
 * @module services/fiscal/packs/cl/catalogs/giroComercial
 */

export interface GiroEntry {
  /** Código CIIU.cl rev 4, p. ej. '4711'. */
  code: string;
  /** Nombre oficial del SII. */
  name: string;
  /** Revisión del catálogo CIIU. Actualmente 4 en todo Chile. */
  ciiuRev: 4;
}

/**
 * Subset curado de ~30 giros comunes en retail LATAM. La selección
 * cubre comercio al por menor (categorías 47XX), comercio al por
 * mayor seleccionado (46XX), restaurantes (5610X), servicios
 * personales y otras categorías que aparecen en POS.
 */
export const GIRO_COMERCIAL_CATALOG: ReadonlyArray<GiroEntry> = [
  // Comercio al por menor (47XX)
  { code: '4711', name: 'Comercio al por menor en almacenes no especializados', ciiuRev: 4 },
  { code: '4719', name: 'Otras actividades de venta al por menor en comercios no especializados', ciiuRev: 4 },
  { code: '4721', name: 'Comercio al por menor de alimentos en comercios especializados', ciiuRev: 4 },
  { code: '4722', name: 'Comercio al por menor de bebidas en comercios especializados', ciiuRev: 4 },
  { code: '4723', name: 'Comercio al por menor de productos del tabaco', ciiuRev: 4 },
  { code: '4730', name: 'Comercio al por menor de combustible para vehículos automotores', ciiuRev: 4 },
  { code: '4741', name: 'Comercio al por menor de computadores, equipos periféricos y software', ciiuRev: 4 },
  { code: '4742', name: 'Comercio al por menor de equipos audio y video', ciiuRev: 4 },
  { code: '4751', name: 'Comercio al por menor de productos textiles', ciiuRev: 4 },
  { code: '4752', name: 'Comercio al por menor de artículos de ferretería, pintura y vidrio', ciiuRev: 4 },
  { code: '4753', name: 'Comercio al por menor de tapices, alfombras y cubrimientos para paredes y pisos', ciiuRev: 4 },
  { code: '4759', name: 'Comercio al por menor de aparatos eléctricos de uso doméstico, muebles, equipos de iluminación', ciiuRev: 4 },
  { code: '4761', name: 'Comercio al por menor de libros, periódicos y artículos de papelería', ciiuRev: 4 },
  { code: '4762', name: 'Comercio al por menor de música y video', ciiuRev: 4 },
  { code: '4763', name: 'Comercio al por menor de artículos deportivos', ciiuRev: 4 },
  { code: '4771', name: 'Comercio al por menor de prendas de vestir, calzado y artículos de cuero', ciiuRev: 4 },
  { code: '4772', name: 'Comercio al por menor de productos farmacéuticos y medicinales', ciiuRev: 4 },
  { code: '4773', name: 'Comercio al por menor de cosméticos y artículos de tocador', ciiuRev: 4 },
  { code: '4774', name: 'Comercio al por menor de artículos de segunda mano', ciiuRev: 4 },

  // Comercio al por mayor selectivo (46XX)
  { code: '4630', name: 'Comercio al por mayor de alimentos, bebidas y tabaco', ciiuRev: 4 },
  { code: '4641', name: 'Comercio al por mayor de productos textiles, prendas de vestir y calzado', ciiuRev: 4 },
  { code: '4690', name: 'Comercio al por mayor no especializado', ciiuRev: 4 },

  // Restaurantes y servicios de comida (561X)
  { code: '5610', name: 'Actividades de restaurantes y de servicio móvil de comidas', ciiuRev: 4 },
  { code: '5621', name: 'Actividades de catering para eventos', ciiuRev: 4 },
  { code: '5629', name: 'Otras actividades de servicio de comidas', ciiuRev: 4 },
  { code: '5630', name: 'Actividades de servicio de bebidas', ciiuRev: 4 },

  // Servicios personales (95XX)
  { code: '9511', name: 'Reparación de computadores y equipo periférico', ciiuRev: 4 },
  { code: '9521', name: 'Reparación de aparatos electrónicos de consumo', ciiuRev: 4 },
  { code: '9602', name: 'Peluquería y otros tratamientos de belleza', ciiuRev: 4 },

  // Reparación de vehículos (4520)
  { code: '4520', name: 'Mantenimiento y reparación de vehículos automotores', ciiuRev: 4 },
];

/**
 * Búsqueda por código CIIU.cl. Acepta el código tal cual (sin
 * normalizar puntos) — el catálogo guarda códigos sin punto.
 */
export function findGiroComercial(code: string): GiroEntry | undefined {
  const normalized = code.replace(/\./g, '');
  return GIRO_COMERCIAL_CATALOG.find(entry => entry.code === normalized);
}
