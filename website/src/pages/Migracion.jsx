import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Icon } from '../components/Icon.jsx';
import { PageHeader } from '../components/PageHeader.jsx';

// Verbatim CSV sample — SKUs / barcodes are data, not translated.
const SAMPLE_CSV = `sku,barcode,descripcion,costo,precio,iva,unidad,categoria
ARQ-12-PV,7705412000123,Arepa de queso · Pack 12,5800,9500,5,unidad,Panadería
CAF-500-TIN,7702045009982,Café tinto molido 500 g,12200,19900,5,unidad,Bebidas
BLS-M-RCY,7705781100456,Bolsa reciclable mediana,420,1200,19,unidad,Empaque
LCH-1L-LV,7702521011234,Leche larga vida 1 L,3400,5400,0,unidad,Lácteos
HRN-1K-MAZ,7705412009870,Harina de maíz blanca 1 kg,3100,4900,0,unidad,Granos`;

function levelLabel(t, level) {
  if (level === 'auto') return t('migracion.levelAuto');
  if (level === 'asistida') return t('migracion.levelAsistida');
  return t('migracion.levelManual');
}

function SourcePicker() {
  const { t } = useTranslation();
  const sources = t('migracion.sources', { returnObjects: true });
  const [pick, setPick] = useState('loyverse');
  const sel = sources.find(s => s.id === pick) || sources[0];
  return (
    <div className="mg-picker">
      <div className="mg-picker-head">
        <Icon name="git-branch" size={16} color="var(--primary-700)" />
        <span>{t('migracion.pickerHead')}</span>
      </div>
      <div className="mg-picker-grid">
        {sources.map(s => (
          <button
            key={s.id}
            className={'mg-src' + (s.id === pick ? ' on' : '')}
            onClick={() => setPick(s.id)}
          >
            <span className="t">{s.t}</span>
            <span className="d">{s.d}</span>
            <span className={'lvl lvl-' + s.level}>{levelLabel(t, s.level)}</span>
          </button>
        ))}
      </div>
      <div className="mg-picker-foot">
        <Icon name="arrow-right" size={12} color="var(--primary-700)" />
        {t('migracion.pickerFootA')} <b>{sel.t}</b> {t('migracion.pickerFootB')}{' '}
        <em>{t('migracion.pickerFootEm')}</em>
      </div>
    </div>
  );
}

