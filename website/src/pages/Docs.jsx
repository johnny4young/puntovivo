import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Icon } from '../components/Icon.jsx';
import { PageHeader } from '../components/PageHeader.jsx';

// Per-card icon (order matches docs.categories in the locale files).
const CATEGORY_ICONS = [
  'rocket',
  'scan-line',
  'wallet',
  'warehouse',
  'arrow-left-right',
  'shopping-cart',
  'shield-check',
  'sparkles',
  'code-2',
];
const CATEGORY_COUNTS = [12, 28, 14, 23, 9, 18, 16, 11, 21];
// Per-sidebar-row icon (order matches docs.sidebarItems).
const SIDEBAR_ICONS = [
  'rocket',
  'scan-line',
  'wallet',
  'warehouse',
  'arrow-left-right',
  'shopping-cart',
  'shield-check',
  'sparkles',
  'code-2',
  'history',
];

// The blind-close payload is code, not prose — kept verbatim (not translated).
const CLOSE_PAYLOAD = `POST /tenants/:tnt/sedes/:sede/cierres
{
  "session_id": "ses_pv_001824",
  "denominaciones": {
    "100000": 2,
    "50000":  6,
    "20000":  3,
    "10000":  4,
    "5000":   2,
    "2000":   5,
    "1000":  10,
    "500":   12,
    "200":   18,
    "100":   24
  },
  "ciego": true
}`;

