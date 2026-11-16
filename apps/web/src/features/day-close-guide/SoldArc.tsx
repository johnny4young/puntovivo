import { useTranslation } from 'react-i18next';
import { arcPath, arcPoint, soldArcFractions, soldChange } from './closeGuideModel';

const WIDTH = 420;
const CX = WIDTH / 2;
const CY = 200;
const RADIUS = 170;
const STROKE = 26;

interface SoldArcProps {
  sold: number;
  comparison: number;
  salesCount: number;
  formatCurrency: (value: number) => string;
}

/** What the sealed day sold, against the same day last week. */
export function SoldArc({ sold, comparison, salesCount, formatCurrency }: SoldArcProps) {
  const { t } = useTranslation('closeGuide');
  const fractions = soldArcFractions(sold, comparison);
  const change = soldChange(sold, comparison);
  const marker =
    fractions.comparison === null ? null : arcPoint(fractions.comparison, CX, CY, RADIUS);

  return (
    <figure className="relative m-0 mx-auto w-full max-w-[420px]" data-testid="close-guide-arc">
      <svg
        viewBox={`0 0 ${WIDTH} ${CY + 8}`}
        className="block h-auto w-full"
        role="img"
        aria-label={t('arc.summary', {
          total: formatCurrency(sold),
          comparison: formatCurrency(comparison),
        })}
      >
        <path
          d={arcPath(1, CX, CY, RADIUS)}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        {fractions.sold > 0 && (
          <path
            d={arcPath(fractions.sold, CX, CY, RADIUS)}
            fill="none"
            stroke="var(--primary-600)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        )}
        {marker && (
          <circle
            cx={marker.x}
            cy={marker.y}
            r={7}
            fill="var(--surface)"
            stroke="var(--fg1)"
            strokeWidth={2.5}
          />
        )}
        <line x1={0} x2={WIDTH} y1={CY + 6} y2={CY + 6} stroke="var(--fg1)" strokeWidth={2} />
      </svg>
      <figcaption className="absolute inset-x-0 bottom-4 flex flex-col items-center text-center">
        <span className="text-xs font-semibold tracking-[0.14em] text-fg3 uppercase">
          {t('arc.label')}
        </span>
        <span
          className="font-numeric text-[2.6rem] leading-none text-fg1"
          data-testid="close-guide-sold"
        >
          {formatCurrency(sold)}
        </span>
        <span className="text-sm text-fg2">
          {t('arc.sales', { count: salesCount })}
          {change !== null && (
            <b className={change >= 0 ? ' text-success-700' : ' text-danger-700'}>
              {' · '}
              {change >= 0
                ? t('arc.more', { value: Math.abs(change) })
                : t('arc.less', { value: Math.abs(change) })}
            </b>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
