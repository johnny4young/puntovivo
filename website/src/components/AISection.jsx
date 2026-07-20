import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Spark, ShieldAlert, MagGlass, CameraInvoice } from './Brand.jsx';
import { RichText } from './RichText.jsx';

// Scenario order + structural (non-translated) data: chart bars and the SQL
// snippet. Question / answer / chips / head labels come from i18n; the SQL is
// kept verbatim as code (not translated), per spec.
const SCENARIO_IDS = ['topProducts', 'cashierTicket', 'marginDairy'];

const SCENARIO_DATA = {
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
    sql: (
      <>
        <span className="cm">-- generado por Co-pilot · auditable</span>
        {'\n'}
        <span className="kw">WITH</span> last_month_sales <span className="kw">AS</span> ({'\n'}
        {'  '}
        <span className="kw">SELECT</span> *{'\n'}
        {'  '}
        <span className="kw">FROM</span> sale_line_items{'\n'}
        {'  '}
        <span className="kw">WHERE</span> sale_date <span className="kw">≥</span> date(
        <span className="str">'now'</span>, <span className="str">'-1 month'</span>){'\n'}
        {'    '}
        <span className="kw">AND</span> site_id = <span className="str">'…Norte'</span>
        {'\n'}){'\n'}
        <span className="kw">SELECT</span> product_id, product_name,{'\n'}
        {'       '}
        <span className="kw">SUM</span>(quantity) <span className="kw">AS</span> total_quantity
        {'\n'}
        <span className="kw">FROM</span> last_month_sales{'\n'}
        <span className="kw">GROUP BY</span> product_id, product_name{'\n'}
        <span className="kw">ORDER BY</span> total_quantity <span className="kw">DESC</span>
        {'\n'}
        <span className="kw">LIMIT</span> <span className="num">10</span>
      </>
    ),
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
    sql: (
      <>
        <span className="cm">-- generado por Co-pilot · auditable</span>
        {'\n'}
        <span className="kw">SELECT</span> cashier_name, site_name,{'\n'}
        {'       '}
        <span className="kw">AVG</span>(total_amount) <span className="kw">AS</span> avg_ticket,
        {'\n'}
        {'       '}
        <span className="kw">COUNT</span>(*) <span className="kw">AS</span> tickets{'\n'}
        <span className="kw">FROM</span> sales{'\n'}
        <span className="kw">WHERE</span> sale_date <span className="kw">≥</span> date(
        <span className="str">'now'</span>, <span className="str">'-7 days'</span>){'\n'}
        {'  '}
        <span className="kw">AND</span> status = <span className="str">'completed'</span>
        {'\n'}
        <span className="kw">GROUP BY</span> cashier_id, site_id{'\n'}
        <span className="kw">ORDER BY</span> avg_ticket <span className="kw">DESC</span>
        {'\n'}
        <span className="kw">LIMIT</span> <span className="num">5</span>
      </>
    ),
    meta: { rows: '5 filas', cost: '$0.00094', ms: '287 ms' },
  },
  marginDairy: {
    unit: '%',
    bars: [
      { i: 1, n: 'Sede Norte', q: '28 %', w: 100 },
      { i: 2, n: 'Sede Centro', q: '24 %', w: 86 },
      { i: 3, n: 'Sede Sur', q: '14 %', w: 50 },
    ],
    sql: (
      <>
        <span className="cm">-- generado por Co-pilot · auditable</span>
        {'\n'}
        <span className="kw">SELECT</span> s.name <span className="kw">AS</span> site,{'\n'}
        {'       '}
        <span className="kw">SUM</span>(sl.price_sold - p.cost){'\n'}
        {'       '}/ <span className="kw">NULLIF</span>(<span className="kw">SUM</span>
        (sl.price_sold), <span className="num">0</span>) * <span className="num">100</span>{' '}
        <span className="kw">AS</span> margin_pct{'\n'}
        <span className="kw">FROM</span> sale_line_items sl{'\n'}
        <span className="kw">JOIN</span> products p <span className="kw">ON</span> p.id =
        sl.product_id{'\n'}
        <span className="kw">JOIN</span> sites s <span className="kw">ON</span> s.id = sl.site_id
        {'\n'}
        <span className="kw">WHERE</span> sl.sale_date <span className="kw">≥</span> date(
        <span className="str">'now'</span>, <span className="str">'-7 days'</span>){'\n'}
        {'  '}
        <span className="kw">AND</span> p.category = <span className="str">'lacteos'</span>
        {'\n'}
        <span className="kw">GROUP BY</span> s.id{'\n'}
        <span className="kw">ORDER BY</span> margin_pct <span className="kw">ASC</span>
      </>
    ),
    meta: { rows: '3 filas', cost: '$0.00102', ms: '344 ms' },
  },
};

