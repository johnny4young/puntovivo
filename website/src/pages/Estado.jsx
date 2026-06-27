import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon.jsx';
import { PageHeader } from '../components/PageHeader.jsx';

// Deterministic synthetic 90-day uptime bars (structural — same in both
// locales). Mostly ok with the occasional minor; explicit incidents overlay.
function makeDays(seed = 1, incidents = []) {
  const out = [];
  for (let i = 0; i < 90; i++) {
    let v = 'ok';
    const r = ((seed * 13 + i * 7) % 97) / 97;
    if (r > 0.985) v = 'major';
    else if (r > 0.95) v = 'minor';
    out.push(v);
  }
  incidents.forEach(d => {
    if (d.day >= 0 && d.day < 90) out[d.day] = d.kind;
  });
  return out;
}

// Per-service structural data: icon, status, uptime, and the bar series. Names
// + descriptions come from the locale files (estado.services, same order).
const SERVICE_META = [
  {
    id: 'pos',
    icon: 'scan-line',
    status: 'ok',
    uptime: '99.99',
    days: makeDays(3, [{ day: 12, kind: 'minor' }]),
  },
  {
    id: 'sync',
    icon: 'refresh-cw',
    status: 'minor',
    uptime: '99.94',
    days: makeDays(7, [
      { day: 1, kind: 'minor' },
      { day: 8, kind: 'minor' },
    ]),
  },
  {
    id: 'ai',
    icon: 'sparkles',
    status: 'ok',
    uptime: '99.92',
    days: makeDays(11, [{ day: 22, kind: 'minor' }]),
  },
  { id: 'auth', icon: 'shield-check', status: 'ok', uptime: '100.00', days: makeDays(17) },
  {
    id: 'dian',
    icon: 'file-text',
    status: 'ok',
    uptime: '99.87',
    days: makeDays(23, [{ day: 41, kind: 'major' }]),
  },
  { id: 'web', icon: 'globe', status: 'ok', uptime: '99.99', days: makeDays(29) },
  {
    id: 'wa',
    icon: 'message-circle',
    status: 'ok',
    uptime: '99.81',
    days: makeDays(31, [
      { day: 5, kind: 'minor' },
      { day: 33, kind: 'minor' },
    ]),
  },
];

function sevTone(sev) {
  return sev === 'major' ? 'danger' : sev === 'minor' ? 'warning' : 'success';
}

function StatusPill({ kind, big }) {
  const { t } = useTranslation();
  const map = {
    ok: { label: t('estado.statusOk'), i: 'check-circle-2', c: 'ok' },
    minor: { label: t('estado.statusMinor'), i: 'alert-triangle', c: 'minor' },
    major: { label: t('estado.statusMajor'), i: 'alert-octagon', c: 'major' },
    maint: { label: t('estado.statusMaint'), i: 'wrench', c: 'maint' },
  };
  const v = map[kind] || map.ok;
  return (
    <span className={'st-pill st-pill-' + v.c + (big ? ' big' : '')}>
      <Icon name={v.i} size={big ? 16 : 13} /> {v.label}
    </span>
  );
}

function GlobalBanner() {
  const { t } = useTranslation();
  const today = new Date()
    .toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/\.$/, '');
  return (
    <div className="st-banner">
      <div className="st-banner-glyph">
        <Icon name="check-circle-2" size={28} />
      </div>
      <div className="st-banner-body">
        <span className="kicker">
          {t('estado.bannerKicker')} · {today}
        </span>
        <h2 className="pv-display">{t('estado.bannerTitle')}</h2>
        <p>{t('estado.bannerDesc')}</p>
      </div>
      <div className="st-banner-meta">
        <div className="pv-stat-tile">
          <span className="l">{t('estado.bannerUptimeLabel')}</span>
          <span className="v">99.94%</span>
        </div>
        <div className="pv-stat-tile">
          <span className="l">{t('estado.bannerIncidentsLabel')}</span>
          <span className="v">3</span>
        </div>
      </div>
    </div>
  );
}

