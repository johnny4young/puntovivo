import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Command,
  CreditCard,
  DatabaseBackup,
  FileUp,
  Gauge,
  LayoutDashboard,
  Languages,
  ListFilter,
  MonitorSmartphone,
  PackageSearch,
  PanelRightOpen,
  ReceiptText,
  Rows3,
  Search,
  ShieldCheck,
  SquareDashed,
  SlidersHorizontal,
  Store,
  SunMedium,
  TimerReset,
  UsersRound,
  Wifi,
  ZapOff,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge, Button, KpiTile, StatusStrip } from '@/components/ui';
import { Select } from '@/components/form-controls/Select';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Drawer } from '@/components/feedback/Drawer';
import { EmptyState } from '@/components/feedback/EmptyState';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import perfBudget from '../../../../../perf-budget.json';
import journeyContract from '../../../../../operator-journeys.json';

type StationStatus = 'ready' | 'attention' | 'offline';
type ScaleStatus = 'available' | 'attention' | 'review';

interface StationRow {
  id: string;
  name: string;
  operator: string;
  amount: string;
  status: StationStatus;
}

interface ScaleRow {
  id: string;
  sku: string;
  name: string;
  stock: number;
  status: ScaleStatus;
}

const STATUS_VARIANT: Record<StationStatus, 'success' | 'warning' | 'danger'> = {
  ready: 'success',
  attention: 'warning',
  offline: 'danger',
};

const SCALE_STATUS_VARIANT: Record<ScaleStatus, 'success' | 'warning' | 'info'> = {
  available: 'success',
  attention: 'warning',
  review: 'info',
};

const JOURNEY_OWNER_VARIANT: Record<string, 'info' | 'warning' | 'success'> = {
  admin: 'info',
  manager: 'warning',
  cashier: 'success',
};

function SpecimenHeading({ index, title, copy }: { index: string; title: string; copy: string }) {
  return (
    <div className="design-system-section-heading">
      <span>{index}</span>
      <div>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
    </div>
  );
}

