/**
 * Small, domain-specific retrieval corpus for product embedding comparisons.
 *
 * The corpus deliberately mixes neutral LATAM Spanish, English cross-language
 * queries, operator phrasing, synonyms, and nearby distractors across grocery,
 * pharmacy, hardware, electronics, and stationery. It is not a universal
 * model leaderboard: it answers whether a candidate is useful for Puntovivo's
 * bounded product-search lane.
 *
 * Relevance grades: 3 = primary answer, 2 = useful alternative, 1 = adjacent
 * result, omitted = irrelevant. Version the corpus whenever a document, query,
 * or grade changes so retained evidence cannot silently drift.
 *
 * @module perf/product-embedding-corpus
 */

export interface ProductEmbeddingDocument {
  id: string;
  text: string;
}

export interface ProductEmbeddingQuery {
  id: string;
  text: string;
  relevance: Readonly<Record<string, 1 | 2 | 3>>;
}

export interface ProductEmbeddingCorpus {
  version: number;
  inputPolicy: 'production-symmetric-raw-v1';
  documents: readonly ProductEmbeddingDocument[];
  queries: readonly ProductEmbeddingQuery[];
}

export const PRODUCT_EMBEDDING_CORPUS = {
  version: 1,
  inputPolicy: 'production-symmetric-raw-v1',
  documents: [
    { id: 'arroz-blanco', text: 'Arroz blanco premium 500 g — grano largo — ABR-0001' },
    { id: 'arroz-integral', text: 'Arroz integral 500 g — grano entero con fibra — ARI-0500' },
    {
      id: 'harina-trigo',
      text: 'Harina de trigo todo uso 1 kg — para pan y repostería — HAR-1000',
    },
    {
      id: 'aceite-girasol',
      text: 'Aceite de girasol 1 L — aceite vegetal para cocinar — ACE-1000',
    },
    { id: 'cafe-molido', text: 'Café molido oscuro 250 g — café tostado para filtrar — CAF-0250' },
    {
      id: 'chocolate-polvo',
      text: 'Chocolate instantáneo en polvo 400 g — bebida de cacao — CHO-0400',
    },
    { id: 'leche-entera', text: 'Leche entera UHT 1 L — leche de vaca — LEC-ENTERA' },
    {
      id: 'leche-sin-lactosa',
      text: 'Leche deslactosada UHT 1 L — leche de vaca sin lactosa — LEC-SL',
    },
    {
      id: 'bebida-avena',
      text: 'Bebida de avena 1 L — alternativa vegetal sin lácteos — AVE-1000',
    },
    {
      id: 'agua-gas',
      text: 'Agua mineral con gas 600 ml — bebida carbonatada sin azúcar — AGG-0600',
    },
    { id: 'gaseosa-cola', text: 'Gaseosa sabor cola 400 ml — bebida azucarada con gas — COL-0400' },
    {
      id: 'detergente-ropa',
      text: 'Detergente líquido para ropa 2 L — lavado de prendas — DET-2000',
    },
    { id: 'lavaloza', text: 'Lavaloza líquido limón 750 ml — jabón para platos — LAV-0750' },
    { id: 'panales-m', text: 'Pañales para bebé talla M paquete x30 — PAN-M30' },
    { id: 'toallas-humedas', text: 'Toallas húmedas para bebé paquete x80 — TOA-080' },
    {
      id: 'acetaminofen',
      text: 'Acetaminofén 500 mg caja x20 tabletas — analgésico y antipirético — ACE-500',
    },
    {
      id: 'ibuprofeno',
      text: 'Ibuprofeno 400 mg caja x20 tabletas — analgésico antiinflamatorio — IBU-400',
    },
    {
      id: 'alcohol-antiseptico',
      text: 'Alcohol antiséptico 70 por ciento 350 ml — desinfección — ALC-350',
    },
    {
      id: 'bloqueador-solar',
      text: 'Protector solar FPS 50 120 ml — bloqueador de amplio espectro — SOL-050',
    },
    { id: 'tornillo-drywall', text: 'Tornillo negro para drywall 1 pulgada caja x100 — TOR-DW1' },
    {
      id: 'clavo-acero',
      text: 'Clavo de acero 2 pulgadas caja x100 — fijación para muro — CLA-200',
    },
    {
      id: 'destornillador-phillips',
      text: 'Destornillador Phillips punta cruz número 2 — DES-PH2',
    },
    { id: 'destornillador-plano', text: 'Destornillador plano 6 mm — punta ranurada — DES-PL6' },
    {
      id: 'taladro-inalambrico',
      text: 'Taladro inalámbrico 20 V con batería — perforación y atornillado — TAL-20V',
    },
    { id: 'broca-concreto', text: 'Broca para concreto 8 mm — perforación de muro — BRO-C08' },
    {
      id: 'cable-cobre',
      text: 'Cable eléctrico de cobre 2,5 mm rollo 100 m — instalación residencial — CAB-25',
    },
    { id: 'extension-electrica', text: 'Extensión eléctrica 5 m con tres tomas — EXT-005' },
    {
      id: 'cinta-teflon',
      text: 'Cinta de teflón para roscas de tubería — sello contra fugas — TEF-012',
    },
    {
      id: 'silicona-sellante',
      text: 'Silicona transparente sellante 280 ml — juntas y filtraciones — SIL-280',
    },
    { id: 'cargador-usbc', text: 'Cargador USB-C 65 W para computador portátil — CAR-C65' },
    { id: 'cable-hdmi', text: 'Cable HDMI 2 m para video y audio digital — HDMI-002' },
    { id: 'audifonos-bluetooth', text: 'Audífonos inalámbricos Bluetooth con micrófono — AUD-BT1' },
    { id: 'bombillo-led', text: 'Bombillo LED luz blanca 9 W rosca E27 — BOM-L09' },
    { id: 'cuaderno', text: 'Cuaderno cuadriculado 100 hojas tamaño carta — CUA-100' },
    { id: 'lapiz', text: 'Lápiz de grafito número 2 unidad — LAP-002' },
    { id: 'marcador', text: 'Marcador permanente negro punta fina — MAR-PN1' },
  ],
  queries: [
    {
      id: 'q-arroz-saludable',
      text: 'arroz con más fibra',
      relevance: { 'arroz-integral': 3, 'arroz-blanco': 1 },
    },
    {
      id: 'q-reposteria',
      text: 'ingrediente para hacer pan y tortas',
      relevance: { 'harina-trigo': 3 },
    },
    { id: 'q-cafe-colar', text: 'café para colar', relevance: { 'cafe-molido': 3 } },
    {
      id: 'q-leche-lactosa',
      text: 'leche para alguien que no tolera lactosa',
      relevance: { 'leche-sin-lactosa': 3, 'bebida-avena': 2, 'leche-entera': 1 },
    },
    {
      id: 'q-lactose-free-en',
      text: 'lactose free milk',
      relevance: { 'leche-sin-lactosa': 3, 'bebida-avena': 2, 'leche-entera': 1 },
    },
    {
      id: 'q-leche-vegetal',
      text: 'leche vegetal',
      relevance: { 'bebida-avena': 3, 'leche-sin-lactosa': 1 },
    },
    {
      id: 'q-sparkling-en',
      text: 'sparkling water without sugar',
      relevance: { 'agua-gas': 3, 'gaseosa-cola': 1 },
    },
    {
      id: 'q-lavar-prendas',
      text: 'algo para lavar la ropa',
      relevance: { 'detergente-ropa': 3, lavaloza: 1 },
    },
    {
      id: 'q-lavar-platos',
      text: 'jabón para lavar platos',
      relevance: { lavaloza: 3, 'detergente-ropa': 1 },
    },
    {
      id: 'q-bebe-limpieza',
      text: 'limpiar al bebé al cambiarlo',
      relevance: { 'toallas-humedas': 3, 'panales-m': 1 },
    },
    {
      id: 'q-fiebre-dolor',
      text: 'pastillas para fiebre y dolor',
      relevance: { acetaminofen: 3, ibuprofeno: 2 },
    },
    {
      id: 'q-pain-reliever-en',
      text: 'pain reliever tablets for fever',
      relevance: { acetaminofen: 3, ibuprofeno: 2 },
    },
    {
      id: 'q-desinfectar',
      text: 'líquido para desinfectar una herida',
      relevance: { 'alcohol-antiseptico': 3 },
    },
    {
      id: 'q-sol',
      text: 'protección para el sol en la piel',
      relevance: { 'bloqueador-solar': 3 },
    },
    {
      id: 'q-tornillo-cruz',
      text: 'herramienta para tornillos de estrella',
      relevance: { 'destornillador-phillips': 3, 'destornillador-plano': 1 },
    },
    {
      id: 'q-screwdriver-en',
      text: 'screwdriver for cross head screws',
      relevance: { 'destornillador-phillips': 3, 'destornillador-plano': 1 },
    },
    {
      id: 'q-perforar-muro',
      text: 'hacer un agujero en una pared de concreto',
      relevance: { 'taladro-inalambrico': 3, 'broca-concreto': 3, 'clavo-acero': 1 },
    },
    {
      id: 'q-cable-casa',
      text: 'cable para instalación eléctrica de una casa',
      relevance: { 'cable-cobre': 3, 'extension-electrica': 1 },
    },
    {
      id: 'q-sellar-rosca',
      text: 'sellar una rosca de tubería que gotea',
      relevance: { 'cinta-teflon': 3, 'silicona-sellante': 1 },
    },
    {
      id: 'q-filtracion',
      text: 'sellante para una junta con filtración',
      relevance: { 'silicona-sellante': 3, 'cinta-teflon': 1 },
    },
    {
      id: 'q-cargar-laptop',
      text: 'cargar computador portátil por usb c',
      relevance: { 'cargador-usbc': 3 },
    },
    {
      id: 'q-tv-computador',
      text: 'conectar el computador al televisor',
      relevance: { 'cable-hdmi': 3 },
    },
    {
      id: 'q-luz-ahorro',
      text: 'bombillo de bajo consumo para luz blanca',
      relevance: { 'bombillo-led': 3 },
    },
    {
      id: 'q-escribir-negro',
      text: 'escribir etiquetas con tinta negra permanente',
      relevance: { marcador: 3, lapiz: 1 },
    },
  ],
} as const satisfies ProductEmbeddingCorpus;
