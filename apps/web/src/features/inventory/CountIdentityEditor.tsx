import { useTranslation } from 'react-i18next';

/** Server-redacted count observation; expected quantities appear only after submission. */
export interface CountIdentityView {
  code: string;
  countedQuantity: number | null;
  expectedQuantity: number | null;
  status: string | null;
  expiresAt: string | null;
}
/** Draft exact-lot quantities are strings so a blank is never silently counted as zero. */
export interface CountIdentityEditorProps {
  name: string;
  mode: 'lots' | 'serials';
  identities: CountIdentityView[];
  lotQuantities: Record<string, string>;
  serialText: string;
  emptyConfirmed: boolean;
  disabled: boolean;
  onLotChange: (code: string, value: string) => void;
  onSerialChange: (value: string) => void;
  onEmptyConfirmed: (value: boolean) => void;
}

/** Enter physical observations without exposing expected serial identities or book quantities. */
export function CountIdentityEditor(props: CountIdentityEditorProps) {
  const { t } = useTranslation('inventoryControls');
  if (props.mode === 'serials') {
    return (
      <div className="min-w-64 space-y-2 text-left">
        <p className="text-xs text-secondary-600">{t('count.identities.serialHelp')}</p>
        <textarea
          className="pv-input min-h-28 w-full font-mono text-sm"
          aria-label={t('count.identities.serialsFor', { name: props.name })}
          value={props.serialText}
          onChange={event => props.onSerialChange(event.target.value)}
          disabled={props.disabled}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        {props.serialText.trim() === '' && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.emptyConfirmed}
              disabled={props.disabled}
              onChange={event => props.onEmptyConfirmed(event.target.checked)}
            />
            {t('count.identities.confirmEmpty', { name: props.name })}
          </label>
        )}
      </div>
    );
  }
  return (
    <div className="min-w-64 space-y-3 text-left">
      <p className="text-xs text-secondary-600">{t('count.identities.lotHelp')}</p>
      {props.identities.length === 0 && <p className="text-sm">{t('count.identities.noLots')}</p>}
      {props.identities.map(identity => (
        <label key={identity.code} className="flex items-center justify-between gap-3">
          <span className="min-w-0 break-all font-mono text-xs">
            {identity.code}
            {identity.expiresAt && (
              <span className="mt-1 block font-sans text-secondary-500">{identity.expiresAt}</span>
            )}
          </span>
          <input
            className="pv-input w-28 shrink-0 text-right tabular-nums"
            type="number"
            min="0"
            step="0.001"
            aria-label={t('count.identities.lotQuantityFor', {
              name: props.name,
              lot: identity.code,
            })}
            value={props.lotQuantities[identity.code] ?? ''}
            disabled={props.disabled}
            onChange={event => props.onLotChange(identity.code, event.target.value)}
          />
        </label>
      ))}
    </div>
  );
}

/** Submitted comparison shows exact identity variances, including zero-total substitutions. */
export function CountIdentityReview({ identities }: { identities: CountIdentityView[] }) {
  const { t } = useTranslation('inventoryControls');
  if (identities.length === 0) return null;
  const discrepancies = identities.filter(
    identity => identity.countedQuantity !== identity.expectedQuantity
  ).length;
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer py-2 font-medium text-primary-700">
        {t('count.identities.review')}
        {discrepancies > 0 && (
          <span className="mt-1 block font-normal text-warning-700">
            {t('count.identities.varianceCount', { count: discrepancies })}
          </span>
        )}
      </summary>
      <ul className="space-y-2 py-2">
        {identities.map(identity => (
          <li key={identity.code} className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="break-all font-mono">{identity.code}</span>
            <span className="tabular-nums text-secondary-700">
              {t('count.identities.comparison', {
                expected: identity.expectedQuantity,
                counted: identity.countedQuantity,
              })}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
