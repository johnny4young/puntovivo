import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon.jsx';
import { PageHeader } from '../components/PageHeader.jsx';

// Visual keyboard rows (structural — key glyphs are universal).
const ROWS = [
  ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', '⌫'],
  ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
  ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", '⏎'],
  ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'],
  ['Ctrl', '⌥', '⌘', 'Espacio', '⌘', '⌥', 'Ctrl'],
];

// Each shortcut keeps a stable areaKey (used for grouping + filtering, stable
// across locales) and an actionId that resolves to atajos.actions.<id>. Key
// bindings are structural.
const SHORTCUTS = [
  { areaKey: 'Caja', actionId: 'cobrarVenta', keys: ['F1'] },
  { areaKey: 'Caja', actionId: 'nuevaVenta', keys: ['⌥', 'N'] },
  { areaKey: 'Caja', actionId: 'buscarProducto', keys: ['⌥', 'P'] },
  { areaKey: 'Caja', actionId: 'abrirCatalogo', keys: ['F5'] },
  { areaKey: 'Caja', actionId: 'aplicarDescuento', keys: ['⌥', 'D'] },
  { areaKey: 'Caja', actionId: 'pagoDividido', keys: ['⌥', 'Shift', 'P'] },
  { areaKey: 'Caja', actionId: 'anularLinea', keys: ['⌥', '⌫'] },
  { areaKey: 'Caja', actionId: 'reimprimirRecibo', keys: ['⌥', 'R'] },

  { areaKey: 'Cierre', actionId: 'abrirCaja', keys: ['⌥', 'A'] },
  { areaKey: 'Cierre', actionId: 'registrarMovimiento', keys: ['⌥', 'M'] },
  { areaKey: 'Cierre', actionId: 'cerrarCajaCiego', keys: ['⌥', '⇧', 'C'] },
  { areaKey: 'Cierre', actionId: 'saltarDenominaciones', keys: ['⌥', 'B'] },

  { areaKey: 'Inventario', actionId: 'nuevoProducto', keys: ['⌥', 'Shift', 'N'] },
  { areaKey: 'Inventario', actionId: 'buscarSku', keys: ['⌥', 'S'] },
  { areaKey: 'Inventario', actionId: 'ajusteStock', keys: ['⌥', 'I'] },
  { areaKey: 'Inventario', actionId: 'conteoFisico', keys: ['⌥', 'K'] },

  { areaKey: 'Transferencias', actionId: 'nuevaTransferencia', keys: ['⌥', 'T'] },
  { areaKey: 'Transferencias', actionId: 'recibirTransferencia', keys: ['⌥', 'Shift', 'R'] },

  { areaKey: 'Compras', actionId: 'nuevaOrden', keys: ['⌥', 'O'] },
  { areaKey: 'Compras', actionId: 'reciboParcial', keys: ['⌥', 'Shift', 'O'] },
  { areaKey: 'Compras', actionId: 'devolverProveedor', keys: ['⌥', 'V'] },

  { areaKey: 'Navegación', actionId: 'abrirCopilot', keys: ['⌥', 'K'] },
  { areaKey: 'Navegación', actionId: 'cambiarSede', keys: ['⌥', '⇧', 'S'] },
  { areaKey: 'Navegación', actionId: 'irDashboard', keys: ['⌥', '1'] },
  { areaKey: 'Navegación', actionId: 'irVentas', keys: ['⌥', '2'] },
  { areaKey: 'Navegación', actionId: 'irInventario', keys: ['⌥', '3'] },
  { areaKey: 'Navegación', actionId: 'irCompras', keys: ['⌥', '4'] },
  { areaKey: 'Navegación', actionId: 'mostrarAtajos', keys: ['⌥', '?'] },

  { areaKey: 'Sistema', actionId: 'bloquearCaja', keys: ['Esc', 'Esc'] },
  { areaKey: 'Sistema', actionId: 'cerrarSesion', keys: ['⌥', 'Q'] },
  { areaKey: 'Sistema', actionId: 'modoClaroOscuro', keys: ['⌥', '⇧', 'D'] },
];

// Stable group order (Spanish keys) so grouping output is deterministic.
const AREA_ORDER = [
  'Caja',
  'Cierre',
  'Inventario',
  'Transferencias',
  'Compras',
  'Navegación',
  'Sistema',
];

function Kbd({ k, highlight }) {
  const wide = ['Tab', 'Caps', 'Shift', 'Espacio', '⏎', '⌫', 'Backspace'];
  let cls = 'kb-key';
  if (wide.includes(k)) cls += ' w-' + k.toLowerCase();
  if (highlight) cls += ' hl';
  return <span className={cls}>{k}</span>;
}

