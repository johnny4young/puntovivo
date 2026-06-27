import { useTranslation } from 'react-i18next';
import {
  ScanLine,
  TrendingUp,
  Package,
  Coffee,
  ShoppingBag,
  Percent,
  Banknote,
  CreditCard,
  QrCode,
  Receipt,
  LogIn,
  Play,
  Sparkles,
  Wallet,
  Warehouse,
  ArrowLeftRight,
  ShoppingCart,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  ArrowDownToLine,
  ArrowRightLeft,
  EyeOff,
  Check,
  Download,
} from 'lucide-react';

import { PMark } from '../components/Brand.jsx';
import { RichText } from '../components/RichText.jsx';
import { AISection, AIFaq } from '../components/AISection.jsx';
import { useLatestRelease } from '../hooks/useLatestRelease.js';

// Maps the feature-grid index to its lucide icon (order matches es.json/features.items).
const FEATURE_ICONS = [ScanLine, Wallet, Warehouse, ArrowLeftRight, ShoppingCart, ShieldCheck];
// Maps the alerts feed index to tone + icon (order matches alerts.items).
const ALERT_META = [
  { tone: 'warning', Icon: AlertTriangle },
  { tone: 'danger', Icon: Wallet },
  { tone: 'info', Icon: ArrowLeftRight },
  { tone: 'info', Icon: Package },
  { tone: 'success', Icon: TrendingUp },
  { tone: 'warning', Icon: RotateCcw },
];