function ServiceRow({ meta, name, desc }) {
  const { t } = useTranslation();
  return (
    <div className="st-row">
      <div className="st-row-l">
        <span className="st-glyph">
          <Icon name={meta.icon} size={16} />
        </span>
        <div className="st-row-text">
          <span className="name">{name}</span>
          <span className="desc">{desc}</span>
        </div>
      </div>
      <div className="st-row-bars" aria-label={t('estado.barsAria')}>
        {meta.days.map((d, i) => (
          <span key={i} className={'st-bar st-bar-' + d} />
        ))}
      </div>
      <div className="st-row-r">
        <span className="up">
          <span className="num">{meta.uptime}%</span>
          <span className="lbl">{t('estado.uptimeLabel')}</span>
        </span>
        <StatusPill kind={meta.status} />
      </div>
    </div>
  );
}

function Regions() {
  const { t } = useTranslation();
  const regions = t('estado.regions', { returnObjects: true });
  return (
    <section className="pv-shell pv-section">
      <div className="head">
        <span className="pv-kicker">{t('estado.regionsKicker')}</span>
        <h2 className="pv-display">{t('estado.regionsTitle')}</h2>
        <p className="desc">{t('estado.regionsDesc')}</p>
      </div>
      <div className="st-regions">
        {regions.map(r => (
          <div key={r.id} className={'st-region st-region-' + r.status}>
            <Icon name="map-pin" size={14} />
            <span className="name">{r.name}</span>
            <span className="count">{t('estado.regionCount', { count: r.count })}</span>
            <StatusPill kind={r.status} />
          </div>
        ))}
      </div>
    </section>
  );
}

