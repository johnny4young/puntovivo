import { LayoutTemplate } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { EditorReceiptLayout, ReceiptTemplateKind } from './defaultLayouts';
import { PAPER_WIDTHS } from './receiptEditor.constants';

interface ReceiptTemplateBasicsProps {
  isEditing: boolean;
  kind: ReceiptTemplateKind;
  name: string;
  paperWidth: EditorReceiptLayout['paperWidth'];
  onKindChange: (kind: ReceiptTemplateKind) => void;
  onNameChange: (name: string) => void;
  onPaperWidthChange: (width: EditorReceiptLayout['paperWidth']) => void;
}

/**
 * Keeps the save-ready receipt decisions separate from the expert structure
 * editor so the default task stays readable and the parent only coordinates
 * layout state.
 */
export function ReceiptTemplateBasics({
  isEditing,
  kind,
  name,
  paperWidth,
  onKindChange,
  onNameChange,
  onPaperWidthChange,
}: ReceiptTemplateBasicsProps): React.ReactElement {
  const { t } = useTranslation('receiptTemplates');

  return (
    <section className="card space-y-5 p-6" aria-labelledby="receipt-basics-title">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary-50 text-primary-700">
          <LayoutTemplate className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[0.66rem] font-bold uppercase tracking-[0.17em] text-secondary-500">
            {t(isEditing ? 'editor.guidedSetup.editEyebrow' : 'editor.guidedSetup.createEyebrow')}
          </p>
          <h2
            id="receipt-basics-title"
            className="mt-1 font-display text-2xl leading-tight text-secondary-950"
          >
            {t(isEditing ? 'editor.guidedSetup.editTitle' : 'editor.guidedSetup.createTitle')}
          </h2>
          <p className="mt-1.5 max-w-[62ch] text-sm leading-6 text-secondary-600">
            {t(
              isEditing
                ? 'editor.guidedSetup.editDescription'
                : 'editor.guidedSetup.createDescription'
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">{t('editor.fields.name')}</span>
          <input
            className="input mt-1"
            value={name}
            onChange={event => onNameChange(event.target.value)}
            placeholder={t('editor.fields.namePlaceholder')}
            maxLength={100}
          />
        </label>
        <label className="block">
          <span className="label">{t('editor.fields.kind')}</span>
          <select
            className="input mt-1"
            value={kind}
            onChange={event => onKindChange(event.target.value as ReceiptTemplateKind)}
            disabled={isEditing}
          >
            <option value="sale">{t('kinds.sale')}</option>
            <option value="quotation">{t('kinds.quotation')}</option>
            <option value="fiscal_dee">{t('kinds.fiscal_dee')}</option>
          </select>
        </label>
        <label className="block">
          <span className="label">{t('editor.fields.paperWidth')}</span>
          <select
            className="input mt-1"
            value={paperWidth}
            onChange={event =>
              onPaperWidthChange(event.target.value as EditorReceiptLayout['paperWidth'])
            }
          >
            {PAPER_WIDTHS.map(width => (
              <option key={width} value={width}>
                {t(`paperWidths.${width}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