// ---------- POS mock ----------
function POSMock() {
  const { t } = useTranslation();
  return (
    <div className="pv-mock-wrap">
      <div className="pv-mock-ribbon">
        <span className="live" />
        {t('hero.posTurn')}
      </div>

      <div className="pv-mock-stat">
        <span className="glyph">
          <TrendingUp size={16} />
        </span>
        <div className="col">
          <span className="v">$&nbsp;1,84M</span>
          <span className="l">{t('hero.posSold')}</span>
        </div>
      </div>

      <div className="pv-mock">
        <div className="pv-mock-bar">
          <span className="lockup">
            <PMark size={32} />
            <span className="meta">
              <span className="ttl">{t('hero.posCajaTitle')}</span>
              <span className="sub">{t('hero.posCajaSub')}</span>
            </span>
          </span>
          <span className="spacer" />
          <span className="turn">{t('hero.posSale')}&nbsp;·&nbsp;PV-002841</span>
          <span className="who">
            <span className="ava">M</span>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span className="nm">María R.</span>
              <span className="rl">{t('hero.posCashier')}</span>
            </span>
          </span>
        </div>

        <div className="pv-mock-body">
          <div>
            <div className="pv-mock-search">
              <ScanLine size={18} color="var(--primary-700)" />
              <span className="ph">
                <em>Arepa</em> {t('hero.posSearch')}
              </span>
              <span className="caret" />
              <span className="key">
                <span className="pv-key">⌥</span>
                <span className="pv-key">P</span>
              </span>
            </div>

            <div className="pv-mock-cart-head">
              <span>{t('hero.posCart')}</span>
              <span className="ct">{t('hero.posCartCount')}</span>
            </div>

            <div className="pv-mock-rows">
              <div className="pv-mock-row high">
                <div className="glyph">
                  <Package size={16} />
                </div>
                <div>
                  <div className="ttl">{t('hero.posItem1')}</div>
                  <div className="sub">SKU · ARQ-12-PV</div>
                </div>
                <div className="qty">×&nbsp;3</div>
                <div className="price">$&nbsp;28.500</div>
              </div>
              <div className="pv-mock-row">
                <div className="glyph">
                  <Coffee size={16} />
                </div>
                <div>
                  <div className="ttl">{t('hero.posItem2')}</div>
                  <div className="sub">SKU · CAF-500-TIN</div>
                </div>
                <div className="qty">×&nbsp;2</div>
                <div className="price">$&nbsp;39.800</div>
              </div>
              <div className="pv-mock-row">
                <div className="glyph">
                  <ShoppingBag size={16} />
                </div>
                <div>
                  <div className="ttl">{t('hero.posItem3')}</div>
                  <div className="sub">SKU · BLS-M-RCY</div>
                </div>
                <div className="qty">×&nbsp;1</div>
                <div className="price">$&nbsp;1.200</div>
              </div>
              <div className="pv-mock-row disc">
                <div className="glyph">
                  <Percent size={16} />
                </div>
                <div>
                  <div className="ttl">{t('hero.posDiscount')}</div>
                  <div className="sub">{t('hero.posDiscountSub')}</div>
                </div>
                <div className="qty">—</div>
                <div className="price">−$&nbsp;2.085</div>
              </div>
            </div>
          </div>

          <div className="pv-mock-side">
            <div className="pv-mock-totals">
              <div className="head">
                <span>{t('hero.posSummary')}</span>
                <span className="id">PV-002841</span>
              </div>
              <div className="row">
                <span>{t('hero.posSubtotal')}</span>
                <span className="v">$&nbsp;69.500</span>
              </div>
              <div className="row">
                <span>{t('hero.posDiscounts')}</span>
                <span className="v">−$&nbsp;2.085</span>
              </div>
              <div className="row">
                <span>{t('hero.posTax')}</span>
                <span className="v">$&nbsp;12.808</span>
              </div>
              <div className="grand">
                <div>
                  <div className="l">{t('hero.posTotalLabel')}</div>
                  <div className="lbl">{t('hero.posTotalItems')}</div>
                </div>
                <div className="amt">
                  $80<em>.223</em>
                </div>
              </div>
            </div>

            <div className="pv-mock-pay">
              <div className="opt on">
                <span className="ic">
                  <Banknote size={14} />
                </span>
                {t('hero.posCash')}
              </div>
              <div className="opt">
                <span className="ic">
                  <CreditCard size={14} />
                </span>
                {t('hero.posCard')}
              </div>
              <div className="opt">
                <span className="ic">
                  <QrCode size={14} />
                </span>
                Nequi
              </div>
            </div>

            <div className="pv-mock-cta">
              <span className="l">
                <Receipt size={18} /> {t('hero.posCharge')}
              </span>
              <span className="r">
                <span
                  className="pv-key"
                  style={{
                    background: 'transparent',
                    border: '1px solid color-mix(in oklch, var(--surface) 35%, transparent)',
                    color: 'currentColor',
                  }}
                >
                  ⌥
                </span>
                <span
                  className="pv-key"
                  style={{
                    background: 'transparent',
                    border: '1px solid color-mix(in oklch, var(--surface) 35%, transparent)',
                    color: 'currentColor',
                  }}
                >
                  C
                </span>
              </span>
            </div>

            <div className="pv-mock-keyhint">
              <span className="pv-key">⌥</span>
              <span className="pv-key">D</span>&nbsp;{t('hero.posKeyDiscount')}
              <span className="sep">·</span>
              <span className="pv-key">⌥</span>
              <span className="pv-key">N</span>&nbsp;{t('hero.posKeyNewSale')}
            </div>
          </div>
        </div>

        <div className="pv-mock-edge" />
      </div>
    </div>
  );
}

