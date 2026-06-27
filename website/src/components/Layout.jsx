import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sun, Moon } from 'lucide-react';

import { PMark } from './Brand.jsx';
import { useTheme } from '../theme/ThemeProvider.jsx';
import { useLatestRelease, REPO_URL } from '../hooks/useLatestRelease.js';

// The header is shared by the landing and all secondary pages. In-page anchor
// links (#features, #ai, #pricing) only resolve on the landing; from a secondary
// route we prefix them with "/" so the browser navigates home and then jumps to
// the anchor. Route links (Docs / Roadmap) use <NavLink> so the active page is
// highlighted via the same `.is-active` rule the design ships.
const ANCHOR_LINKS = [
  { key: 'nav.product', hash: '#features' },
  { key: 'nav.caja', hash: '#caja' },
  { key: 'nav.ai', hash: '#ai' },
  { key: 'nav.dashboard', hash: '#alerts' },
  { key: 'nav.pricing', hash: '#pricing' },
];

const ROUTE_LINKS = [
  { key: 'nav.docs', to: '/docs' },
  { key: 'nav.roadmap', to: '/roadmap' },
];

function Nav() {
  const { t, i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const onLanding = location.pathname === '/';
  const nextLang = i18n.language === 'es' ? 'en' : 'es';

  // On the landing an anchor stays an in-page jump (#features); elsewhere it has
  // to send the browser home first (/#features).
  const anchorHref = hash => (onLanding ? hash : `/${hash}`);

  return (
    <nav className="pv-nav-wrap">
      <div className="pv-shell">
        <div className="pv-nav">
          <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
            <PMark size={30} />
            <span className="word">Puntovivo</span>
          </Link>
          <div className="links">
            {ANCHOR_LINKS.map(l => (
              <a key={l.hash} href={anchorHref(l.hash)}>
                {t(l.key)}
              </a>
            ))}
            {ROUTE_LINKS.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => (isActive ? 'is-active' : '')}
              >
                {t(l.key)}
              </NavLink>
            ))}
          </div>
          <div className="pv-cta-row">
            <button
              type="button"
              className="pv-ctrl pv-ctrl-lang"
              onClick={() => i18n.changeLanguage(nextLang)}
              aria-label={t('nav.langToggle')}
              title={t('nav.langToggle')}
            >
              <span className={i18n.language === 'es' ? 'on' : ''}>ES</span>
              <span className="sep">/</span>
              <span className={i18n.language === 'en' ? 'on' : ''}>EN</span>
            </button>
            <button
              type="button"
              className="pv-ctrl"
              onClick={toggleTheme}
              aria-label={t('nav.themeToggle')}
              title={t('nav.themeToggle')}
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <a className="pv-link" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              {t('nav.github')}
            </a>
            <Link className="pv-btn pv-btn-primary pv-btn-sm" to="/contacto">
              {t('nav.demo')}
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

function Footer() {
  const { t } = useTranslation();
  // No release exists today, so the footer shows a neutral "open source · MIT"
  // tag rather than a fake version. When a real release is cut, the hook returns
  // its tag and we surface "vX.Y.Z · MIT".
  const { version } = useLatestRelease();
  const versionLabel = version ? t('footer.versionTagged', { version }) : t('footer.versionDev');
  const productLinks = t('footer.productLinks', { returnObjects: true });
  const companyLinks = t('footer.companyLinks', { returnObjects: true });
  const resourcesLinks = t('footer.resourcesLinks', { returnObjects: true });

  // Footer columns now point at real routes (or in-page anchors on the landing).
  // The GitHub link (last resource) points at the public repo.
  const productTo = ['/#features', '/#caja', '/#features', '/#features', '/#features'];
  const companyTo = ['/sobre', '/roadmap', '/contacto'];
  const resourcesTo = ['/docs', '/atajos', '/migracion', REPO_URL];

  const renderLink = (label, target) => {
    if (target.startsWith('http')) {
      return (
        <a href={target} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      );
    }
    return target.startsWith('/') && !target.startsWith('/#') ? (
      <Link to={target}>{label}</Link>
    ) : (
      <a href={target}>{label}</a>
    );
  };

  return (
    <footer className="pv-foot">
      <div className="pv-shell">
        <div className="grid">
          <div>
            <div
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 14 }}
            >
              <PMark size={30} />
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  letterSpacing: '-0.03em',
                  color: 'var(--fg1)',
                }}
              >
                Puntovivo
              </span>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                color: 'var(--fg3)',
                lineHeight: 1.6,
                maxWidth: '26em',
              }}
            >
              {t('footer.tagline')}
            </p>
          </div>
          <div>
            <h5>{t('footer.productTitle')}</h5>
            <ul>
              {productLinks.map((l, i) => (
                <li key={l}>{renderLink(l, productTo[i] || '/#features')}</li>
              ))}
            </ul>
          </div>
          <div>
            <h5>{t('footer.companyTitle')}</h5>
            <ul>
              {companyLinks.map((l, i) => (
                <li key={l}>{renderLink(l, companyTo[i] || '#')}</li>
              ))}
            </ul>
          </div>
          <div>
            <h5>{t('footer.resourcesTitle')}</h5>
            <ul>
              {resourcesLinks.map((l, i) => (
                <li key={l}>{renderLink(l, resourcesTo[i] || '#')}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="meta">
          <span>{t('footer.copyright')}</span>
          <span>{versionLabel}</span>
        </div>
      </div>
    </footer>
  );
}

// Shared chrome for every route. The landing and the 7 secondary pages render
// inside <Outlet />; the #app wrapper (z-index over the body texture) lives in
// AppShell.jsx so it wraps the router too.
export function Layout() {
  return (
    <>
      <Nav />
      <Outlet />
      <Footer />
    </>
  );
}
