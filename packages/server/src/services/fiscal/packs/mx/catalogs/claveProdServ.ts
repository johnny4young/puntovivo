/**
 * Catálogo SAT c_ClaveProdServ (subset curado).
 *
 * El SAT publica un catálogo enorme con más de 50 mil claves de
 * producto/servicio basadas en el United Nations Standard Products
 * and Services Code (UNSPSC). La gran mayoría son irrelevantes para
 * retail LATAM (servicios industriales, agrícolas, mineros, etc.).
 *
 * Aquí incluimos un subset de 40 claves que cubren los rubros más
 * comunes en un POS retail LATAM: alimentos, bebidas, abarrotes,
 * limpieza, ferretería, papelería, ropa, electrónica, salud, y
 * servicios. La heurística `inferProductClaveProdServ` (definida en
 * `mappings.ts`) hace match por nombre + categoría contra este
 * subset.
 *
 * El SAT exige que cada concepto del CFDI 4.0 lleve una
 * `ClaveProdServ` válida. Cuando ningún match aplica, caemos a
 * `CLAVE_PROD_SERV_FALLBACK = '01010101'` (No existe en el catálogo)
 * código SAT genérico que el SAT acepta como fallback explícito
 * para mercancía no clasificable.
 *
 * El catálogo completo de 50k+ entradas queda capturado como
 * follow-up work (working title ); requiere o un
 * seed-from-CSV en una tabla DB nueva o un pull periódico del API
 * SAT. Para los pilots de  con PAC el subset curado +
 * fallback es suficiente porque PAC valida + corrige antes de
 * timbrar.
 *
 * @module services/fiscal/packs/mx/catalogs/claveProdServ
 */

export interface ClaveProdServEntry {
  /** Código SAT de 8 dígitos, p. ej. '50171831'. */
  code: string;
  /** Descripción oficial. */
  name: string;
  /**
   * Pista de categoría interna (heurística para
   * `inferProductClaveProdServ`). Cuando el `Product.categoryName`
   * o `Product.name` contiene algún token de esta lista, se favorece
   * este código. La búsqueda es case-insensitive y por substring.
   */
  hints: ReadonlyArray<string>;
}

/**
 * Fallback estándar para productos sin clasificación. El SAT acepta
 * '01010101' (No existe en el catálogo) como código por defecto
 * para mercancía no clasificable. Es preferible a inventar un
 * código aleatorio porque PAC y SAT lo reconocen y permiten
 * timbrado con éste valor explícito (vs rechazo por código
 * inexistente).
 */
export const CLAVE_PROD_SERV_FALLBACK = '01010101';