function Incidents() {
  const { t } = useTranslation();
  const incidents = t('estado.incidents', { returnObjects: true });
  // Maps the stable Spanish step key to its localized label.
  const stepLabel = {
    Detectado: t('estado.stepDetectado'),
    Investigando: t('estado.stepInvestigando'),
    Comunicado: t('estado.stepComunicado'),
    Resuelto: t('estado.stepResuelto'),
  };
  const sevLabel = sev =>
    sev === 'major'
      ? t('estado.sevMajor')
      : sev === 'minor'
        ? t('estado.sevMinor')
        : t('estado.sevInfo');
  return (
    <section className="pv-shell pv-section" id="incidentes">
      <div className="head">
        <span className="pv-kicker">{t('estado.incidentsKicker')}</span>
        <h2 className="pv-display">{t('estado.incidentsTitle')}</h2>
      </div>
      <div className="st-incidents">
        {incidents.map((it, i) => (
          <details key={i} className={'st-incident st-incident-' + sevTone(it.sev)} open={i === 0}>
            <summary>
              <span className={'st-sev st-sev-' + sevTone(it.sev)}>{sevLabel(it.sev)}</span>
              <span className="ttl">{it.title}</span>
              <span className="meta">
                <span>
                  <Icon name="play" size={11} /> {it.started}
                </span>
                <span>
                  <Icon name="check" size={11} /> {it.resolved}
                </span>
                <span>
                  <Icon name="clock" size={11} /> {it.elapsed}
                </span>
              </span>
              <Icon name="chevron-down" size={16} />
            </summary>
            <div className="st-incident-body">
              <ul className="st-steps">
                {it.steps.map((st, j) => (
                  <li key={j}>
                    <span className="at">{st.at}</span>
                    <span className={'chip s-' + st.s.toLowerCase()}>
                      {stepLabel[st.s] || st.s}
                    </span>
                    <span className="d">{st.d}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Subscribe() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section">
      <div className="st-subscribe">
        <div>
          <span className="pv-kicker">{t('estado.subscribeKicker')}</span>
          <h2 className="pv-display" style={{ margin: '8px 0 8px' }}>
            {t('estado.subscribeTitle')}
          </h2>
          <p>{t('estado.subscribeDesc')}</p>
        </div>
        <div className="st-sub-form">
          <div className="st-sub-tabs">
            <span className="tab on">{t('estado.subTabEmail')}</span>
            <span className="tab">{t('estado.subTabWa')}</span>
            <span className="tab">{t('estado.subTabWebhook')}</span>
            <span className="tab">{t('estado.subTabRss')}</span>
          </div>
          <div className="st-sub-input">
            <Icon name="mail" size={16} color="var(--primary-700)" />
            <span className="ph">{t('estado.subInputPh')}</span>
            <a className="pv-btn pv-btn-primary pv-btn-sm" href="#">
              <Icon name="bell" size={13} /> {t('estado.subButton')}
            </a>
          </div>
          <span className="st-sub-foot">
            <Icon name="lock" size={11} /> {t('estado.subFoot')}
          </span>
        </div>
      </div>
    </section>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <div className="st-aside-card">
      <div className="st-aside-head">
        <Icon name="bar-chart-2" size={16} color="var(--primary-700)" />
        <span>{t('estado.legendTitle')}</span>
      </div>
      <ul className="st-legend">
        <li>
          <span className="bar st-bar-ok" />{' '}
          <span>
            <b>{t('estado.legendOkLabel')}</b> — {t('estado.legendOkDesc')}
          </span>
        </li>
        <li>
          <span className="bar st-bar-minor" />{' '}
          <span>
            <b>{t('estado.legendMinorLabel')}</b> — {t('estado.legendMinorDesc')}
          </span>
        </li>
        <li>
          <span className="bar st-bar-major" />{' '}
          <span>
            <b>{t('estado.legendMajorLabel')}</b> — {t('estado.legendMajorDesc')}
          </span>
        </li>
        <li>
          <span className="bar st-bar-maint" />{' '}
          <span>
            <b>{t('estado.legendMaintLabel')}</b> — {t('estado.legendMaintDesc')}
          </span>
        </li>
      </ul>
      <div className="st-aside-foot">
        <Icon name="info" size={12} /> {t('estado.legendFoot')}
      </div>
    </div>
  );
}

export default function Estado() {
  const { t } = useTranslation();
  const services = t('estado.services', { returnObjects: true });
  return (
    <>
      <PageHeader
        kicker={t('estado.kicker')}
        title={
          <>
            {t('estado.titleA')}
            <em>{t('estado.titleEm')}</em>
            {t('estado.titleB')}
            <br /> {t('estado.titleC')}
          </>
        }
        lead={t('estado.lead')}
        crumbs={[
          { label: t('estado.crumbInicio'), to: '/' },
          { label: t('estado.crumbEmpresa') },
          { label: t('estado.crumbEstado') },
        ]}
        badges={[
          { label: t('estado.badgeProbes'), tone: 'pv-badge-primary' },
          { label: t('estado.badgeRegions'), tone: 'pv-badge-amber' },
          { label: t('estado.badgeHistory'), tone: 'pv-badge-neutral' },
        ]}
        aside={<Legend />}
      />

      <section className="pv-shell pv-section" style={{ paddingTop: 48 }}>
        <GlobalBanner />
      </section>

      <section className="pv-shell pv-section">
        <div className="head">
          <span className="pv-kicker">{t('estado.servicesKicker')}</span>
          <h2 className="pv-display">{t('estado.servicesTitle')}</h2>
        </div>
        <div className="st-services">
          {SERVICE_META.map((meta, i) => (
            <ServiceRow key={meta.id} meta={meta} name={services[i].name} desc={services[i].desc} />
          ))}
          <div className="st-services-foot">
            <span>
              <b>{t('estado.servicesFootA')}</b> {t('estado.servicesFootB')}
            </span>
            <span>{t('estado.servicesFootRange')}</span>
          </div>
        </div>
      </section>

      <Regions />
      <Incidents />
      <Subscribe />
    </>
  );
}
