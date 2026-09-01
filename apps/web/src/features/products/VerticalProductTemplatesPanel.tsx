import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  VERTICAL_PRODUCT_TEMPLATES,
  type VerticalProductTemplateId,
} from '@puntovivo/shared/vertical-product-templates';
import type { ProductTemplateVerticalId } from '@puntovivo/shared/vertical-presets';

import type { UnitLookupOption } from './productForm.types';
import type { UseProductFormReturn } from './useProductForm';
import { buildProductTemplateApplication } from './verticalProductTemplates';

interface VerticalProductTemplatesPanelProps {
  formBundle: UseProductFormReturn;
  units: UnitLookupOption[];
  vertical: ProductTemplateVerticalId;
}

type TemplateFeedback =
  | { kind: 'applied'; templateId: VerticalProductTemplateId }
  | { kind: 'missing-unit'; abbreviations: ReadonlyArray<string> }
  | null;

export function VerticalProductTemplatesPanel({
  formBundle,
  units,
  vertical,
}: VerticalProductTemplatesPanelProps) {
  const { t } = useTranslation('products');
  const [feedback, setFeedback] = useState<TemplateFeedback>(null);
  const { form, unitAssignmentsFieldArray } = formBundle;

  function applyTemplate(templateId: VerticalProductTemplateId) {
    const result = buildProductTemplateApplication({
      templateId,
      units,
      prices: {
        cost: form.getValues('cost'),
        price: form.getValues('price'),
        price2: form.getValues('price2'),
        price3: form.getValues('price3'),
      },
    });
    if (!result.ok) {
      setFeedback({ kind: 'missing-unit', abbreviations: result.missingAbbreviations });
      return;
    }

    const { application } = result;
    const setOptions = { shouldDirty: true, shouldValidate: true } as const;
    form.setValue('sellByFraction', application.values.sellByFraction, setOptions);
    form.setValue('fractionStep', application.values.fractionStep, setOptions);
    form.setValue('fractionMinimum', application.values.fractionMinimum, setOptions);
    form.setValue('tracksStock', application.values.tracksStock, setOptions);
    form.setValue('tracksLots', application.values.tracksLots, setOptions);
    form.setValue('tracksSerials', application.values.tracksSerials, setOptions);
    form.setValue('price', application.values.price, setOptions);
    form.setValue('price2', application.values.price2, setOptions);
    form.setValue('price3', application.values.price3, setOptions);
    form.setValue('marginPercent1', application.values.marginPercent1, setOptions);
    form.setValue('marginPercent2', application.values.marginPercent2, setOptions);
    form.setValue('marginPercent3', application.values.marginPercent3, setOptions);
    form.setValue('marginAmount1', application.values.marginAmount1, setOptions);
    form.setValue('marginAmount2', application.values.marginAmount2, setOptions);
    form.setValue('marginAmount3', application.values.marginAmount3, setOptions);
    if (application.resetsDirectStock) {
      form.setValue('stock', 0, setOptions);
    }
    unitAssignmentsFieldArray.replace([application.unitAssignment]);
    void form.trigger([
      'stock',
      'sellByFraction',
      'fractionStep',
      'fractionMinimum',
      'unitAssignments',
    ]);
    setFeedback({ kind: 'applied', templateId });
  }

  return (
    <section
      className="rounded-2xl border border-primary-200 bg-primary-50/70 p-4"
      data-testid="vertical-product-templates"
    >
      <h3 className="text-sm font-semibold text-secondary-950">
        {t('form.templates.title', {
          vertical: t(`form.templates.verticals.${vertical}`),
        })}
      </h3>
      <p className="mt-1 text-sm text-secondary-600">{t('form.templates.description')}</p>

      <div className="mt-4 grid gap-2 lg:grid-cols-3">
        {VERTICAL_PRODUCT_TEMPLATES.filter(template => template.vertical === vertical).map(
          template => (
            <button
              key={template.id}
              type="button"
              className="rounded-xl border border-line bg-white px-3 py-3 text-left transition hover:border-primary-300 hover:bg-primary-50"
              data-testid={`product-template-${template.id}`}
              onClick={() => applyTemplate(template.id)}
            >
              <span className="block text-sm font-semibold text-secondary-900">
                {t(`form.templates.items.${template.id}.label`)}
              </span>
              <span className="mt-1 block text-xs text-secondary-600">
                {t(`form.templates.items.${template.id}.description`)}
              </span>
              {template.gs1Hint !== 'none' && (
                <span className="mt-2 inline-flex rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-medium text-primary-800">
                  {t(`form.templates.gs1.${template.gs1Hint}`)}
                </span>
              )}
            </button>
          )
        )}
      </div>

      <p className="mt-4 text-xs text-secondary-600">{t('form.templates.catalogSafety')}</p>
      <p className="mt-1 text-xs text-secondary-600">{t('form.templates.pricingSafety')}</p>
      <p className="mt-1 text-xs text-secondary-600">{t('form.templates.cutBoundary')}</p>

      {feedback?.kind === 'applied' && (
        <p
          className="mt-3 rounded-lg bg-success-50 px-3 py-2 text-sm text-success-800"
          role="status"
        >
          {t('form.templates.applied', {
            template: t(`form.templates.items.${feedback.templateId}.label`),
          })}
        </p>
      )}
      {feedback?.kind === 'missing-unit' && (
        <p
          className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-800"
          role="alert"
        >
          {t('form.templates.missingUnit', {
            units: feedback.abbreviations.join(', '),
          })}
        </p>
      )}
    </section>
  );
}