export const CLAVE_PROD_SERV_CATALOG: ReadonlyArray<ClaveProdServEntry> = [
  // Alimentos y bebidas (5 entries)
  {
    code: '50171831',
    name: 'Pan y productos de panadería',
    hints: ['pan', 'panaderia', 'panadería', 'galleta', 'pastel'],
  },
  {
    code: '50202301',
    name: 'Bebidas no alcohólicas (refrescos, agua)',
    hints: ['refresco', 'soda', 'agua', 'jugo', 'bebida'],
  },
  {
    code: '50131600',
    name: 'Productos lácteos',
    hints: ['leche', 'queso', 'yogur', 'mantequilla', 'crema', 'lacteo', 'lácteo'],
  },
  {
    code: '50112000',
    name: 'Carnes y embutidos',
    hints: ['carne', 'pollo', 'res', 'cerdo', 'embutido', 'jamón', 'jamon'],
  },
  {
    code: '50221200',
    name: 'Frutas y verduras frescas',
    hints: ['fruta', 'verdura', 'manzana', 'plátano', 'platano', 'tomate'],
  },

  // Abarrotes y despensa (4 entries)
  {
    code: '50161509',
    name: 'Azúcar y endulzantes',
    hints: ['azúcar', 'azucar', 'endulzante', 'miel'],
  },
  {
    code: '50161812',
    name: 'Sal y especias',
    hints: ['sal', 'especia', 'pimienta', 'condimento'],
  },
  {
    code: '50171548',
    name: 'Arroz, pastas y cereales',
    hints: ['arroz', 'pasta', 'cereal', 'avena', 'fideo'],
  },
  {
    code: '50211503',
    name: 'Aceites y grasas comestibles',
    hints: ['aceite', 'grasa', 'manteca'],
  },

  // Limpieza y hogar (4 entries)
  {
    code: '47131820',
    name: 'Detergentes y limpiadores',
    hints: ['detergente', 'limpiador', 'jabón', 'jabon', 'cloro', 'limpieza'],
  },
  {
    code: '47131502',
    name: 'Papel higiénico y pañuelos',
    hints: ['papel higiénico', 'papel higienico', 'pañuelo', 'panuelo', 'servilleta'],
  },
  {
    code: '52151501',
    name: 'Utensilios y artículos de cocina',
    hints: ['utensilio', 'cocina', 'olla', 'sartén', 'sarten'],
  },
  {
    code: '52121700',
    name: 'Artículos para el hogar',
    hints: ['hogar', 'casa', 'mueble', 'decoración', 'decoracion'],
  },

  // Ferretería y construcción (3 entries)
  {
    code: '31161500',
    name: 'Tornillos, clavos y fijaciones',
    hints: ['tornillo', 'clavo', 'tuerca', 'fijación', 'fijacion'],
  },
  {
    code: '27112800',
    name: 'Herramientas manuales',
    hints: ['herramienta', 'martillo', 'destornillador', 'pinza', 'llave'],
  },
  {
    code: '30181500',
    name: 'Pinturas y recubrimientos',
    hints: ['pintura', 'barniz', 'recubrimiento'],
  },

  // Papelería y oficina (3 entries)
  {
    code: '14111500',
    name: 'Papel y productos de papel',
    hints: ['papel', 'cuaderno', 'libreta', 'hoja'],
  },
  {
    code: '44121700',
    name: 'Útiles de escritura',
    hints: ['lápiz', 'lapiz', 'pluma', 'bolígrafo', 'boligrafo', 'marcador'],
  },
  {
    code: '60121300',
    name: 'Artículos de oficina',
    hints: ['oficina', 'engrapadora', 'archivero', 'carpeta'],
  },

  // Ropa y calzado (3 entries)
  {
    code: '53102500',
    name: 'Ropa para adultos',
    hints: ['ropa', 'camisa', 'pantalón', 'pantalon', 'vestido', 'blusa'],
  },
  {
    code: '53111500',
    name: 'Calzado',
    hints: ['zapato', 'tenis', 'bota', 'sandalia', 'calzado'],
  },
  {
    code: '53131600',
    name: 'Accesorios de vestir',
    hints: ['cinturón', 'cinturon', 'corbata', 'bufanda', 'gorra'],
  },

  // Electrónica y tecnología (3 entries)
  {
    code: '52161500',
    name: 'Aparatos electrónicos de consumo',
    hints: ['electrónico', 'electronico', 'audífono', 'audifono', 'bocina', 'cargador'],
  },
  {
    code: '43211500',
    name: 'Computadoras y equipos de cómputo',
    hints: ['computadora', 'laptop', 'tablet', 'teclado', 'mouse'],
  },
  {
    code: '26111600',
    name: 'Pilas y baterías',
    hints: ['pila', 'batería', 'bateria'],
  },

  // Salud y belleza (4 entries)
  {
    code: '53131500',
    name: 'Productos de cuidado personal',
    hints: ['cuidado personal', 'desodorante', 'rastrillo', 'crema'],
  },
  {
    code: '53131608',
    name: 'Productos para el cabello',
    hints: ['shampoo', 'champú', 'champu', 'acondicionador', 'cabello'],
  },
  {
    code: '51241200',
    name: 'Productos farmacéuticos OTC',
    hints: ['medicamento', 'pastilla', 'jarabe', 'analgésico', 'analgesico'],
  },
  {
    code: '53131613',
    name: 'Productos dentales y bucales',
    hints: ['dental', 'pasta dental', 'cepillo', 'enjuague'],
  },

  // Mascotas (2 entries)
  {
    code: '10121800',
    name: 'Alimentos para mascotas',
    hints: ['mascota', 'perro', 'gato', 'croqueta', 'pet'],
  },
  {
    code: '10122000',
    name: 'Accesorios para mascotas',
    hints: ['collar', 'correa', 'jaula', 'arenero'],
  },

  // Bebés y niños (2 entries)
  {
    code: '53102716',
    name: 'Ropa y artículos para bebé',
    hints: ['bebé', 'bebe', 'pañal', 'panal', 'biberón', 'biberon'],
  },
  {
    code: '60141100',
    name: 'Juguetes',
    hints: ['juguete', 'muñeca', 'muneca', 'pelota', 'rompecabezas'],
  },

  // Servicios genéricos (3 entries)
  {
    code: '85101500',
    name: 'Servicios médicos',
    hints: ['servicio médico', 'servicio medico', 'consulta'],
  },
  {
    code: '80101500',
    name: 'Servicios de consultoría',
    hints: ['consultoría', 'consultoria', 'asesoría', 'asesoria'],
  },
  {
    code: '78101800',
    name: 'Servicios de transporte',
    hints: ['transporte', 'flete', 'envío', 'envio', 'mensajería', 'mensajeria'],
  },

  // Bebidas alcohólicas (2 entries — categoría con IEPS adicional;
  // SAT pide impuesto IEPS además del IVA en estos productos)
  {
    code: '50202310',
    name: 'Cerveza',
    hints: ['cerveza', 'beer'],
  },
  {
    code: '50202311',
    name: 'Vinos y licores',
    hints: ['vino', 'licor', 'whisky', 'tequila', 'ron', 'vodka'],
  },

  // Tabaco (categoría con IEPS adicional) (1 entry)
  {
    code: '50202309',
    name: 'Tabaco y cigarrillos',
    hints: ['cigarro', 'cigarrillo', 'tabaco'],
  },

  // Mercancía no especificada (fallback explícito como entrada
  // del catálogo para que el reverse-lookup encuentre nombre)
  {
    code: CLAVE_PROD_SERV_FALLBACK,
    name: 'No existe en el catálogo',
    hints: [],
  },
];

/**
 * Lookup directo por código. Devuelve undefined si no existe en el
 * catálogo curado. Para el fallback explícito 01010101 retorna la
 * entrada correspondiente.
 */
export function findClaveProdServ(code: string): ClaveProdServEntry | undefined {
  return CLAVE_PROD_SERV_CATALOG.find(entry => entry.code === code);
}