export function DesignSystemPage() {
  const { t, i18n } = useTranslation('designSystem');
  const [site, setSite] = useState<string | number | null>('north');
  const [assistedMode, setAssistedMode] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const stations = useMemo<StationRow[]>(
    () => [
      {
        id: 'station-04',
        name: t('table.rows.station04'),
        operator: t('table.rows.operatorAna'),
        amount: '$ 284.900',
        status: 'ready',
      },
      {
        id: 'station-07',
        name: t('table.rows.station07'),
        operator: t('table.rows.operatorLuis'),
        amount: '$ 91.240',
        status: 'attention',
      },
      {
        id: 'station-11',
        name: t('table.rows.station11'),
        operator: t('table.rows.unassigned'),
        amount: '$ 0',
        status: 'offline',
      },
    ],
    [t]
  );

  const statusLabels = useMemo<Record<StationStatus, string>>(
    () => ({
      ready: t('statuses.ready'),
      attention: t('statuses.attention'),
      offline: t('statuses.offline'),
    }),
    [t]
  );

  const columns = useMemo<ColumnDef<StationRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('table.columns.station'),
        cell: ({ row }) => <span className="font-semibold text-fg1">{row.original.name}</span>,
      },
      {
        accessorKey: 'operator',
        header: t('table.columns.operator'),
      },
      {
        accessorKey: 'amount',
        header: t('table.columns.amount'),
        meta: { cellClassName: 'num', headerClassName: 'num' },
      },
      {
        accessorKey: 'status',
        header: t('table.columns.status'),
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status]}>
            {statusLabels[row.original.status]}
          </Badge>
        ),
      },
    ],
    [statusLabels, t]
  );

  const siteOptions = [
    { value: 'north', label: t('form.sites.north') },
    { value: 'center', label: t('form.sites.center') },
    { value: 'south', label: t('form.sites.south'), disabled: true },
  ];

  const scaleStatusLabels = useMemo<Record<ScaleStatus, string>>(
    () => ({
      available: t('scale.statuses.available'),
      attention: t('scale.statuses.attention'),
      review: t('scale.statuses.review'),
    }),
    [t]
  );

  const scaleRows = useMemo<ScaleRow[]>(
    () =>
      Array.from({ length: perfBudget.dataScale.designSystemRows }, (_, rowIndex) => {
        const number = String(rowIndex + 1).padStart(4, '0');
        const status: ScaleStatus =
          rowIndex % 29 === 0 ? 'review' : rowIndex % 17 === 0 ? 'attention' : 'available';
        return {
          id: `scale-${number}`,
          sku: `PV-${number}`,
          name: t('scale.rows.reference', { number }),
          stock: (rowIndex * 13) % 240,
          status,
        };
      }),
    [t]
  );

  const scaleColumns = useMemo<ColumnDef<ScaleRow>[]>(
    () => [
      {
        accessorKey: 'sku',
        header: t('scale.columns.sku'),
        cell: ({ row }) => <span className="font-mono font-semibold">{row.original.sku}</span>,
      },
      {
        accessorKey: 'name',
        header: t('scale.columns.reference'),
        cell: ({ row }) => <span className="font-semibold text-fg1">{row.original.name}</span>,
      },
      {
        accessorKey: 'stock',
        header: t('scale.columns.stock'),
        meta: { cellClassName: 'num', headerClassName: 'num' },
      },
      {
        accessorKey: 'status',
        header: t('scale.columns.status'),
        cell: ({ row }) => (
          <Badge variant={SCALE_STATUS_VARIANT[row.original.status]} marker="dot">
            {scaleStatusLabels[row.original.status]}
          </Badge>
        ),
      },
    ],
    [scaleStatusLabels, t]
  );

  const scaleRowsLabel = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language).format(
    perfBudget.dataScale.designSystemRows
  );

  return (
    <div className="design-system-page" data-testid="design-system-page">
      <section className="design-system-hero" aria-labelledby="design-system-title">
        <div className="design-system-hero-copy">
          <div className="design-system-signal-line">
            <span className="design-system-live-dot" />
            <span>{t('hero.eyebrow')}</span>
            <span aria-hidden="true">/</span>
            <span>{t('hero.version')}</span>
          </div>
          <h1 id="design-system-title">{t('hero.title')}</h1>
          <p>{t('hero.description')}</p>
          <div className="design-system-hero-actions">
            <Button onClick={() => setIsModalOpen(true)}>
              <Command className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('hero.primaryAction')}
            </Button>
            <Button variant="outline" onClick={() => setIsDrawerOpen(true)}>
              <PanelRightOpen className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('hero.secondaryAction')}
            </Button>
          </div>
        </div>

        <div className="design-system-role-board" aria-label={t('roles.label')}>
          <div className="design-system-role-card commit">
            <span>{t('roles.commit.code')}</span>
            <strong>{t('roles.commit.title')}</strong>
            <p>{t('roles.commit.copy')}</p>
          </div>
          <div className="design-system-role-card command">
            <span>{t('roles.command.code')}</span>
            <strong>{t('roles.command.title')}</strong>
            <p>{t('roles.command.copy')}</p>
          </div>
          <div className="design-system-role-card signal">
            <span>{t('roles.signal.code')}</span>
            <strong>{t('roles.signal.title')}</strong>
            <p>{t('roles.signal.copy')}</p>
          </div>
        </div>
      </section>

      <section className="design-system-section">
        <SpecimenHeading index="01" title={t('controls.title')} copy={t('controls.description')} />
        <div className="design-system-control-grid">
          <div className="design-system-specimen design-system-buttons-panel">
            <div className="design-system-specimen-label">
              <span>{t('controls.actions.eyebrow')}</span>
              <small>{t('controls.actions.note')}</small>
            </div>
            <div className="design-system-button-row">
              <Button>
                <CreditCard className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                {t('controls.actions.primary')}
              </Button>
              <Button variant="secondary">
                <ReceiptText className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                {t('controls.actions.secondary')}
              </Button>
              <Button variant="outline">{t('controls.actions.outline')}</Button>
              <Button variant="success">
                <Check className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                {t('controls.actions.success')}
              </Button>
              <Button variant="danger">
                <XCircle className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                {t('controls.actions.danger')}
              </Button>
              <Button disabled>{t('controls.actions.disabled')}</Button>
            </div>
          </div>

          <div className="design-system-specimen design-system-form-panel">
            <div className="design-system-specimen-label">
              <span>{t('form.eyebrow')}</span>
              <small>{t('form.note')}</small>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="design-system-search" className="label mb-2">
                  {t('form.searchLabel')}
                </label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg3"
                    strokeWidth={1.7}
                    aria-hidden="true"
                  />
                  <input
                    id="design-system-search"
                    className="input pl-10"
                    placeholder={t('form.searchPlaceholder')}
                  />
                </div>
              </div>
              <Select
                label={t('form.siteLabel')}
                options={siteOptions}
                value={site}
                onChange={setSite}
                searchable
              />
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={assistedMode}
              className="design-system-setting-row"
              onClick={() => setAssistedMode(current => !current)}
            >
              <span className="glyph-tile glyph-tile-primary h-10 w-10">
                <SlidersHorizontal className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              </span>
              <span>
                <strong>{t('form.switchTitle')}</strong>
                <small>{t('form.switchCopy')}</small>
              </span>
              <span className={cn('pv-switch', assistedMode && 'on')} aria-hidden="true" />
            </button>
          </div>
        </div>
      </section>

      <section className="design-system-section">
        <SpecimenHeading index="02" title={t('signals.title')} copy={t('signals.description')} />
        <div className="design-system-signal-stack">
          <StatusStrip
            tone="success"
            icon={Wifi}
            title={t('signals.success.title')}
            action={t('signals.success.action')}
          >
            {t('signals.success.copy')}
          </StatusStrip>
          <StatusStrip
            tone="warning"
            icon={Clock3}
            title={t('signals.warning.title')}
            action={t('signals.warning.action')}
          >
            {t('signals.warning.copy')}
          </StatusStrip>
          <StatusStrip
            tone="danger"
            icon={AlertTriangle}
            title={t('signals.danger.title')}
            action={t('signals.danger.action')}
          >
            {t('signals.danger.copy')}
          </StatusStrip>
        </div>
        <div className="design-system-specimen design-system-badge-panel">
          <div className="design-system-specimen-label">
            <span>{t('signals.compact.eyebrow')}</span>
            <small>{t('signals.compact.note')}</small>
          </div>
          <div className="design-system-badge-row" aria-label={t('signals.compact.label')}>
            <Badge variant="success" marker="dot">
              {t('signals.compact.ready')}
            </Badge>
            <Badge variant="warning" marker="dot">
              {t('signals.compact.review')}
            </Badge>
            <Badge variant="danger" marker="dot">
              {t('signals.compact.offline')}
            </Badge>
            <Badge variant="info" marker="dot">
              {t('signals.compact.progress')}
            </Badge>
            <Badge variant="neutral">{t('signals.compact.manual')}</Badge>
          </div>
        </div>
        <div className="design-system-kpi-grid">
          <KpiTile
            icon={CircleDollarSign}
            label={t('kpis.revenue.label')}
            value="$ 4,8 M"
            context={t('kpis.revenue.context')}
            tone="ink"
            mono
            delta={{ direction: 'up', label: '12,4%' }}
          />
          <KpiTile
            icon={Activity}
            label={t('kpis.pace.label')}
            value="38/h"
            context={t('kpis.pace.context')}
            tone="success"
          />
          <KpiTile
            icon={Boxes}
            label={t('kpis.stock.label')}
            value="07"
            context={t('kpis.stock.context')}
            tone="warning"
          />
        </div>
      </section>

      <section className="design-system-section">
        <SpecimenHeading index="03" title={t('data.title')} copy={t('data.description')} />
        <div className="design-system-data-grid">
          <div className="design-system-specimen design-system-table-panel">
            <div className="design-system-specimen-label">
              <span>{t('table.eyebrow')}</span>
              <small>{t('table.note')}</small>
            </div>
            <DataTable
              columns={columns}
              data={stations}
              searchKey="name"
              searchPlaceholder={t('table.searchPlaceholder')}
              variant="dense"
              pageSize={3}
            />
          </div>

          <div className="design-system-state-rail">
            <div className="design-system-specimen design-system-state-panel">
              <div className="design-system-specimen-label">
                <span>{t('states.empty.eyebrow')}</span>
                <small>{t('states.empty.note')}</small>
              </div>
              <EmptyState
                icon={PackageSearch}
                title={t('states.empty.title')}
                description={t('states.empty.copy')}
                action={
                  <Button variant="outline">
                    {t('states.empty.action')}
                    <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                }
              />
            </div>
            <TableErrorState
              title={t('states.error.title')}
              message={t('states.error.copy')}
              retryLabel={t('states.error.action')}
              onRetry={() => undefined}
            />
          </div>
        </div>
      </section>

      <section className="design-system-section">
        <SpecimenHeading index="04" title={t('loading.title')} copy={t('loading.description')} />
        <div className="design-system-loading-grid">
          <TableLoadingState message={t('loading.table')} rowCount={3} />
          <div className="design-system-specimen design-system-contract-card">
            <div className="design-system-contract-icon">
              <ShieldCheck className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <div>
              <span>{t('loading.contract.eyebrow')}</span>
              <h3>{t('loading.contract.title')}</h3>
              <p>{t('loading.contract.copy')}</p>
            </div>
            <div className="design-system-contract-list">
              <span>
                <CheckCircle2 className="h-4 w-4" />
                {t('loading.contract.keyboard')}
              </span>
              <span>
                <CheckCircle2 className="h-4 w-4" />
                {t('loading.contract.contrast')}
              </span>
              <span>
                <CheckCircle2 className="h-4 w-4" />
                {t('loading.contract.responsive')}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="design-system-section">
        <SpecimenHeading index="05" title={t('adoption.title')} copy={t('adoption.description')} />
        <div className="design-system-specimen design-system-adoption-board">
          <div className="design-system-specimen-label">
            <span>{t('adoption.eyebrow')}</span>
            <small>{t('adoption.note')}</small>
          </div>
          <div className="design-system-adoption-grid">
            {(
              [
                { id: 'actions', icon: Command },
                { id: 'signals', icon: Activity },
                { id: 'surfaces', icon: LayoutDashboard },
              ] as const
            ).map((area, index) => {
              const AreaIcon = area.icon;
              return (
                <article key={area.id} className="design-system-adoption-card">
                  <span className="design-system-adoption-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="glyph-tile glyph-tile-primary h-10 w-10">
                    <AreaIcon className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{t(`adoption.areas.${area.id}.title`)}</strong>
                    <p>{t(`adoption.areas.${area.id}.copy`)}</p>
                  </div>
                  <Badge variant="success" marker="dot">
                    {t('adoption.adopted')}
                  </Badge>
                </article>
              );
            })}
          </div>
          <StatusStrip
            tone="info"
            icon={ShieldCheck}
            title={t('adoption.contract.title')}
            action={t('adoption.contract.action')}
          >
            {t('adoption.contract.copy')}
          </StatusStrip>
        </div>
      </section>

      <section className="design-system-section">
        <SpecimenHeading
          index="06"
          title={t('adaptability.title')}
          copy={t('adaptability.description')}
        />
        <div className="design-system-specimen design-system-adaptability-board">
          <div className="design-system-specimen-label">
            <span>{t('adaptability.eyebrow')}</span>
            <small>{t('adaptability.note')}</small>
          </div>
          <div className="design-system-adaptability-grid">
            <article className="design-system-adaptability-card zoom">
              <div className="design-system-adaptability-card-header">
                <span className="glyph-tile glyph-tile-primary h-10 w-10">
                  <SquareDashed className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                </span>
                <Badge variant="info">{t('adaptability.zoom.badge')}</Badge>
              </div>
              <div>
                <strong>{t('adaptability.zoom.title')}</strong>
                <p>{t('adaptability.zoom.copy')}</p>
              </div>
              <div className="design-system-zoom-window" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </article>

            <article className="design-system-adaptability-card motion">
              <div className="design-system-adaptability-card-header">
                <span className="glyph-tile glyph-tile-primary h-10 w-10">
                  <ZapOff className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                </span>
                <Badge variant="success" marker="dot">
                  {t('adaptability.motion.badge')}
                </Badge>
              </div>
              <div>
                <strong>{t('adaptability.motion.title')}</strong>
                <p>{t('adaptability.motion.copy')}</p>
              </div>
              <div className="design-system-motion-track" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </article>

            <article className="design-system-adaptability-card contrast">
              <div className="design-system-adaptability-card-header">
                <span className="glyph-tile glyph-tile-primary h-10 w-10">
                  <SunMedium className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                </span>
                <Badge variant="outline">{t('adaptability.contrast.badge')}</Badge>
              </div>
              <div>
                <strong>{t('adaptability.contrast.title')}</strong>
                <p>{t('adaptability.contrast.copy')}</p>
              </div>
              <div className="design-system-contrast-sample" aria-hidden="true">
                <span />
                <span />
              </div>
            </article>
          </div>
          <StatusStrip
            tone="success"
            icon={ShieldCheck}
            title={t('adaptability.contract.title')}
            action={t('adaptability.contract.action')}
          >
            {t('adaptability.contract.copy')}
          </StatusStrip>
        </div>
      </section>

      <section className="design-system-section" data-testid="design-system-scale-section">
        <SpecimenHeading index="07" title={t('scale.title')} copy={t('scale.description')} />
        <div className="design-system-specimen design-system-scale-board">
          <div className="design-system-specimen-label">
            <span>{t('scale.eyebrow')}</span>
            <small>{t('scale.note')}</small>
          </div>

          <div className="design-system-scale-metrics">
            <article className="design-system-scale-metric">
              <Rows3 aria-hidden="true" />
              <div>
                <span>{t('scale.metrics.dataset.label')}</span>
                <strong data-testid="design-system-scale-count">{scaleRowsLabel}</strong>
                <small>{t('scale.metrics.dataset.copy')}</small>
              </div>
            </article>
            <article className="design-system-scale-metric">
              <Gauge aria-hidden="true" />
              <div>
                <span>{t('scale.metrics.window.label')}</span>
                <strong>
                  {t('scale.metrics.window.value', {
                    count: perfBudget.dataScale.maxMountedRows,
                  })}
                </strong>
                <small>{t('scale.metrics.window.copy')}</small>
              </div>
            </article>
            <article className="design-system-scale-metric">
              <ListFilter aria-hidden="true" />
              <div>
                <span>{t('scale.metrics.search.label')}</span>
                <strong>{t('scale.metrics.search.value')}</strong>
                <small>{t('scale.metrics.search.copy')}</small>
              </div>
            </article>
          </div>

          <div className="design-system-scale-table" data-testid="design-system-scale-table">
            <DataTable
              columns={scaleColumns}
              data={scaleRows}
              searchKey="name"
              searchPlaceholder={t('scale.searchPlaceholder')}
              variant="dense"
            />
          </div>

          <StatusStrip
            tone="info"
            icon={Gauge}
            title={t('scale.contract.title')}
            action={t('scale.contract.action')}
          >
            {t('scale.contract.copy')}
          </StatusStrip>
        </div>
      </section>

      <section className="design-system-section" data-testid="design-system-journey-section">
        <SpecimenHeading index="08" title={t('journeys.title')} copy={t('journeys.description')} />
        <div className="design-system-specimen design-system-journey-board">
          <div className="design-system-specimen-label">
            <span>{t('journeys.eyebrow')}</span>
            <small>{t('journeys.note')}</small>
          </div>

          <div className="design-system-journey-metrics">
            <article>
              <ClipboardCheck aria-hidden="true" />
              <strong>{journeyContract.journeys.length}</strong>
              <span>{t('journeys.metrics.routes')}</span>
            </article>
            <article>
              <Languages aria-hidden="true" />
              <strong>{journeyContract.variantAxes.languages.length}</strong>
              <span>{t('journeys.metrics.languages')}</span>
            </article>
            <article>
              <MonitorSmartphone aria-hidden="true" />
              <strong>{journeyContract.variantAxes.viewports.length}</strong>
              <span>{t('journeys.metrics.viewports')}</span>
            </article>
            <article>
              <UsersRound aria-hidden="true" />
              <strong>{journeyContract.variantAxes.continuity.length}</strong>
              <span>{t('journeys.metrics.continuity')}</span>
            </article>
          </div>

          <div className="design-system-journey-grid">
            {journeyContract.journeys.map((journey, index) => (
              <article key={journey.id} className="design-system-journey-card">
                <span className="design-system-journey-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <strong>{t(`journeys.items.${journey.id}`)}</strong>
                  <small>{t(`journeys.areas.${journey.area}`)}</small>
                </div>
                <Badge variant={JOURNEY_OWNER_VARIANT[journey.owner] ?? 'info'} marker="dot">
                  {t(`journeys.owners.${journey.owner}`)}
                </Badge>
              </article>
            ))}
          </div>

          <StatusStrip
            tone="success"
            icon={ClipboardCheck}
            title={t('journeys.contract.title')}
            action={t('journeys.contract.action')}
          >
            {t('journeys.contract.copy')}
          </StatusStrip>
        </div>
      </section>

      <section className="design-system-section" data-testid="design-system-operational-section">
        <SpecimenHeading
          index="09"
          title={t('operational.title')}
          copy={t('operational.description')}
        />
        <div className="design-system-specimen design-system-operational-board">
          <div className="design-system-specimen-label">
            <span>{t('operational.eyebrow')}</span>
            <small>{t('operational.note')}</small>
          </div>
          <div className="design-system-operational-grid">
            <article className="design-system-operational-card import">
              <span className="glyph-tile glyph-tile-primary h-11 w-11">
                <FileUp className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <div>
                <span>{t('operational.import.eyebrow')}</span>
                <strong>
                  {t('operational.import.value', {
                    count: perfBudget.operationalProfile.launchImport.rows,
                  })}
                </strong>
                <p>
                  {t('operational.import.copy', {
                    preview: perfBudget.operationalProfile.launchImport.previewElapsedMs,
                    commit: perfBudget.operationalProfile.launchImport.commitElapsedMs,
                  })}
                </p>
              </div>
            </article>
            <article className="design-system-operational-card backup">
              <span className="glyph-tile glyph-tile-success h-11 w-11">
                <DatabaseBackup className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <div>
                <span>{t('operational.backup.eyebrow')}</span>
                <strong>
                  {t('operational.backup.value', {
                    count: perfBudget.operationalProfile.encryptedBackup.rows,
                  })}
                </strong>
                <p>
                  {t('operational.backup.copy', {
                    create: perfBudget.operationalProfile.encryptedBackup.createElapsedMs,
                    extract: perfBudget.operationalProfile.encryptedBackup.extractElapsedMs,
                  })}
                </p>
              </div>
            </article>
            <article className="design-system-operational-card launch">
              <span className="glyph-tile glyph-tile-primary h-11 w-11">
                <TimerReset className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <div>
                <span>{t('operational.launch.eyebrow')}</span>
                <strong>
                  {t('operational.launch.value', {
                    count: perfBudget.operationalProfile.desktopLaunchElapsedMs,
                  })}
                </strong>
                <p>{t('operational.launch.copy')}</p>
              </div>
            </article>
            <article className="design-system-operational-card queue">
              <span className="glyph-tile glyph-tile-warning h-11 w-11">
                <Rows3 className="h-5 w-5" strokeWidth={1.6} aria-hidden="true" />
              </span>
              <div>
                <span>{t('operational.queue.eyebrow')}</span>
                <strong>
                  {t('operational.queue.value', {
                    count: perfBudget.operationalProfile.maxPendingBackupOperations,
                  })}
                </strong>
                <p>{t('operational.queue.copy')}</p>
              </div>
            </article>
          </div>
          <StatusStrip
            tone="info"
            icon={Gauge}
            title={t('operational.contract.title')}
            action={t('operational.contract.action')}
          >
            {t('operational.contract.copy', {
              threshold: perfBudget.operationalProfile.thresholdPercent,
            })}
          </StatusStrip>
        </div>
      </section>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('modal.title')}
        footer={
          <>
            <ModalButton onClick={() => setIsModalOpen(false)}>{t('modal.cancel')}</ModalButton>
            <ModalButton variant="primary" onClick={() => setIsModalOpen(false)}>
              {t('modal.confirm')}
            </ModalButton>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-fg2">{t('modal.copy')}</p>
          <div className="surface-panel-muted flex items-center gap-3">
            <span className="glyph-tile glyph-tile-success h-10 w-10">
              <Store className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div>
              <strong className="block text-sm text-fg1">{t('modal.station')}</strong>
              <span className="text-xs text-fg3">{t('modal.operator')}</span>
            </div>
          </div>
        </div>
      </Modal>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={t('drawer.title')}
        pinnedContent={
          <StatusStrip tone="info" icon={LayoutDashboard} title={t('drawer.pinned')} />
        }
        footer={
          <Button className="w-full" onClick={() => setIsDrawerOpen(false)}>
            {t('drawer.action')}
          </Button>
        }
      >
        <div className="space-y-5">
          <p className="text-sm leading-6 text-fg2">{t('drawer.copy')}</p>
          {(['commit', 'command', 'signal'] as const).map(role => (
            <div key={role} className="surface-panel">
              <span className="page-kicker">{t(`roles.${role}.code`)}</span>
              <strong className="mt-2 block text-sm text-fg1">{t(`roles.${role}.title`)}</strong>
              <p className="mt-1 text-xs leading-5 text-fg3">{t(`roles.${role}.copy`)}</p>
            </div>
          ))}
        </div>
      </Drawer>
    </div>
  );
}
