import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon.jsx';
import { PageHeader } from '../components/PageHeader.jsx';

const REPO_URL = 'https://github.com/johnny4young/puntovivo';
const ISSUES_URL = `${REPO_URL}/issues`;
const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
const EMAIL = 'asesordeprogramacion@gmail.com';

// Real, public contact channels only. Puntovivo is an open-source solo project,
// so there is no sales/support team, no SLA, no WhatsApp Business, no booking,
// and no offices — those were fabricated. Everything routes to GitHub or email.
const CHANNELS = [
  {
    key: 'issues',
    icon: 'github',
    href: ISSUES_URL,
    value: 'github.com/johnny4young/puntovivo/issues',
  },
  {
    key: 'discussions',
    icon: 'message-circle',
    href: DISCUSSIONS_URL,
    value: 'github.com/johnny4young/puntovivo/discussions',
  },
  { key: 'email', icon: 'mail', href: `mailto:${EMAIL}`, value: EMAIL },
];

function Channels() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section" style={{ paddingTop: 48 }}>
      <div className="head">
        <span className="pv-kicker">{t('contacto.channelsKicker')}</span>
        <h2 className="pv-display">{t('contacto.channelsTitle')}</h2>
        <p className="desc">{t('contacto.channelsDesc')}</p>
      </div>
      <div className="ct-channels">
        {CHANNELS.map(c => {
          const external = c.href.startsWith('http');
          return (
            <a
              key={c.key}
              className="ct-channel"
              href={c.href}
              {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              <span className="glyph">
                <Icon name={c.icon} size={20} />
              </span>
              <div className="body">
                <span className="t">{t(`contacto.channels.${c.key}.title`)}</span>
                <span className="d">{t(`contacto.channels.${c.key}.desc`)}</span>
                <span className="v">{c.value}</span>
              </div>
              <Icon name="arrow-up-right" size={16} />
            </a>
          );
        })}
      </div>
    </section>
  );
}

function Contribute() {
  const { t } = useTranslation();
  const steps = t('contacto.contribute.steps', { returnObjects: true });
  return (
    <section className="pv-shell pv-section">
      <div className="ct-contribute">
        <div className="ct-contribute-l">
          <span className="pv-kicker">{t('contacto.contribute.kicker')}</span>
          <h2 className="pv-display">{t('contacto.contribute.title')}</h2>
          <p>{t('contacto.contribute.desc')}</p>
          <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            <a
              className="pv-btn pv-btn-primary"
              href={ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="github" size={16} /> {t('contacto.contribute.ctaIssues')}
            </a>
            <a
              className="pv-btn pv-btn-outline"
              href={DISCUSSIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="message-circle" size={16} /> {t('contacto.contribute.ctaDiscussions')}
            </a>
          </div>
        </div>
        <ol className="ct-contribute-steps">
          {steps.map((s, i) => (
            <li key={i}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <span className="d">{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export default function Contacto() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        kicker={t('contacto.kicker')}
        title={
          <>
            {t('contacto.titleA')}
            <em>{t('contacto.titleEm')}</em>
            {t('contacto.titleB')}
          </>
        }
        lead={t('contacto.lead')}
        crumbs={[
          { label: t('contacto.crumbInicio'), to: '/' },
          { label: t('contacto.crumbEmpresa') },
          { label: t('contacto.crumbContacto') },
        ]}
        badges={[
          { label: t('contacto.badgeOpen'), tone: 'pv-badge-primary' },
          { label: t('contacto.badgeIssues'), tone: 'pv-badge-amber' },
          { label: t('contacto.badgeMit'), tone: 'pv-badge-neutral' },
        ]}
        aside={
          <div className="ct-aside">
            <div className="ct-aside-now">
              <span className="dot" />
              <div>
                <span className="t">{t('contacto.asideTitle')}</span>
                <span className="s">{t('contacto.asideSub')}</span>
              </div>
            </div>
            <div className="ct-aside-foot">
              <Icon name="info" size={12} /> {t('contacto.asideFoot')}
            </div>
          </div>
        }
      />

      <Channels />
      <Contribute />
    </>
  );
}