// ---------- Hero ----------
function Hero({ version }) {
  const { t } = useTranslation();
  return (
    <section className="pv-shell" style={{ paddingTop: 8 }}>
      <div className="pv-hero-surface pv-hero">
        <div className="pv-hero-copy">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
              <span className="pv-badge pv-badge-primary">
                <span className="dot" /> {t('hero.badgePos')}
              </span>
              <span className="pv-badge pv-badge-amber">
                <span className="dot" style={{ background: 'var(--brand-accent-500)' }} />{' '}
                {t('hero.badgeAi')}
              </span>
              <span
                className="pv-badge pv-badge-primary"
                style={{
                  background: 'color-mix(in oklch, var(--secondary-100) 80%, transparent)',
                  color: 'var(--secondary-700)',
                }}
              >
                {t('hero.badgeVersion', { version })}
              </span>
            </div>
            <h1 className="pv-display">
              {t('hero.titleA')}
              <em>{t('hero.titleEm')}</em>
              {t('hero.titleB')}
            </h1>
            <p className="lead">{t('hero.lead')}</p>
            <div className="cta-row">
              <a className="pv-btn pv-btn-primary" href="#demo">
                <LogIn size={16} /> {t('hero.ctaDemo')}
              </a>
              <a className="pv-btn pv-btn-outline" href="#flow">
                <Play size={16} /> {t('hero.ctaFlow')}
              </a>
              <a href="#ai" className="ai-hero-kbd" style={{ textDecoration: 'none' }}>
                <span className="spk">
                  <Sparkles size={12} />
                </span>
                {t('hero.ctaAsk')}
                <span className="keys">
                  <span className="pv-key">Alt</span>
                  <span className="pv-key">K</span>
                </span>
              </a>
            </div>
          </div>
          <div className="meta-row">
            <div className="item">
              <span className="num">5</span>
              <span className="lbl">{t('hero.metaActions')}</span>
            </div>
            <div className="item">
              <span className="num">F1</span>
              <span className="lbl">{t('hero.metaCharge')}</span>
            </div>
            <div className="item">
              <span className="num">
                100<span style={{ color: 'var(--primary-700)' }}>%</span>
              </span>
              <span className="lbl">{t('hero.metaOffline')}</span>
            </div>
            <div className="item">
              <span className="num">ES&nbsp;·&nbsp;EN</span>
              <span className="lbl">{t('hero.metaBilingual')}</span>
            </div>
          </div>
        </div>
        <POSMock />
      </div>
    </section>
  );
}

// ---------- Trust strip ----------
function Trust() {
  const { t } = useTranslation();
  const items = t('trust.items', { returnObjects: true });
  return (
    <section className="pv-shell" style={{ paddingTop: 28 }}>
      <div className="pv-trust">
        <span className="lbl">{t('trust.builtFor')}</span>
        {items.map(it => (
          <span key={it} className="item">
            <span className="pin" /> {it}
          </span>
        ))}
      </div>
    </section>
  );
}

