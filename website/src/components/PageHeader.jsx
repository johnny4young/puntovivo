import { Fragment } from 'react';
import { Link } from 'react-router-dom';

import { Icon } from './Icon.jsx';

// Shared hero block at the top of every secondary page (kicker + h1 + lead +
// breadcrumb + badges + optional aside). Ported from the design's shell.jsx
// PageHeader. Crumbs whose href starts with "/" become router <Link>s.
export function PageHeader({
  kicker,
  title,
  lead,
  crumbs = [],
  badges = [],
  aside = null,
  children,
}) {
  return (
    <section className="pv-shell" style={{ paddingTop: 8 }}>
      <div className="pv-page-hero">
        <div className="pv-page-hero-body">
          {crumbs.length > 0 && (
            <div className="pv-crumbs">
              {crumbs.map((c, i) => (
                <Fragment key={i}>
                  {i > 0 && <Icon name="chevron-right" size={12} color="var(--fg4)" />}
                  {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
                </Fragment>
              ))}
            </div>
          )}
          <span className="pv-kicker">{kicker}</span>
          <h1 className="pv-display">{title}</h1>
          {lead && <p className="pv-page-lead">{lead}</p>}
          {badges.length > 0 && (
            <div className="pv-page-badges">
              {badges.map((b, i) => (
                <span key={i} className={'pv-badge ' + (b.tone || 'pv-badge-primary')}>
                  {b.dot !== false && <span className="dot" />} {b.label}
                </span>
              ))}
            </div>
          )}
          {children}
        </div>
        {aside && <div className="pv-page-hero-aside">{aside}</div>}
      </div>
    </section>
  );
}
