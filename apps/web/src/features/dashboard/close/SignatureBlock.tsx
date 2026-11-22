import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { PinField } from '@/features/sales/handoff/HandoffFrame';
import type { CloseSignoff } from './closeModel';
import { RowIcon } from './CloseRows';
import { DaySeal } from './DaySeal';
import { SignaturePad } from './SignaturePad';
import { SignaturePreview } from './SignaturePreview';
import type { SignatureDraft } from './useSignatureDraft';

export function SignatureBlock({
  signoff,
  rank,
  signerName,
  roleLabel,
  hasPin,
  draft,
  disabled,
}: {
  signoff: CloseSignoff | null;
  rank: number;
  signerName: string;
  roleLabel: string;
  hasPin: boolean;
  draft: SignatureDraft;
  disabled: boolean;
}) {
  const { t } = useTranslation('dayCloseGuide');
  if (signoff) {
    const signedWith = {
      pin: 'sign.signedPin',
      drawn: 'sign.signedDrawn',
      session: 'sign.signedSession',
    }[signoff.signatureMethod];
    return (
      <section
        className="relative mt-3 flex flex-wrap items-center gap-4 rounded-[18px] border-[1.5px] border-line bg-surface p-4"
        data-testid="day-close-signed"
      >
        <RowIcon state="done" />
        <div className="min-w-0 flex-1">
          <p className="text-[16.5px] font-semibold text-fg1">{t('sign.title')}</p>
          <p className="text-sm text-fg3">{t(signedWith, { name: signoff.signedBy.name })}</p>
          {signoff.signaturePath && (
            <SignaturePreview
              path={signoff.signaturePath}
              className="mt-2 block h-auto w-full max-w-[26rem]"
              testId="day-close-signed-path"
            />
          )}
        </div>
        <DaySeal date={signoff.date} signedAt={signoff.signedAt} timeZone={signoff.timeZone} />
      </section>
    );
  }
  return (
    <section
      className="mt-3 rounded-[18px] border-2 border-fg1 bg-surface px-4 py-3"
      data-testid="day-close-signature"
    >
      <div className="flex flex-wrap items-center gap-3.5">
        <RowIcon state="todo" rank={rank} />
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold text-fg1">{t('sign.title')}</p>
          <p className="text-sm text-fg3">
            {t(hasPin ? 'sign.detailPin' : 'sign.detailDraw', {
              name: signerName,
              role: roleLabel,
            })}
          </p>
        </div>
        {hasPin && (
          <Button
            variant="ghost"
            size="compact"
            onClick={() => draft.setMode(draft.mode === 'pin' ? 'draw' : 'pin')}
            data-testid="day-close-sign-mode"
          >
            {t(draft.mode === 'pin' ? 'sign.useDraw' : 'sign.usePin')}
          </Button>
        )}
      </div>
      <div className="mt-3 pl-0 sm:pl-10">
        {draft.mode === 'pin' ? (
          <PinField
            value={draft.pin}
            onChange={draft.setPin}
            label={t('sign.pinLabel')}
            invalid={draft.invalid}
          />
        ) : (
          <div className="relative">
            <SignaturePad
              strokes={draft.strokes}
              onChange={draft.setStrokes}
              label={t('sign.pad')}
              disabled={disabled}
            />
            {draft.strokes.length > 0 && (
              <Button
                variant="ghost"
                size="compact"
                className="absolute right-2 top-2"
                onClick={() => draft.setStrokes([])}
                data-testid="day-close-signature-clear"
              >
                {t('sign.clear')}
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
