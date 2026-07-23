import { CircleCheck, PauseCircle, ReceiptText, ScanLine, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SalesFlowRailProps {
  itemCount: number;
  hasCashSession: boolean;
  suspendedDraftsCount: number;
}

type FlowStageState = 'active' | 'complete' | 'ready' | 'locked' | 'waiting';

interface FlowStage {
  id: 'capture' | 'review' | 'charge';
  number: string;
  state: FlowStageState;
  icon: typeof ScanLine;
  status: string;
}

export function SalesFlowRail({
  itemCount,
  hasCashSession,
  suspendedDraftsCount,
}: SalesFlowRailProps) {
  const { t } = useTranslation('sales');
  const hasItems = itemCount > 0;

  const stages: FlowStage[] = [
    {
      id: 'capture',
      number: '01',
      state: hasItems ? 'complete' : 'active',
      icon: ScanLine,
      status: hasItems ? t('flow.captureComplete', { count: itemCount }) : t('flow.captureWaiting'),
    },
    {
      id: 'review',
      number: '02',
      state: hasItems ? 'active' : 'waiting',
      icon: ReceiptText,
      status: hasItems ? t('flow.reviewActive') : t('flow.reviewWaiting'),
    },
    {
      id: 'charge',
      number: '03',
      state: !hasCashSession ? 'locked' : hasItems ? 'ready' : 'waiting',
      icon: WalletCards,
      status: !hasCashSession
        ? t('flow.chargeLocked')
        : hasItems
          ? t('flow.chargeReady')
          : t('flow.chargeWaiting'),
    },
  ];

  return (
    <section className="sales-flow-rail pv-reveal" aria-labelledby="sales-flow-title">
      <div className="sales-flow-intro">
        <div className="sales-flow-live">
          <span aria-hidden="true" />
          {t('flow.live')}
        </div>
        <h2 id="sales-flow-title">{t('flow.title')}</h2>
        <p>{t('flow.description')}</p>
      </div>

      <ol className="sales-flow-stages" aria-label={t('flow.ariaLabel')}>
        {stages.map(stage => {
          const Icon = stage.icon;
          return (
            <li
              key={stage.id}
              className={`sales-flow-stage is-${stage.state}`}
              data-testid={`sales-flow-${stage.id}`}
            >
              <div className="sales-flow-stage-mark" aria-hidden="true">
                {stage.state === 'complete' ? (
                  <CircleCheck strokeWidth={1.5} />
                ) : (
                  <Icon strokeWidth={1.5} />
                )}
              </div>
              <div className="sales-flow-stage-copy">
                <span>{stage.number}</span>
                <strong>{t(`flow.steps.${stage.id}`)}</strong>
                <p>{stage.status}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="sales-flow-queue" aria-label={t('flow.suspendedAriaLabel')}>
        <PauseCircle strokeWidth={1.5} aria-hidden="true" />
        <div>
          <span>{t('flow.suspended')}</span>
          <strong>{suspendedDraftsCount}</strong>
        </div>
      </div>
    </section>
  );
}