function Keyboard({ highlight }) {
  return (
    <div className="kb-board">
      {ROWS.map((row, i) => (
        <div key={i} className={'kb-row kb-row-' + i}>
          {row.map((k, j) => (
            <Kbd key={j} k={k} highlight={highlight.has(k)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function platformKeys(keys, platform) {
  if (platform !== 'win') return keys;
  return keys.map(k => (k === '⌘' ? 'Ctrl' : k === '⌥' ? 'Alt' : k));
}

function ShortcutRow({ s, label, onHover, platform }) {
  const keys = platformKeys(s.keys, platform);
  return (
    <div
      className="ks-row"
      onMouseEnter={() => onHover(new Set(keys))}
      onMouseLeave={() => onHover(new Set())}
    >
      <span className="action">{label}</span>
      <span className="combo">
        {keys.map((k, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="plus">+</span>}
            <span className="pv-key">{k}</span>
          </Fragment>
        ))}
      </span>
    </div>
  );
}

export default function Atajos() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  // areaFilter holds a stable areaKey ("Caja"…) or '' for all.
  const [areaFilter, setAreaFilter] = useState('');
  const [platform, setPlatform] = useState('mac');
  const [highlight, setHighlight] = useState(new Set());

  const labelFor = s => t(`atajos.actions.${s.actionId}`);
  const areaLabel = key => t(`atajos.areaNames.${key}`);
  // Display order of filter chips: "Todos/All" first, then the localized area names.
  const filterChips = [{ key: '', label: t('atajos.areas', { returnObjects: true })[0] }].concat(
    AREA_ORDER.map(key => ({ key, label: areaLabel(key) }))
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SHORTCUTS.filter(s => {
      if (areaFilter && s.areaKey !== areaFilter) return false;
      if (needle) {
        const label = t(`atajos.actions.${s.actionId}`).toLowerCase();
        const area = areaLabel(s.areaKey).toLowerCase();
        if (!label.includes(needle) && !area.includes(needle)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, areaFilter, t]);

  const grouped = useMemo(() => {
    const g = {};
    filtered.forEach(s => {
      (g[s.areaKey] ||= []).push(s);
    });
    return AREA_ORDER.filter(k => g[k]).map(k => [k, g[k]]);
  }, [filtered]);

  return (
    <>
      <PageHeader
        kicker={t('atajos.kicker')}
        title={
          <>
            {t('atajos.titleA')}
            <br /> <em>{t('atajos.titleEm')}</em>
            {t('atajos.titleB')}
          </>
        }
        lead={t('atajos.lead')}
        crumbs={[
          { label: t('atajos.crumbInicio'), to: '/' },
          { label: t('atajos.crumbRecursos') },
          { label: t('atajos.crumbAtajos') },
        ]}
        badges={[
          { label: t('atajos.badgeCount', { count: SHORTCUTS.length }), tone: 'pv-badge-primary' },
          { label: t('atajos.badgeOs'), tone: 'pv-badge-amber' },
          { label: t('atajos.badgePrintable'), tone: 'pv-badge-neutral' },
        ]}
        aside={
          <div className="ks-aside">
            <div className="ks-platform">
              <span className="pv-label">{t('atajos.platformLabel')}</span>
              <div className="ks-platform-row">
                <button
                  className={'plat' + (platform === 'mac' ? ' on' : '')}
                  onClick={() => setPlatform('mac')}
                >
                  <Icon name="apple" size={13} /> {t('atajos.platformMac')}
                </button>
                <button
                  className={'plat' + (platform === 'win' ? ' on' : '')}
                  onClick={() => setPlatform('win')}
                >
                  <Icon name="square" size={13} /> {t('atajos.platformWin')}
                </button>
              </div>
            </div>
            <div className="ks-legend">
              <span className="pv-label">{t('atajos.legendLabel')}</span>
              <div className="ks-legend-row">
                <span>
                  <span className="pv-key">{platform === 'mac' ? '⌥' : 'Alt'}</span>{' '}
                  {t('atajos.legendOption')}
                </span>
                <span>
                  <span className="pv-key">{platform === 'mac' ? '⌘' : 'Ctrl'}</span>{' '}
                  {t('atajos.legendCommand')}
                </span>
                <span>
                  <span className="pv-key">⇧</span> {t('atajos.legendShift')}
                </span>
                <span>
                  <span className="pv-key">⏎</span> {t('atajos.legendEnter')}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="pv-btn pv-btn-outline pv-btn-sm"
              onClick={() => window.print()}
            >
              <Icon name="printer" size={14} /> {t('atajos.printButton')}
            </button>
          </div>
        }
      />

      <section className="pv-shell pv-section" style={{ paddingTop: 48 }}>
        <Keyboard highlight={highlight} />
        <div className="kb-foot">
          <Icon name="info" size={12} /> {t('atajos.keyboardFoot')}
        </div>
      </section>

      <section className="pv-shell pv-section">
        <div className="ks-filterbar">
          <div className="ks-search">
            <Icon name="search" size={16} color="var(--primary-700)" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('atajos.searchPlaceholder')}
            />
            {q && (
              <button className="ks-clear" onClick={() => setQ('')}>
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <div className="ks-areas">
            {filterChips.map(({ key, label }) => (
              <button
                key={key || 'all'}
                className={'ks-area' + (key === areaFilter ? ' on' : '')}
                onClick={() => setAreaFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="ks-groups">
          {grouped.map(([areaKey, list]) => (
            <section key={areaKey} className="ks-group">
              <header>
                <h3>{areaLabel(areaKey)}</h3>
                <span className="count">{list.length}</span>
              </header>
              <div className="ks-list">
                {list.map((s, i) => (
                  <ShortcutRow
                    key={i}
                    s={s}
                    label={labelFor(s)}
                    onHover={setHighlight}
                    platform={platform}
                  />
                ))}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            <div className="ks-empty">
              <Icon name="search-x" size={20} color="var(--fg3)" />
              <span>{t('atajos.emptyText')}</span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