function Search() {
  const { t } = useTranslation();
  return (
    <div className="dc-search">
      <Icon name="search" size={18} color="var(--primary-700)" />
      <span className="ph">
        {t('docs.searchPre')} <em>“{t('docs.searchTerm1')}”</em>, <em>“{t('docs.searchTerm2')}”</em>
        , <em>“{t('docs.searchTerm3')}”</em>…
      </span>
      <span className="caret" />
      <span className="key">
        <span className="pv-key">⌘</span>
        <span className="pv-key">K</span>
      </span>
    </div>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  const items = t('docs.sidebarItems', { returnObjects: true });
  const sub = t('docs.sidebarSub', { returnObjects: true });
  return (
    <aside className="dc-sidebar">
      <div className="dc-sidebar-head">
        <span className="pv-label">{t('docs.sidebarTitle')}</span>
        <span className="count">154</span>
      </div>
      <nav>
        {items.map((label, idx) => {
          const active = idx === 0;
          return (
            <div key={label} className={'dc-side-group' + (active ? ' is-active' : '')}>
              <a className="dc-side-link">
                <Icon name={SIDEBAR_ICONS[idx]} size={14} />
                <span>{label}</span>
                {active && <Icon name="chevron-right" size={14} />}
              </a>
              {active && (
                <ul>
                  {sub.map((s, i) => (
                    <li key={s} className={i === 2 ? 'on' : ''}>
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function Categories() {
  const { t } = useTranslation();
  const cats = t('docs.categories', { returnObjects: true });
  return (
    <div className="dc-cats">
      {cats.map((c, i) => (
        <a key={c.t} className="dc-cat" href="#">
          <div className="dc-cat-head">
            <span className="glyph">
              <Icon name={CATEGORY_ICONS[i]} size={18} />
            </span>
            <span className="dc-cat-tag">{c.tag}</span>
          </div>
          <h3>{c.t}</h3>
          <p>{c.d}</p>
          <footer>
            <span className="count">
              <Icon name="file-text" size={11} />{' '}
              {t('docs.categoryArticles', { count: CATEGORY_COUNTS[i] })}
            </span>
            <span className="arrow">
              <Icon name="arrow-right" size={14} />
            </span>
          </footer>
        </a>
      ))}
    </div>
  );
}

function Popular() {
  const { t } = useTranslation();
  const popular = t('docs.popular', { returnObjects: true });
  return (
    <div className="dc-popular">
      <header>
        <span className="pv-kicker">{t('docs.popularKicker')}</span>
        <h2 className="pv-display">{t('docs.popularTitle')}</h2>
      </header>
      <ol className="dc-popular-list">
        {popular.map((p, i) => (
          <li key={i} className="dc-popular-row">
            <span className="rank">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <span className="t">{p.t}</span>
              <span className="m">
                <span className="tag">{p.tag}</span> · <span className="mono">{p.time}</span>
              </span>
            </div>
            <Icon name="arrow-up-right" size={14} color="var(--fg3)" />
          </li>
        ))}
      </ol>
    </div>
  );
}

function ArticlePreview() {
  const { t } = useTranslation();
  const onpage = t('docs.onpage', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="ejemplo">
      <div className="head">
        <span className="pv-kicker">{t('docs.exampleKicker')}</span>
        <h2 className="pv-display">{t('docs.exampleTitle')}</h2>
        <p className="desc">{t('docs.exampleDesc')}</p>
      </div>
      <div className="dc-article-shell">
        <div className="dc-article-side">
          <span className="dc-crumb">{t('docs.articleCrumb')}</span>
          <ul className="dc-onpage">
            {onpage.map((o, i) => (
              <li key={o} className={i === 0 ? 'on' : ''}>
                {i === 0 && <Icon name="dot" size={10} />} {o}
              </li>
            ))}
          </ul>
          <div className="dc-onpage-foot">
            <Icon name="edit-3" size={11} /> {t('docs.onpageFoot')}
          </div>
        </div>

        <article className="dc-article">
          <div className="dc-art-head">
            <div className="dc-art-meta">
              <span className="tag">{t('docs.artTag')}</span>
              <span className="sep">·</span>
              <span className="mono">{t('docs.artReadTime')}</span>
              <span className="sep">·</span>
              <span className="mono">{t('docs.artUpdated')}</span>
            </div>
            <h1 className="pv-display">{t('docs.artTitle')}</h1>
            <p className="dc-art-lead">{t('docs.artLead')}</p>
          </div>

          <div className="dc-callout">
            <Icon name="info" size={16} color="var(--primary-700)" />
            <div>
              <b>{t('docs.calloutLabel')}</b> · {t('docs.calloutText')}
            </div>
          </div>

          <h2>{t('docs.artH2Flow')}</h2>
          <p className="dc-p">{t('docs.artFlowP')}</p>

          <pre className="dc-pre">
            <span className="dim">{t('docs.artPreComment')}</span>
            <br />
            {CLOSE_PAYLOAD}
          </pre>

          <h2>{t('docs.artH2Diff')}</h2>
          <p className="dc-p">
            {t('docs.artDiffP1')} <span className="dc-inline">{t('docs.artDiffP2')}</span>,{' '}
            <span className="dc-inline ok">{t('docs.artDiffP3')}</span>{' '}
            <span className="dc-inline warn">{t('docs.artDiffP4')}</span> {t('docs.artDiffP5')}
          </p>

          <div className="dc-table">
            <div className="dc-tr hd">
              <span>{t('docs.tableState')}</span>
              <span>{t('docs.tableMeaning')}</span>
              <span>{t('docs.tableAction')}</span>
            </div>
            <div className="dc-tr">
              <span className="dc-inline ok">{t('docs.tableSquared')}</span>
              <span>{t('docs.tableSquaredMeaning')}</span>
              <span className="mono">{t('docs.tableSquaredAction')}</span>
            </div>
            <div className="dc-tr">
              <span className="dc-inline warn">{t('docs.tableOver')}</span>
              <span>{t('docs.tableOverMeaning')}</span>
              <span>{t('docs.tableOverAction')}</span>
            </div>
            <div className="dc-tr">
              <span className="dc-inline danger">{t('docs.tableUnder')}</span>
              <span>{t('docs.tableUnderMeaning')}</span>
              <span>{t('docs.tableUnderAction')}</span>
            </div>
          </div>

          <h2>{t('docs.feedbackH2')}</h2>
          <div className="dc-feedback">
            <button>
              <Icon name="thumbs-up" size={14} /> {t('docs.feedbackYes')}
            </button>
            <button>
              <Icon name="thumbs-down" size={14} /> {t('docs.feedbackNo')}
            </button>
            <Link to="/contacto" className="link">
              {t('docs.feedbackLink')}
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}

export default function Docs() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        kicker={t('docs.kicker')}
        title={
          <>
            {t('docs.titleA')}
            <br /> {t('docs.titleB')}
            <em>{t('docs.titleEm')}</em>
            {t('docs.titleC')}
          </>
        }
        lead={t('docs.lead')}
        crumbs={[
          { label: t('docs.crumbInicio'), to: '/' },
          { label: t('docs.crumbRecursos') },
          { label: t('docs.crumbDocs') },
        ]}
        badges={[
          { label: t('docs.badgeArticles'), tone: 'pv-badge-primary' },
          { label: t('docs.badgeUpdated'), tone: 'pv-badge-amber' },
          { label: t('docs.badgeOpen'), tone: 'pv-badge-neutral' },
        ]}
      >
        <Search />
      </PageHeader>

      <section className="pv-shell pv-section" style={{ paddingTop: 48 }}>
        <div className="dc-layout">
          <Sidebar />
          <div className="dc-main">
            <div className="dc-main-head">
              <span className="pv-kicker">{t('docs.mainKicker')}</span>
              <h2 className="pv-display">{t('docs.mainTitle')}</h2>
            </div>
            <Categories />
            <Popular />
          </div>
        </div>
      </section>

      <ArticlePreview />
    </>
  );
}
