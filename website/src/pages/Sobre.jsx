import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Icon } from '../components/Icon.jsx';
import { PMark } from '../components/Brand.jsx';
import { PageHeader } from '../components/PageHeader.jsx';
import { RichText } from '../components/RichText.jsx';

// Icon per value card (order matches sobre.values in the locale files).
const VALUE_ICONS = [
  'feather',
  'wifi-off',
  'languages',
  'shield-check',
  'code-2',
  'heart-handshake',
];
// Avatar initials per team member (order matches sobre.team).
const TEAM_INITIALS = ['DR', 'MQ', 'LC', 'CV', 'AP', 'ER'];

function Manifesto() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section">
      <div className="sb-manifesto">
        <div className="sb-manifesto-l">
          <span className="pv-kicker">{t('sobre.manifestoKicker')}</span>
          <h2 className="pv-display">
            {t('sobre.manifestoTitleA')}
            <em>{t('sobre.manifestoTitleEm')}</em>
            {t('sobre.manifestoTitleB')}
          </h2>
        </div>
        <div className="sb-manifesto-r">
          <RichText text={t('sobre.manifestoP1')} as="p" />
          <RichText text={t('sobre.manifestoP2')} as="p" />
        </div>
      </div>
    </section>
  );
}

function Values() {
  const { t } = useTranslation();
  const values = t('sobre.values', { returnObjects: true });
  return (
    <section className="pv-shell pv-section">
      <div className="head">
        <span className="pv-kicker">{t('sobre.valuesKicker')}</span>
        <h2 className="pv-display">{t('sobre.valuesTitle')}</h2>
      </div>
      <div className="sb-values">
        {values.map((v, i) => (
          <div key={v.t} className="sb-value">
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <span className="glyph">
              <Icon name={VALUE_ICONS[i]} size={18} />
            </span>
            <h3>{v.t}</h3>
            <p>{v.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Timeline() {
  const { t } = useTranslation();
  const ms = t('sobre.timeline', { returnObjects: true });
  return (
    <section className="pv-shell pv-section">
      <div className="head">
        <span className="pv-kicker">{t('sobre.timelineKicker')}</span>
        <h2 className="pv-display">{t('sobre.timelineTitle')}</h2>
      </div>
      <ol className="sb-timeline">
        {ms.map((m, i) => (
          <li key={i} className="sb-tl-row">
            <div className="when">
              <span className="y">{m.y}</span>
              <span className="q">{m.q}</span>
            </div>
            <div className="line" aria-hidden>
              <span className="dot" />
              {i < ms.length - 1 && <span className="rail" />}
            </div>
            <div className="body">
              <h4>{m.t}</h4>
              <p>{m.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Team() {
  const { t } = useTranslation();
  const team = t('sobre.team', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="equipo">
      <div className="head">
        <span className="pv-kicker">{t('sobre.teamKicker')}</span>
        <h2 className="pv-display">{t('sobre.teamTitle')}</h2>
        <p className="desc">{t('sobre.teamDesc')}</p>
      </div>
      <div className="sb-team">
        {team.map((p, i) => (
          <div key={p.n} className="pv-card sb-member">
            <div className="ava">
              <span>{TEAM_INITIALS[i]}</span>
            </div>
            <div className="body">
              <span className="n">{p.n}</span>
              <span className="r">{p.r}</span>
              <p>{p.b}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CTA() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section">
      <div
        className="pv-hero-surface"
        style={{
          padding: '44px 52px',
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 28,
          alignItems: 'center',
        }}
      >
        <div>
          <span className="pv-kicker">{t('sobre.ctaKicker')}</span>
          <h2
            className="pv-display"
            style={{
              margin: '8px 0 6px',
              fontSize: 'clamp(26px, 3vw, 36px)',
              lineHeight: 1.1,
              color: 'var(--secondary-950)',
            }}
          >
            {t('sobre.ctaTitle')}
          </h2>
          <p style={{ margin: 0, color: 'var(--fg2)', fontSize: 15 }}>{t('sobre.ctaDesc')}</p>
        </div>
        <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className="pv-btn pv-btn-primary" to="/contacto">
            <Icon name="message-circle" size={16} /> {t('sobre.ctaContact')}
          </Link>
          <Link className="pv-btn pv-btn-outline" to="/roadmap">
            <Icon name="map" size={16} /> {t('sobre.ctaRoadmap')}
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Sobre() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        kicker={t('sobre.kicker')}
        title={
          <>
            {t('sobre.titleA')}
            <br /> {t('sobre.titleC')}
            <em>{t('sobre.titleEm')}</em>
            {t('sobre.titleD')}
          </>
        }
        lead={t('sobre.lead')}
        crumbs={[
          { label: t('sobre.crumbInicio'), to: '/' },
          { label: t('sobre.crumbEmpresa') },
          { label: t('sobre.crumbSobre') },
        ]}
        badges={[
          { label: t('sobre.badgeMade'), tone: 'pv-badge-primary' },
          { label: t('sobre.badgeRemote'), tone: 'pv-badge-amber' },
          { label: t('sobre.badgeFounded'), tone: 'pv-badge-neutral' },
        ]}
        aside={
          <div className="sb-hero-card">
            <div className="sb-hero-card-head">
              <PMark size={28} />
              <div>
                <span className="t">{t('sobre.heroCardTitle')}</span>
                <span className="s">{t('sobre.heroCardDate')}</span>
              </div>
            </div>
            <div className="sb-hero-grid">
              <div className="pv-stat-tile">
                <span className="l">{t('sobre.heroStatSitesLabel')}</span>
                <span className="v">142</span>
              </div>
              <div className="pv-stat-tile">
                <span className="l">{t('sobre.heroStatCountriesLabel')}</span>
                <span className="v">
                  1<em> CO</em>
                </span>
              </div>
              <div className="pv-stat-tile">
                <span className="l">{t('sobre.heroStatTeamLabel')}</span>
                <span className="v">6</span>
              </div>
              <div className="pv-stat-tile">
                <span className="l">{t('sobre.heroStatOpenLabel')}</span>
                <span className="v">MIT</span>
              </div>
            </div>
            <p className="sb-hero-note">
              <Icon name="info" size={12} /> {t('sobre.heroNote')}
            </p>
          </div>
        }
      />
      <Manifesto />
      <Values />
      <Timeline />
      <Team />
      <CTA />
    </>
  );
}
