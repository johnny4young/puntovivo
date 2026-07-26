// Structural (non-translated) data for the Co-pilot demo: chart bars, the SQL
// snippet and the run metadata. Question / answer / chips / head labels come
// from i18n; the SQL is kept verbatim as code, per spec.
//
// The React version built the SQL as JSX. Here each snippet is a small HTML
// string that the component inlines — it is authored in this file, never from
// user or translation input, so there is nothing to escape.

export const SCENARIO_IDS = ['topProducts', 'cashierTicket', 'marginDairy'];

const COMMENT = '<span class="cm">-- generado por Co-pilot · auditable</span>';
const kw = word => `<span class="kw">${word}</span>`;
const str = value => `<span class="str">${value}</span>`;
const num = value => `<span class="num">${value}</span>`;

export const SCENARIO_DATA = {
  topProducts: {
    unit: 'u',
    bars: [
      { i: 1, n: 'Carne de res molida 500g', q: 37, w: 100 },
      { i: 2, n: 'Papel Higiénico x12', q: 33, w: 89 },
      { i: 3, n: 'Pasta Doria Espagueti', q: 32, w: 86 },
      { i: 4, n: 'Costilla de cerdo 1kg', q: 31, w: 84 },
      { i: 5, n: 'Pegante barra Pritt', q: 28, w: 76 },
      { i: 6, n: 'Empanada de carne', q: 28, w: 76 },
      { i: 7, n: 'Aguardiente Antioqueño 750ml', q: 24, w: 65 },
    ],
    sql: [
      COMMENT,
      `${kw('WITH')} last_month_sales ${kw('AS')} (`,
      `  ${kw('SELECT')} *`,
      `  ${kw('FROM')} sale_line_items`,
      `  ${kw('WHERE')} sale_date ${kw('≥')} date(${str("'now'")}, ${str("'-1 month'")})`,
      `    ${kw('AND')} site_id = ${str("'…Norte'")}`,
      ')',
      `${kw('SELECT')} product_id, product_name,`,
      `       ${kw('SUM')}(quantity) ${kw('AS')} total_quantity`,
      `${kw('FROM')} last_month_sales`,
      `${kw('GROUP BY')} product_id, product_name`,
      `${kw('ORDER BY')} total_quantity ${kw('DESC')}`,
      `${kw('LIMIT')} ${num('10')}`,
    ].join('\n'),
    meta: { rows: '10 filas', cost: '$0.00088', ms: '312 ms' },
  },
  cashierTicket: {
    unit: '',
    bars: [
      { i: 1, n: 'Carolina Cajera (Norte)', q: '$48.200', w: 100 },
      { i: 2, n: 'María R. (Centro)', q: '$39.140', w: 81 },
      { i: 3, n: 'Camilo Cajero (Sur)', q: '$33.800', w: 70 },
      { i: 4, n: 'Lina Vega (Norte)', q: '$28.900', w: 60 },
      { i: 5, n: 'Andrés P. (Centro)', q: '$24.100', w: 50 },
    ],
    sql: [
      COMMENT,
      `${kw('SELECT')} cashier_name, site_name,`,
      `       ${kw('AVG')}(total_amount) ${kw('AS')} avg_ticket,`,
      `       ${kw('COUNT')}(*) ${kw('AS')} tickets`,
      `${kw('FROM')} sales`,
      `${kw('WHERE')} sale_date ${kw('≥')} date(${str("'now'")}, ${str("'-7 days'")})`,
      `  ${kw('AND')} status = ${str("'completed'")}`,
      `${kw('GROUP BY')} cashier_id, site_id`,
      `${kw('ORDER BY')} avg_ticket ${kw('DESC')}`,
      `${kw('LIMIT')} ${num('5')}`,
    ].join('\n'),
    meta: { rows: '5 filas', cost: '$0.00094', ms: '287 ms' },
  },
  marginDairy: {
    unit: '%',
    bars: [
      { i: 1, n: 'Sede Norte', q: '28 %', w: 100 },
      { i: 2, n: 'Sede Centro', q: '24 %', w: 86 },
      { i: 3, n: 'Sede Sur', q: '14 %', w: 50 },
    ],
    sql: [
      COMMENT,
      `${kw('SELECT')} s.name ${kw('AS')} site,`,
      `       ${kw('SUM')}(sl.price_sold - p.cost)`,
      `       / ${kw('NULLIF')}(${kw('SUM')}(sl.price_sold), ${num('0')}) * ${num('100')} ${kw('AS')} margin_pct`,
      `${kw('FROM')} sale_line_items sl`,
      `${kw('JOIN')} products p ${kw('ON')} p.id = sl.product_id`,
      `${kw('JOIN')} sites s ${kw('ON')} s.id = sl.site_id`,
      `${kw('WHERE')} sl.sale_date ${kw('≥')} date(${str("'now'")}, ${str("'-7 days'")})`,
      `  ${kw('AND')} p.category = ${str("'lacteos'")}`,
      `${kw('GROUP BY')} s.id`,
      `${kw('ORDER BY')} margin_pct ${kw('ASC')}`,
    ].join('\n'),
    meta: { rows: '3 filas', cost: '$0.00102', ms: '344 ms' },
  },
};

export const ANOMALIES = [
  { sev: 'alta', typeKey: 'anomTypeTickets', who: 'Camilo · Sur', obs: '23', base: 'vs 1' },
  { sev: 'alta', typeKey: 'anomTypeTickets', who: 'Carolina · Norte', obs: '23', base: 'vs 1' },
  { sev: 'media', typeKey: 'anomTypeReturn', who: 'María · Norte', obs: '$377k', base: 'vs $82k' },
];

export const SEM_RESULTS = [
  { nm: 'Yogurt Alpina Fresa 200g', sku: 'LAC-0016', score: 0.92 },
  { nm: 'Leche Alpina UHT 1L', sku: 'LAC-0014', score: 0.81 },
  { nm: 'Crema de leche 250ml', sku: 'LAC-0018', score: 0.64 },
];

export const OCR_FIELDS = [
  { key: 'ocrFieldProvider', v: 'Lácteos El Campo', match: true },
  { key: 'ocrFieldNit', v: '900.421.118-3', match: false },
  { key: 'ocrFieldLines', valueKey: 'ocrFieldLinesValue', match: false },
  { key: 'ocrFieldSubtotal', v: '$ 164.600', match: false },
  { key: 'ocrFieldTotal', v: '$ 174.600', match: true, em: true },
];

export const STATUS_ITEMS = [
  { tagKey: 'tagNext' },
  { tagKey: 'tagNext' },
  { tagKey: 'tagNext' },
  { tagKey: 'tagBeta', coming: true },
  { tagKey: 'tagBeta', coming: true },
];