// ---------- Features ----------
function Features() {
  const { t } = useTranslation();
  const items = t('features.items', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="features">
      <div className="head">
        <span className="pv-kicker">{t('features.kicker')}</span>
        <h2 className="pv-display">{t('features.title')}</h2>
        <p className="desc">{t('features.desc')}</p>
      </div>
      <div className="pv-features">
        {items.map((f, i) => {
          const Icon = FEATURE_ICONS[i];
          return (
            <div key={f.title} className="pv-card pv-feature">
              <span className="glyph">{Icon ? <Icon size={20} /> : null}</span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <div className="ftnote">{f.foot}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Caja con cierre ciego ----------
function Caja() {
  const { t } = useTranslation();
  const chips = t('caja.chips', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="caja">
      <div className="pv-copilot">
        <div className="copy">
          <span className="pv-kicker">{t('caja.kicker')}</span>
          <h2 className="pv-display">
            {t('caja.titleA')}
            <em>{t('caja.titleEm')}</em>
            {t('caja.titleB')}
          </h2>
          <p>{t('caja.desc')}</p>
          <div className="examples">
            {chips.map(c => (
              <span key={c} className="chip">
                <span className="pin" /> {c}
              </span>
            ))}
          </div>
        </div>

        <div className="pv-copilot-pane">
          <div className="pv-copilot-head">
            <span className="glyph">
              <Wallet size={18} />
            </span>
            <div className="meta">
              <span className="ttl">{t('caja.paneTitle')}</span>
              <span className="sub">{t('caja.paneSub')}</span>
            </div>
            <span className="live">
              <span className="d" /> {t('caja.paneLive')}
            </span>
          </div>

          <div className="pv-suggest is-success">
            <span className="ic">
              <ArrowDownToLine size={16} />
            </span>
            <div className="body">
              <div className="ttl">{t('caja.openTitle')}</div>
              <div className="desc">
                <RichText text={t('caja.openDesc')} />
              </div>
            </div>
            <span className="act">{t('caja.openAction')}</span>
          </div>

          <div className="pv-suggest is-primary">
            <span className="ic">
              <ArrowRightLeft size={16} />
            </span>
            <div className="body">
              <div className="ttl">{t('caja.skimTitle')}</div>
              <div className="desc">
                <RichText text={t('caja.skimDesc')} />
              </div>
            </div>
            <span className="act">{t('caja.skimAction')}</span>
          </div>

          <div className="pv-suggest is-warning">
            <span className="ic">
              <EyeOff size={16} />
            </span>
            <div className="body">
              <div className="ttl">{t('caja.blindTitle')}</div>
              <div className="desc">{t('caja.blindDesc')}</div>
            </div>
            <span className="act">{t('caja.blindAction')}</span>
          </div>

          <div className="pv-copilot-input">
            <Banknote size={16} color="var(--primary-700)" />
            <span className="ph">{t('caja.inputPlaceholder')}</span>
            <span className="key">
              <span className="pv-key">Alt</span>
              <span className="pv-key">M</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Dashboard alerts ----------
function Alerts() {
  const { t } = useTranslation();
  const items = t('alerts.items', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="alerts">
      <div className="head">
        <span className="pv-kicker">{t('alerts.kicker')}</span>
        <h2 className="pv-display">{t('alerts.title')}</h2>
        <p className="desc">{t('alerts.desc')}</p>
      </div>
      <div className="pv-alerts-shell">
        <div className="narrative">
          <div style={{ display: 'inline-flex', gap: 8 }}>
            <span className="pv-badge pv-badge-primary">
              <span className="dot" /> {t('alerts.badgeSites')}
            </span>
            <span className="pv-badge pv-badge-warning">
              <span className="dot" /> {t('alerts.badgeAlerts')}
            </span>
          </div>
          <h2 className="pv-display">{t('alerts.narrativeTitle')}</h2>
          <p>{t('alerts.narrativeDesc')}</p>
          <div className="stats">
            <div className="stat">
              <span className="l">{t('alerts.statSalesLabel')}</span>
              <span className="v">
                {t('alerts.statSalesValue')} <em>{t('alerts.statSalesDelta')}</em>
              </span>
            </div>
            <div className="stat">
              <span className="l">{t('alerts.statTicketsLabel')}</span>
              <span className="v">112</span>
            </div>
            <div className="stat">
              <span className="l">{t('alerts.statPendingLabel')}</span>
              <span className="v">4</span>
            </div>
          </div>
        </div>

        <div className="feed">
          <div className="feed-head">
            <div className="l">
              <span className="ttl">{t('alerts.feedTitle')}</span>
              <span className="sub">{t('alerts.feedSub')}</span>
            </div>
            <div className="filt">
              <span className="seg on">{t('alerts.filterToday')}</span>
              <span className="seg">{t('alerts.filterWeek')}</span>
              <span className="seg">{t('alerts.filterMonth')}</span>
            </div>
          </div>
          {items.map((it, i) => {
            const { tone, Icon } = ALERT_META[i];
            return (
              <div key={i} className={`pv-alert-row ${tone}`}>
                <span className="dot">
                  <Icon size={16} />
                </span>
                <div className="body">
                  <div className="row1">
                    <span className="ttl">{it.t}</span>
                    <span className="sede">{it.sede}</span>
                  </div>
                  <span className="desc">
                    <RichText text={it.d} />
                  </span>
                </div>
                <span className="when">{it.w}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------- Flow ----------
function Flow() {
  const { t } = useTranslation();
  const steps = t('flow.steps', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="flow">
      <div className="head">
        <span className="pv-kicker">{t('flow.kicker')}</span>
        <h2 className="pv-display">{t('flow.title')}</h2>
        <p className="desc">{t('flow.desc')}</p>
      </div>
      <div className="pv-loop">
        {steps.map((s, i) => (
          <div key={s.t} className="pv-card pv-step">
            <span className="num">{String(i + 1).padStart(2, '0')}</span>
            <span className="ttl">{s.t}</span>
            <p>{s.p}</p>
            <div className="keys">
              {s.k.map(key => (
                <span key={key} className="pv-key">
                  {key}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Modules / changelog ----------
function Modules() {
  const { t } = useTranslation();
  const mods = t('modules.items', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="modules">
      <div className="head">
        <span className="pv-kicker">{t('modules.kicker')}</span>
        <h2 className="pv-display">{t('modules.title')}</h2>
        <p className="desc">{t('modules.desc')}</p>
      </div>
      <div className="pv-modules">
        {mods.map(m => (
          <div key={m.h} className="pv-card pv-module">
            <span className="when">{m.when}</span>
            <div>
              <h4>{m.h}</h4>
              <ul>
                {m.bullets.map(li => (
                  <li key={li}>{li}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Pricing ----------
function Pricing() {
  const { t } = useTranslation();
  const plans = t('pricing.plans', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="pricing">
      <div className="head">
        <span className="pv-kicker">{t('pricing.kicker')}</span>
        <h2 className="pv-display">{t('pricing.title')}</h2>
        <p className="desc">{t('pricing.desc')}</p>
      </div>
      <div className="pv-pricing">
        {plans.map((p, i) => {
          const featured = i === 1;
          return (
            <div key={p.name} className={`pv-card pv-plan${featured ? ' is-featured' : ''}`}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span className="name">{p.name}</span>
                {featured && (
                  <span className="pv-badge pv-badge-primary">{t('pricing.recommended')}</span>
                )}
              </div>
              <div className="price">
                {p.price === 'Custom' ? (
                  <span className="num" style={{ fontSize: 36 }}>
                    {t('pricing.customPrice')}
                  </span>
                ) : (
                  <>
                    <span className="num">${p.price}</span>
                    <span className="per">{p.per}</span>
                  </>
                )}
              </div>
              <p className="desc">{p.desc}</p>
              <ul>
                {p.bullets.map(b => (
                  <li key={b}>
                    <span className="check">
                      <Check size={12} />
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <a
                className={`pv-btn ${featured ? 'pv-btn-primary' : 'pv-btn-outline'} cta`}
                href="#demo"
              >
                {p.cta}
              </a>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Quote ----------
function Quote() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section">
      <div className="pv-hero-surface pv-quote">
        <blockquote className="pv-display">
          {t('quote.textA')}
          <span>{t('quote.textEm')}</span>
          {t('quote.textB')}
        </blockquote>
        <div className="by">
          <div className="ava">A</div>
          <span className="who">{t('quote.who')}</span>
          <span className="role">{t('quote.role')}</span>
        </div>
      </div>
    </section>
  );
}

// ---------- FAQ ----------
function FAQ() {
  const { t } = useTranslation();
  const items = t('faq.items', { returnObjects: true });
  return (
    <section className="pv-shell pv-section" id="faq">
      <div className="head">
        <span className="pv-kicker">{t('faq.kicker')}</span>
        <h2 className="pv-display">{t('faq.title')}</h2>
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
    </section>
  );
}

// ---------- CTA ----------
function CTA() {
  const { t } = useTranslation();
  return (
    <section className="pv-shell pv-section">
      <div className="pv-hero-surface pv-cta">
        <div>
          <h2 className="pv-display">{t('cta.title')}</h2>
          <p>{t('cta.desc')}</p>
        </div>
        <div className="actions">
          <a className="pv-btn pv-btn-primary" href="#demo">
            <LogIn size={16} /> {t('cta.demo')}
          </a>
          <a className="pv-btn pv-btn-outline" href="#download">
            <Download size={16} /> {t('cta.download')}
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------- Landing ----------
// The landing route renders only the marketing sections; Nav + Footer live in
// the shared Layout that wraps every route.
export default function Landing() {
  const version = useLatestRelease();

  return (
    <>
      <Hero version={version} />
      <Trust />
      <Features />
      <Caja />
      <AISection version={version} />
      <AIFaq />
      <Alerts />
      <Flow />
      <Modules />
      <Pricing />
      <Quote />
      <FAQ />
      <CTA />
    </>
  );
}