function Steps() {
  const { t } = useTranslation();
  const steps = t('migracion.steps', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="pasos">
      <div className="head">
        <span className="pv-kicker">{t('migracion.stepsKicker')}</span>
        <h2 className="pv-display">{t('migracion.stepsTitle')}</h2>
      </div>
      <ol className="mg-steps">
        {steps.map(s => (
          <li key={s.n} className="mg-step">
            <div className="mg-step-side">
              <span className="num">{s.n}</span>
              <span className="time">
                <Icon name="clock" size={11} /> {s.time}
              </span>
            </div>
            <div className="mg-step-body">
              <h3>{s.t}</h3>
              <p>{s.d}</p>
              <ul>
                {s.checks.map((c, i) => (
                  <li key={i} className={c.ok ? 'ok' : 'warn'}>
                    <Icon name={c.ok ? 'check' : 'alert-triangle'} size={12} />
                    {c.t}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Compatibility() {
  const { t } = useTranslation();
  const mapping = t('migracion.mapping', { returnObjects: true });
  return (
    <section className="pv-shell pv-section">
      <div className="head">
        <span className="pv-kicker">{t('migracion.compatKicker')}</span>
        <h2 className="pv-display">{t('migracion.compatTitle')}</h2>
        <p className="desc">{t('migracion.compatDesc')}</p>
      </div>
      <div className="mg-mapping">
        <div className="mg-tr hd">
          <span>{t('migracion.mapColSystem')}</span>
          <span>{t('migracion.mapColFile')}</span>
          <span>{t('migracion.mapColSku')}</span>
          <span>{t('migracion.mapColName')}</span>
          <span>{t('migracion.mapColCost')}</span>
          <span>{t('migracion.mapColPrice')}</span>
          <span>{t('migracion.mapColIva')}</span>
          <span>{t('migracion.mapColStock')}</span>
          <span>{t('migracion.mapColLevel')}</span>
        </div>
        {mapping.map((m, i) => (
          <div key={i} className="mg-tr">
            <span className="from">{m.from}</span>
            <span className="mono">{m.csv}</span>
            <span className="mono">{m.sku}</span>
            <span className="mono">{m.desc}</span>
            <span className="mono">{m.cost}</span>
            <span className="mono">{m.price}</span>
            <span className="mono">{m.iva}</span>
            <span className="mono">{m.stock}</span>
            <span className={'level ' + m.level.toLowerCase()}>{m.level}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Sample() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section">
      <div className="head">
        <span className="pv-kicker">{t('migracion.sampleKicker')}</span>
        <h2 className="pv-display">{t('migracion.sampleTitle')}</h2>
        <p className="desc">{t('migracion.sampleDesc')}</p>
      </div>
      <div className="mg-sample">
        <div className="mg-sample-head">
          <span className="tab on">{t('migracion.sampleTab1')}</span>
          <span className="tab">{t('migracion.sampleTab2')}</span>
          <span className="tab">{t('migracion.sampleTab3')}</span>
          <span className="spacer" />
          <a className="dl" href="#">
            <Icon name="download" size={13} /> {t('migracion.sampleDownload')}
          </a>
        </div>
        <pre className="mg-sample-pre">{SAMPLE_CSV}</pre>
        <div className="mg-sample-foot">
          <Icon name="info" size={12} /> {t('migracion.sampleFootA')}{' '}
          <span className="mono">0</span>
          {t('migracion.sampleFootB')} <span className="mono">EX</span>.
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const { t } = useTranslation();
  const qs = t('migracion.faq', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="faq">
      <div className="head">
        <span className="pv-kicker">{t('migracion.faqKicker')}</span>
        <h2 className="pv-display">{t('migracion.faqTitle')}</h2>
      </div>
      <div className="mg-faq">
        {qs.map(({ q, a }) => (
          <details key={q}>
            <summary>
              {q}
              <span className="plus">+</span>
            </summary>
            <div className="ans">{a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}

export default function Migracion() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        kicker={t('migracion.kicker')}
        title={
          <>
            {t('migracion.titleA')}
            <em>{t('migracion.titleEm')}</em>
            {t('migracion.titleB')}
          </>
        }
        lead={t('migracion.lead')}
        crumbs={[
          { label: t('migracion.crumbInicio'), to: '/' },
          { label: t('migracion.crumbRecursos') },
          { label: t('migracion.crumbMigracion') },
        ]}
        badges={[
          { label: t('migracion.badgeTime'), tone: 'pv-badge-primary' },
          { label: t('migracion.badgeHuman'), tone: 'pv-badge-amber' },
          { label: t('migracion.badgeNoDowntime'), tone: 'pv-badge-success' },
        ]}
        aside={<SourcePicker />}
      />

      <Steps />
      <Compatibility />
      <Sample />
      <FAQ />

      <section className="pv-shell pv-section">
        <div className="mg-cta">
          <div>
            <span className="pv-kicker">{t('migracion.ctaKicker')}</span>
            <h2
              className="pv-display"
              style={{
                margin: '8px 0 6px',
                fontSize: 'clamp(24px, 2.8vw, 32px)',
                color: 'var(--secondary-950)',
                letterSpacing: '-0.02em',
                lineHeight: 1.1,
              }}
            >
              {t('migracion.ctaTitle')}
            </h2>
            <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 14.5 }}>
              {t('migracion.ctaDesc')}
            </p>
          </div>
          <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="pv-btn pv-btn-primary" to="/contacto">
              <Icon name="calendar" size={14} /> {t('migracion.ctaSchedule')}
            </Link>
            <Link className="pv-btn pv-btn-outline" to="/docs">
              <Icon name="book-open" size={14} /> {t('migracion.ctaRead')}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
