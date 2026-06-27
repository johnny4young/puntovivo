import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon.jsx';
import { PageHeader } from '../components/PageHeader.jsx';

const COLUMN_KEYS = ['now', 'next', 'later'];

function SizeBadge({ size }) {
  const { t } = useTranslation();
  const map = {
    S: `S · ${t('roadmap.sizeWeek')}`,
    M: `M · ${t('roadmap.sizeWeeks')}`,
    L: `L · ${t('roadmap.sizeMonths')}`,
    XL: `XL · ${t('roadmap.sizeQuarter')}`,
  };
  return (
    <span className="rm-size" data-size={size}>
      {size}
      <span className="exp">{map[size] || size}</span>
    </span>
  );
}

// Cards no longer show fabricated vote counts or "beta site" social proof — the
// roadmap is honest forward-looking work, not adoption signal.
function Card({ item }) {
  return (
    <article className="rm-card">
      <header>
        <span className="area">{item.area}</span>
        <SizeBadge size={item.size} />
      </header>
      <h4>{item.t}</h4>
      <p>{item.d}</p>
    </article>
  );
}

function Column({ colKey }) {
  const { t } = useTranslation();
  const col = t(`roadmap.columns.${colKey}`, { returnObjects: true });
  return (
    <section className={'rm-col rm-col-' + colKey}>
      <header className="rm-col-head">
        <div>
          <span className="rm-col-kicker">{col.kicker}</span>
          <h3 className="pv-display">{col.label}</h3>
        </div>
        <span className="rm-col-count">{col.items.length}</span>
      </header>
      <p className="rm-col-desc">{col.desc}</p>
      <div className="rm-col-list">
        {col.items.map((it, i) => (
          <Card key={i} item={it} />
        ))}
      </div>
    </section>
  );
}

function Filters() {
  const { t } = useTranslation();
  const areas = t('roadmap.filterAreas', { returnObjects: true });
  return (
    <div className="rm-filters">
      <span className="pv-label">{t('roadmap.filtersTitle')}</span>
      <div className="rm-filter-row">
        {areas.map((a, i) => (
          <span key={a} className={'rm-chip' + (i === 0 ? ' on' : '')}>
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

function Vote() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section">
      <div className="rm-vote">
        <div className="rm-vote-l">
          <span className="pv-kicker">{t('roadmap.voteKicker')}</span>
          <h2 className="pv-display">{t('roadmap.voteTitle')}</h2>
          <p>{t('roadmap.voteDesc')}</p>
        </div>
        <div className="rm-vote-r">
          <div className="rm-vote-input">
            <Icon name="lightbulb" size={16} color="var(--primary-700)" />
            <span className="ph">{t('roadmap.votePlaceholder')}</span>
            <span className="key">
              <span className="pv-key">⏎</span>
            </span>
          </div>
          <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              className="pv-btn pv-btn-primary pv-btn-sm"
              href="https://github.com/johnny4young/puntovivo/issues/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="send" size={14} /> {t('roadmap.voteSend')}
            </a>
            <a
              className="pv-btn pv-btn-outline pv-btn-sm"
              href="https://github.com/johnny4young/puntovivo/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="github" size={14} /> {t('roadmap.voteIssues')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Shipped() {
  const { t } = useTranslation();
  const shipped = t('roadmap.shipped', { returnObjects: true });
  return (
    <section className="pv-shell pv-section">
      <div className="head">
        <span className="pv-kicker">{t('roadmap.shippedKicker')}</span>
        <h2 className="pv-display">{t('roadmap.shippedTitle')}</h2>
      </div>
      <div className="rm-shipped">
        {shipped.map((s, i) => (
          <div key={i} className="rm-ship-row">
            <span className="when">{s.when}</span>
            <span className="line" />
            <span className="t">{s.t}</span>
            <span className="area">{s.area}</span>
            <Icon name="check" size={14} color="var(--success-700)" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <div className="rm-legend">
      <span className="pv-label">{t('roadmap.legendTitle')}</span>
      <div className="rm-legend-row">
        <span className="rm-leg">
          <span className="dot now" />
          {t('roadmap.legendNow')}
        </span>
        <span className="rm-leg">
          <span className="dot next" />
          {t('roadmap.legendNext')}
        </span>
        <span className="rm-leg">
          <span className="dot later" />
          {t('roadmap.legendLater')}
        </span>
        <span className="rm-sep">·</span>
        <span className="rm-leg">
          <span className="rm-size" data-size="S">
            S
          </span>
          {t('roadmap.sizeWeek')}
        </span>
        <span className="rm-leg">
          <span className="rm-size" data-size="M">
            M
          </span>
          {t('roadmap.sizeWeeks')}
        </span>
        <span className="rm-leg">
          <span className="rm-size" data-size="L">
            L
          </span>
          {t('roadmap.sizeMonths')}
        </span>
        <span className="rm-leg">
          <span className="rm-size" data-size="XL">
            XL
          </span>
          {t('roadmap.sizeQuarter')}
        </span>
      </div>
    </div>
  );
}

export default function Roadmap() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        kicker={t('roadmap.kicker')}
        title={
          <>
            {t('roadmap.titleA')}
            <br /> {t('roadmap.titleB')}
            <em>{t('roadmap.titleEm')}</em>
            {t('roadmap.titleC')}
          </>
        }
        lead={t('roadmap.lead')}
        crumbs={[
          { label: t('roadmap.crumbInicio'), to: '/' },
          { label: t('roadmap.crumbEmpresa') },
          { label: t('roadmap.crumbRoadmap') },
        ]}
        badges={[
          { label: t('roadmap.badgeUpdated'), tone: 'pv-badge-primary' },
          { label: t('roadmap.badgeIdeas'), tone: 'pv-badge-amber' },
          { label: t('roadmap.badgePublic'), tone: 'pv-badge-neutral' },
        ]}
        aside={<Legend />}
      />

      <section className="pv-shell pv-section" style={{ paddingTop: 48 }}>
        <Filters />
        <div className="rm-board">
          {COLUMN_KEYS.map(key => (
            <Column key={key} colKey={key} />
          ))}
        </div>
      </section>

      <Shipped />
      <Vote />
    </>
  );
}