const ANOMALIES = [
  { sev: 'alta', typeKey: 'anomTypeTickets', who: 'Camilo · Sur', obs: '23', base: 'vs 1' },
  { sev: 'alta', typeKey: 'anomTypeTickets', who: 'Carolina · Norte', obs: '23', base: 'vs 1' },
  { sev: 'media', typeKey: 'anomTypeReturn', who: 'María · Norte', obs: '$377k', base: 'vs $82k' },
];

const SEM_RESULTS = [
  { nm: 'Yogurt Alpina Fresa 200g', sku: 'LAC-0016', score: 0.92 },
  { nm: 'Leche Alpina UHT 1L', sku: 'LAC-0014', score: 0.81 },
  { nm: 'Crema de leche 250ml', sku: 'LAC-0018', score: 0.64 },
];

const OCR_FIELDS = [
  { key: 'ocrFieldProvider', v: 'Lácteos El Campo', match: true },
  { key: 'ocrFieldNit', v: '900.421.118-3', match: false },
  { key: 'ocrFieldLines', valueKey: 'ocrFieldLinesValue', match: false },
  { key: 'ocrFieldSubtotal', v: '$ 164.600', match: false },
  { key: 'ocrFieldTotal', v: '$ 174.600', match: true, em: true },
];

const STATUS_ITEMS = [
  { tagKey: 'tagNext' },
  { tagKey: 'tagNext' },
  { tagKey: 'tagNext' },
  { tagKey: 'tagBeta', coming: true },
  { tagKey: 'tagBeta', coming: true },
];

