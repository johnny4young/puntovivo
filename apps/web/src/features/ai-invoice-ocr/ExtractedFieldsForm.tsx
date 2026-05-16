import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check } from 'lucide-react';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { cn, formatCurrency } from '@/lib/utils';
import type { ProductSearchSelection, Provider } from '@/types';
import { bandConfidence, type Confidence, type PurchaseDraft } from './types';

interface ExtractedFieldsFormProps {
  draft: PurchaseDraft;
  providers: Provider[];
  onChange: (next: PurchaseDraft) => void;
  onConfirm: (next: PurchaseDraft) => void;
  onCancel: () => void;
  isPending?: boolean;
}

const bandClass: Record<Confidence, string> = {
  high: 'bg-success-50 text-success-700',
  mid: 'bg-warning-50 text-warning-700',
  low: 'bg-danger-50 text-danger-700',
};

export function ExtractedFieldsForm({
  draft,
  providers,
  onChange,
  onConfirm,
  onCancel,
  isPending = false,
}: ExtractedFieldsFormProps) {
  const { t } = useTranslation('invoiceOcr');
  const [activeLine, setActiveLine] = useState<{ index: number; query: string } | null>(null);
  const { control, handleSubmit, setValue } = useForm<PurchaseDraft>({
    defaultValues: draft,
    mode: 'onChange',
  });

  const linesSum = useWatch({ control, name: 'totals.linesSum' });
  const total = useWatch({ control, name: 'totals.total' });
  const providerId = useWatch({ control, name: 'providerId' });
  const lines = useWatch({ control, name: 'lines' });
  const totalsMismatch = Math.abs((linesSum ?? 0) - (total ?? 0)) > 100;
  const unmatchedLines = lines.filter(l => !l.matchedProductId || !l.unitId).length;
  const canConfirm = !totalsMismatch && unmatchedLines === 0 && Boolean(providerId);

  function submit(values: PurchaseDraft) {
    onChange(values);
    onConfirm(values);
  }

  function resolveLine(selection: ProductSearchSelection) {
    if (!activeLine) return;
    const path = `lines.${activeLine.index}` as const;
    setValue(`${path}.matchedProductId`, selection.product.id, { shouldDirty: true });
    setValue(`${path}.matchedProductName`, selection.product.name, { shouldDirty: true });
    setValue(`${path}.matchedProductSku`, selection.product.sku, { shouldDirty: true });
    setValue(`${path}.unitId`, selection.unit.unitId, { shouldDirty: true });
    setValue(
      `${path}.unitName`,
      selection.unit.unitName ?? selection.unit.unitAbbreviation ?? selection.unit.unitId,
      { shouldDirty: true }
    );
    setValue(`${path}.unitEquivalence`, selection.unit.equivalence, { shouldDirty: true });
    setValue(`${path}.matchedBy`, 'manual', { shouldDirty: true });
    setValue(`${path}.confidence`, 1, { shouldDirty: true });
    setActiveLine(null);
  }

  return (
    <>
      <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-2">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-secondary-500">
          {t('form.kicker', { defaultValue: 'Borrador de compra' })}
        </p>

      <FieldRow label={t('form.supplier', { defaultValue: 'Proveedor' })} confidence={draft.supplier.confidence}>
        <Controller
          control={control}
          name="supplier.name"
          render={({ field }) => (
            <input
              {...field}
              className="w-full bg-transparent font-mono text-[11.5px] text-secondary-950 focus:outline-none"
            />
          )}
        />
      </FieldRow>

      <FieldRow label={t('form.provider', { defaultValue: 'Proveedor catálogo' })} confidence={providerId ? 0.9 : 0.45}>
        <Controller
          control={control}
          name="providerId"
          render={({ field }) => (
            <select
              value={field.value ?? ''}
              onChange={event => field.onChange(event.target.value || null)}
              className="w-full bg-transparent font-mono text-[11.5px] text-secondary-950 focus:outline-none"
            >
              <option value="">{t('form.selectProvider', { defaultValue: 'Selecciona proveedor' })}</option>
              {providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          )}
        />
      </FieldRow>

      <FieldRow label="NIT" confidence={draft.supplier.confidence}>
        <Controller
          control={control}
          name="supplier.nit"
          render={({ field }) => (
            <input
              {...field}
              value={field.value ?? ''}
              className="w-full bg-transparent font-mono text-[11.5px] text-secondary-950 focus:outline-none"
            />
          )}
        />
      </FieldRow>

      <FieldRow
        label={t('form.invoiceNumber', { defaultValue: 'Número factura' })}
        confidence={draft.invoiceNumber.confidence}
      >
        <Controller
          control={control}
          name="invoiceNumber.value"
          render={({ field }) => (
            <input
              {...field}
              className="w-full bg-transparent font-mono text-[11.5px] text-secondary-950 focus:outline-none"
            />
          )}
        />
      </FieldRow>

      <FieldRow label={t('form.lines', { defaultValue: 'Líneas' })} confidence={1}>
        <span className="font-mono text-[11.5px] text-secondary-950">
          {lines.length} · {lines.reduce((acc, l) => acc + l.quantity, 0)} u
        </span>
      </FieldRow>

      <div className="space-y-2 rounded-[10px] border border-line bg-surface/96 p-2.5">
        {lines.map((line, index) => {
          const matched = Boolean(line.matchedProductId && line.unitId);
          return (
            <div
              key={`${line.description}:${index}`}
              className="grid gap-2 border-b border-line/70 pb-2 last:border-0 last:pb-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-secondary-950">
                    {line.description}
                  </p>
                  <p className="text-[11px] text-secondary-500">
                    {line.quantity} x {formatCurrency(line.unitPrice)}
                  </p>
                  <p className={cn('mt-1 text-[11px]', matched ? 'text-success-700' : 'text-warning-700')}>
                    {matched
                      ? `${line.matchedProductSku ?? ''} ${line.matchedProductName ?? ''}`.trim()
                      : t('form.unmatchedLine', { defaultValue: 'Pendiente de producto' })}
                  </p>
                </div>
                <ConfidenceChip confidence={line.confidence} />
              </div>
              <button
                type="button"
                className="btn-outline min-h-0 w-fit rounded-[10px] px-3 py-1.5 text-[11px]"
                onClick={() => setActiveLine({ index, query: line.description })}
              >
                {matched
                  ? t('form.changeProduct', { defaultValue: 'Cambiar producto' })
                  : t('form.assignProduct', { defaultValue: 'Asignar producto' })}
              </button>
            </div>
          );
        })}
      </div>

      <FieldRow label={t('form.subtotal', { defaultValue: 'Subtotal' })} confidence={0.95}>
        <span className="font-mono text-[11.5px] text-secondary-950">{formatCurrency(draft.totals.subtotal)}</span>
      </FieldRow>

      <FieldRow label="IVA" confidence={0.95}>
        <span className="font-mono text-[11.5px] text-secondary-950">{formatCurrency(draft.totals.iva)}</span>
      </FieldRow>

      <FieldRow label={t('form.total', { defaultValue: 'Total' })} confidence={0.95} emphasize>
        <span className="font-mono text-[11.5px] font-bold text-primary-700">
          {formatCurrency(draft.totals.total)}
        </span>
      </FieldRow>

      {totalsMismatch && (
        <Warning>
          {t('form.warning.totalsMismatch', {
            defaultValue:
              'El total no coincide con la suma de líneas (diferencia {{diff}}). Revisa antes de confirmar.',
            diff: formatCurrency(Math.abs((linesSum ?? 0) - (total ?? 0))),
          })}
        </Warning>
      )}
      {unmatchedLines > 0 && (
        <Warning>
          {t('form.warning.unmatched', {
            defaultValue: '{{count}} líneas sin coincidencia en el catálogo. Asígnales un producto para confirmar.',
            count: unmatchedLines,
          })}
        </Warning>
      )}
      {!providerId && (
        <Warning>
          {t('form.warning.providerRequired', {
            defaultValue: 'Selecciona el proveedor del catálogo antes de confirmar.',
          })}
        </Warning>
      )}

      {draft.warnings.map(w => (
        <Warning key={w}>{w}</Warning>
      ))}

      <p className="rounded-[10px] border border-dashed border-warning-500/30 bg-warning-50/50 px-2.5 py-2 text-[11px] text-warning-700">
        {t('form.disclaimer', {
          defaultValue: 'La IA leyó la factura. Revisa cada campo antes de registrar la compra.',
        })}
      </p>

      <footer className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-[14px] border border-line bg-surface px-4 py-2 text-xs text-secondary-700 hover:bg-surface-2 disabled:opacity-60"
        >
          {t('form.cancel', { defaultValue: 'Cancelar' })}
        </button>
        <button
          type="submit"
          disabled={!canConfirm || isPending}
          className={cn(
            'inline-flex items-center gap-2 rounded-[14px] px-5 py-2 text-xs font-semibold transition-transform',
            canConfirm
              ? 'bg-primary text-primary-foreground hover:-translate-y-px'
              : 'cursor-not-allowed bg-line text-secondary-500'
          )}
        >
          <Check className="h-4 w-4" />
          {isPending
            ? t('form.confirming', { defaultValue: 'Registrando...' })
            : t('form.confirm', { defaultValue: 'Confirmar' })}
        </button>
      </footer>
      </form>
      <ProductSearchDialog
        key={activeLine ? `${activeLine.index}:${activeLine.query}` : 'ocr-product-search'}
        isOpen={activeLine !== null}
        onClose={() => setActiveLine(null)}
        onSelect={resolveLine}
        providers={providers}
        initialQuery={activeLine?.query ?? ''}
        title={t('form.productPickerTitle', { defaultValue: 'Asignar producto a la línea' })}
        confirmLabel={t('form.productPickerConfirm', { defaultValue: 'Usar producto' })}
      />
    </>
  );
}

interface FieldRowProps {
  label: string;
  confidence: number;
  emphasize?: boolean;
  children: React.ReactNode;
}

function FieldRow({ label, confidence, emphasize, children }: FieldRowProps) {
  const band = bandConfidence(confidence);
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto] items-center gap-2 rounded-[10px] border bg-surface/96 px-2.5 py-1.5 text-[11.5px]',
        emphasize ? 'border-primary/30 bg-primary-50/40' : 'border-line'
      )}
    >
      <div className="flex flex-col">
        <span className="text-[8.5px] font-semibold uppercase tracking-[0.2em] text-secondary-500">
          {label}
        </span>
        {children}
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold',
          bandClass[band]
        )}
      >
        {Math.round(confidence * 100)}%
      </span>
    </div>
  );
}

function ConfidenceChip({ confidence }: { confidence: number }) {
  const band = bandConfidence(confidence);
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold',
        bandClass[band]
      )}
    >
      {Math.round(confidence * 100)}%
    </span>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-warning-500/30 bg-warning-50 px-2.5 py-2 text-[11px] text-warning-700">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}