export function AISection({ version }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  // The core pill shows the real tag once a release exists, otherwise a neutral
  // "open source" label — never a fabricated version.
  const corePill = version ? t('ai.corePillTagged', { version }) : t('ai.corePillDev');

  useEffect(() => {
    if (paused) return undefined;
    const id = setInterval(() => {
      setActive(prev => (prev + 1) % SCENARIO_IDS.length);
    }, 9000);
    return () => clearInterval(id);
  }, [paused]);

  useEffect(() => {
    if (!paused) return undefined;
    const id = setTimeout(() => setPaused(false), 14000);
    return () => clearTimeout(id);
  }, [paused, active]);

  function jumpTo(idx) {
    setActive(idx);
    setPaused(true);
  }

  const scenId = SCENARIO_IDS[active];
  const scen = SCENARIO_DATA[scenId];
  const scenKey = `ai.scenarios.${scenId}`;
  const chips = t(`${scenKey}.chips`, { returnObjects: true });
  const anomDescIds = t('ai.roadmap.items', { returnObjects: true });

  return (
    <section className="pv-shell pv-section" id="ai">
      <div className="head">
        <span className="pv-kicker">{t('ai.kicker')}</span>
        <h2 className="pv-display">
          {t('ai.titleA')}
          <em style={{ fontStyle: 'normal', color: 'var(--primary-700)' }}>{t('ai.titleEm')}</em>
          {t('ai.titleB')}
        </h2>
        <p className="desc">{t('ai.desc')}</p>
      </div>

      {/* Core bar */}
      <div className="ai-corebar">
        <span className="core-pill">
          <span className="sparkle">
            <Spark size={11} strokeWidth={2.4} />
          </span>
          {corePill}
        </span>
        <span className="meta">
          <span className="live-d" />
          {t('ai.coreMeta')}
        </span>
      </div>

      {/* Co-pilot hero pane */}
      <div className="ai-hero">
        <div className="ai-hero-grid">
          <div className="ai-hero-left">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="pv-badge pv-badge-primary">
                <span className="dot" /> {t('ai.copilotBadge')}
              </span>
              <span className="pv-label">{t('ai.copilotLabel')}</span>
            </div>
            <h3>
              {t('ai.copilotTitleA')}
              <em>{t('ai.copilotTitleEm')}</em>
            </h3>
            <p className="lead">{t('ai.copilotLead')}</p>

            <div className="ai-convo">
              <div className="ai-bubble-user ai-fade" key={`q-${scenId}`}>
                {t(`${scenKey}.q`)}
              </div>

              <div className="ai-bubble-ai ai-fade" key={`a-${scenId}`}>
                <div className="head">
                  <span className="pip">
                    <span className="dot" />
                  </span>
                  {t('ai.responseLabel')}
                </div>
                <div className="ans">
                  <RichText text={t(`${scenKey}.ans`)} />
                </div>
                <div className="chips">
                  {chips.map(c => (
                    <span key={c} className="chip">
                      {c}
                    </span>
                  ))}
                </div>
                <div className="foot">
                  <span className="src">openai · gpt-4.1-mini</span>
                  <span className="mono">{scen.meta.rows}</span>
                  <span className="mono">·</span>
                  <span className="mono">{scen.meta.cost}</span>
                  <span className="mono">·</span>
                  <span className="mono">{scen.meta.ms}</span>
                </div>
              </div>
            </div>

            <div className="ai-input">
              <Spark size={16} stroke="var(--primary-700)" />
              <span className="ph">{t('ai.inputPlaceholder')}</span>
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <span className="pv-key">Alt</span>
                <span className="pv-key">K</span>
              </span>
            </div>
          </div>

          <div className="ai-hero-right">
            <div className="ai-result-head">
              <div className="l">
                <span className="ttl ai-fade" key={`h-${scenId}`}>
                  {t(`${scenKey}.headTitle`)}
                </span>
                <span className="sub">{t(`${scenKey}.headSub`)}</span>
              </div>
              <div className="ai-rotate-dots" role="tablist" aria-label={t('ai.scenarioAria')}>
                {SCENARIO_IDS.map((id, i) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={i === active}
                    aria-label={t('ai.scenarioLabel', { n: i + 1 })}
                    className={`dot${i === active ? ' on' : ''}`}
                    onClick={() => jumpTo(i)}
                  />
                ))}
              </div>
            </div>

            <div className="ai-bars ai-fade" key={`b-${scenId}`}>
              {scen.bars.map(p => (
                <div key={p.i}>
                  <div className="ai-bar-row">
                    <span className="nm">
                      <span className="idx">{p.i}</span> {p.n}
                    </span>
                    <span className="v">
                      {p.q}
                      {scen.unit ? ` ${scen.unit}` : ''}
                    </span>
                  </div>
                  <div className="ai-bar-track">
                    <div className="ai-bar-fill" style={{ width: `${p.w}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <pre className="ai-sql ai-fade" key={`s-${scenId}`}>
              {scen.sql}
            </pre>

            <div className="ai-result-foot">
              <span>
                openai / gpt-4.1-mini · {scen.meta.rows} · {scen.meta.cost}
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span className="pv-key">↵</span> {t('ai.askAgain')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3 capability cards */}
      <div className="ai-cards">
        {/* Card 1 · Anomalies */}
        <div className="pv-card ai-card">
          <div className="cap-head">
            <span className="ic warn">
              <ShieldAlert size={18} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h4>{t('ai.cards.anomaliesTitle')}</h4>
              <span className="pv-label" style={{ fontSize: '0.66rem' }}>
                {t('ai.cards.anomaliesLabel')}
              </span>
            </div>
          </div>
          <p className="desc">
            <RichText text={t('ai.cards.anomaliesDesc')} />
          </p>

          <div className="ai-anom">
            {ANOMALIES.map((a, i) => (
              <div key={i} className="ai-anom-row">
                <span className={`lbl ${a.sev}`}>
                  <span className="d" />
                  {a.sev === 'alta' ? t('ai.cards.sevHigh') : t('ai.cards.sevMed')}
                </span>
                <span className="nm">
                  {t(`ai.cards.${a.typeKey}`)} <small>{a.who}</small>
                </span>
                <span className="vs">
                  <span className="obs">{a.obs}</span>
                  <span className="base">{a.base}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="foot">{t('ai.cards.anomaliesFoot')}</div>
        </div>

        {/* Card 2 · Semantic search */}
        <div className="pv-card ai-card">
          <div className="cap-head">
            <span className="ic">
              <MagGlass size={18} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h4>{t('ai.cards.semanticTitle')}</h4>
              <span className="pv-label" style={{ fontSize: '0.66rem' }}>
                {t('ai.cards.semanticLabelA')}
                <em style={{ fontStyle: 'normal', color: 'var(--brand-accent-700)' }}>
                  {t('ai.cards.semanticLabelEm')}
                </em>
              </span>
            </div>
          </div>
          <p className="desc">
            <RichText text={t('ai.cards.semanticDesc')} />
          </p>

          <div className="ai-sem-input">
            <Spark size={16} stroke="var(--brand-accent-700)" />
            <span className="ph">{t('ai.cards.semanticQuery')}</span>
            <span className="caret" />
            <span className="ai-sem-tag">{t('ai.cards.semanticTag')}</span>
          </div>

          <div className="ai-sem-results">
            {SEM_RESULTS.map(r => (
              <div key={r.sku} className="ai-sem-result">
                <span className="nm">
                  {r.nm} <small>{r.sku}</small>
                </span>
                <span className="score">
                  <span className="bar">
                    <span className="fill" style={{ width: `${Math.round(r.score * 100)}%` }} />
                  </span>
                  {r.score.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          <div className="foot">{t('ai.cards.semanticFoot')}</div>
        </div>

        {/* Card 3 · OCR invoice */}
        <div className="pv-card ai-card">
          <div className="cap-head">
            <span className="ic amber">
              <CameraInvoice size={18} />
            </span>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h4>{t('ai.cards.ocrTitle')}</h4>
              <span className="pv-label" style={{ fontSize: '0.66rem' }}>
                {t('ai.cards.ocrLabel')}
              </span>
            </div>
          </div>
          <p className="desc">
            <RichText text={t('ai.cards.ocrDesc')} />
          </p>

          <div className="ai-ocr">
            <div className="ai-ocr-paper">
              <div className="corner">F-2026-1842</div>
              <div style={{ fontWeight: 'bold', fontSize: 8 }}>LÁCTEOS EL CAMPO S.A.S.</div>
              <div>NIT 900.421.118-3</div>
              <div>Cl 14 #28-30 · Bogotá</div>
              <hr />
              <div className="row">
                <span>Crema leche 250ml × 24</span>
                <span>$ 84.000</span>
              </div>
              <div className="row">
                <span>Yogurt fresa 200g × 60</span>
                <span>$ 56.400</span>
              </div>
              <div className="row">
                <span>Queso campesino × 12</span>
                <span>$ 24.200</span>
              </div>
              <hr />
              <div className="row">
                <span>SUBTOTAL</span>
                <span>$ 164.600</span>
              </div>
              <div className="row">
                <span>IVA 19%</span>
                <span>$ 10.000</span>
              </div>
              <div className="row" style={{ fontWeight: 'bold' }}>
                <span>TOTAL</span>
                <span>$ 174.600</span>
              </div>
              <div className="scan-band" />
            </div>

            <div className="ai-ocr-fields">
              {OCR_FIELDS.map(f => {
                const value = f.valueKey ? t(`ai.cards.${f.valueKey}`) : f.v;
                return (
                  <div key={f.key} className={`ai-ocr-field${f.match ? ' match' : ''}`}>
                    <span className="k">{t(`ai.cards.${f.key}`)}</span>
                    <span className="v">{f.em ? <em>{value}</em> : value}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="foot">{t('ai.cards.ocrFoot')}</div>
        </div>
      </div>

      {/* Public status strip */}
      <div className="ai-roadmap">
        <div className="l">
          <span className="kicker">{t('ai.roadmap.kicker')}</span>
          <span className="ttl">{t('ai.roadmap.title')}</span>
          <p>
            <RichText text={t('ai.roadmap.desc')} />
          </p>
        </div>
        <div className="r">
          {STATUS_ITEMS.map((r, i) => (
            <span key={i} className={`chip${r.coming ? ' coming' : ''}`}>
              <span className="tag">{t(`ai.roadmap.${r.tagKey}`)}</span>
              {anomDescIds[i]}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function AIFaq() {
  const { t } = useTranslation();
  const items = t('aiFaq.items', { returnObjects: true });

  return (
    <section className="pv-shell pv-section" id="ai-faq">
      <div className="ai-faq-wrap">
        <div className="head">
          <div className="l">
            <span className="kicker">{t('aiFaq.kicker')}</span>
            <h3>{t('aiFaq.title')}</h3>
            <p>{t('aiFaq.desc')}</p>
          </div>
          <span className="badge-trust">
            <span className="d" /> {t('aiFaq.badge')}
          </span>
        </div>
        <div className="pv-faq">
          {items.map(({ q, a }) => (
            <details key={q}>
              <summary>
                {q}
                <span className="plus">+</span>
              </summary>
              <div className="ans">{a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
