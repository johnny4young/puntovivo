import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import {
  ReceiptTemplateEditor,
  type ReceiptTemplateEditorProps,
} from './ReceiptTemplateEditor';
import type { EditorReceiptLayout } from './defaultLayouts';

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; templateId: string };

type TemplateKind = 'sale' | 'quotation' | 'fiscal_dee';

const KIND_FILTER_OPTIONS: TemplateKind[] = ['sale', 'quotation', 'fiscal_dee'];

/**
 * Iter 2 — Receipt Templates admin page.
 *
 * Modes are kept in local state instead of routes so the editor can keep
 * the unsaved layout in memory while the user navigates between blocks.
 * Switching to the list mode is the explicit "back" affordance and the
 * editor confirms via toast on save.
 */
export function ReceiptTemplatesPage() {
  const { t } = useTranslation(['receiptTemplates', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [kindFilter, setKindFilter] = useState<TemplateKind | ''>('');
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const listInput = useMemo(
    () => ({ kind: kindFilter || undefined, includeInactive: true }),
    [kindFilter]
  );
  const listQuery = trpc.receiptTemplates.list.useQuery(listInput, {
    staleTime: 15_000,
  });

  const editTarget = trpc.receiptTemplates.getById.useQuery(
    mode.kind === 'edit' ? { id: mode.templateId } : { id: '' },
    { enabled: mode.kind === 'edit' }
  );

  const setDefaultMutation = trpc.receiptTemplates.setDefault.useMutation({
    onSuccess: async () => {
      await utils.receiptTemplates.list.invalidate();
      toast.success({ title: t('toast.setDefaultSuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'receiptTemplates:toast.setDefaultError' }),
  });

  const duplicateMutation = trpc.receiptTemplates.duplicate.useMutation({
    onSuccess: async () => {
      await utils.receiptTemplates.list.invalidate();
      toast.success({ title: t('toast.duplicateSuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'receiptTemplates:toast.duplicateError' }),
  });

  const deleteMutation = trpc.receiptTemplates.delete.useMutation({
    onSuccess: async () => {
      await utils.receiptTemplates.list.invalidate();
      toast.success({ title: t('toast.deleteSuccess') });
      setPendingDelete(null);
    },
    onError: onErrorToast(toast, t, { titleKey: 'receiptTemplates:toast.deleteError' }),
  });

  const items = listQuery.data?.items ?? [];

  if (mode.kind === 'create' || mode.kind === 'edit') {
    const initial: ReceiptTemplateEditorProps['initial'] = (() => {
      if (mode.kind === 'create') return null;
      const detail = editTarget.data;
      if (!detail) return null;
      return {
        id: detail.id,
        name: detail.name,
        kind: detail.kind as TemplateKind,
        layout: detail.layout as unknown as EditorReceiptLayout,
        isDefault: detail.isDefault,
        isActive: detail.isActive,
      };
    })();

    const editorIsLoading =
      mode.kind === 'edit' && (editTarget.isLoading || !initial);

    // The header (title, Back button) renders
    // unconditionally so the operator can always exit the editor mode
    // even while the GET round-trip is in flight. Otherwise a slow
    // network would trap the user in a "…" card with no escape.
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-secondary-900">
              {mode.kind === 'create'
                ? t('editor.createTitle')
                : t('editor.editTitle')}
            </h1>
          </div>
          <button
            type="button"
            className="btn-outline"
            onClick={() => setMode({ kind: 'list' })}
          >
            {t('actions.back')}
          </button>
        </div>
        {editorIsLoading ? (
          <div
            className="card p-8 text-center text-sm text-secondary-500"
            data-testid="receipt-template-editor-loading"
          >
            …
          </div>
        ) : (
          // The `key` forces a fresh editor mount per template id so
          // closing the editor on template A and immediately opening
          // template B does not leak A's local layout state into B's
          // form. Plain `useState` in the editor only initializes
          // once per mount.
          <ReceiptTemplateEditor
            key={mode.kind === 'edit' ? mode.templateId : 'create'}
            initial={initial}
            onClose={() => setMode({ kind: 'list' })}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-secondary-900">
          {t('page.title')}
        </h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setMode({ kind: 'create' })}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('actions.newTemplate')}
        </button>
      </div>

      <div className="card p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block">
            <span className="label">{t('list.filters.kind')}</span>
            <select
              className="input mt-1"
              value={kindFilter}
              onChange={e => setKindFilter(e.target.value as TemplateKind | '')}
            >
              <option value="">{t('list.filters.all')}</option>
              {KIND_FILTER_OPTIONS.map(opt => (
                <option key={opt} value={opt}>
                  {t(`kinds.${opt}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="card p-6">
        {listQuery.isLoading ? (
          <p className="text-sm text-secondary-500">…</p>
        ) : items.length === 0 ? (
          <div className="space-y-3 py-8 text-center">
            <p className="text-base font-semibold text-secondary-900">
              {t('list.emptyState.title')}
            </p>
            <p className="text-sm text-secondary-500">
              {t('list.emptyState.description')}
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setMode({ kind: 'create' })}
            >
              {t('list.emptyState.cta')}
            </button>
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="receipt-templates-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-secondary-500">
                <th className="py-2">{t('list.columns.name')}</th>
                <th>{t('list.columns.kind')}</th>
                <th>{t('list.columns.paperWidth')}</th>
                <th>{t('list.columns.default')}</th>
                <th>{t('list.columns.updated')}</th>
                <th className="text-right">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr
                  key={item.id}
                  className="border-t border-line"
                  data-testid={`receipt-template-row-${item.id}`}
                >
                  <td className="py-3 font-medium text-secondary-900">
                    {item.name}
                  </td>
                  <td className="text-secondary-700">
                    {t(`kinds.${item.kind as TemplateKind}`)}
                  </td>
                  <td className="text-secondary-700">
                    {t(
                      `paperWidths.${item.paperWidth as EditorReceiptLayout['paperWidth']}`,
                      { defaultValue: item.paperWidth }
                    )}
                  </td>
                  <td>
                    {item.isDefault ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <Star className="h-3 w-3" />
                        {t('list.defaultBadge')}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-xs text-secondary-500">
                    {new Date(item.updatedAt).toLocaleString()}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {!item.isDefault ? (
                        <button
                          type="button"
                          className="btn-icon btn-ghost"
                          aria-label={t('actions.setDefault')}
                          title={t('actions.setDefault')}
                          onClick={() =>
                            setDefaultMutation.mutate({ id: item.id })
                          }
                          disabled={setDefaultMutation.isPending}
                        >
                          <Star className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn-icon btn-ghost"
                        aria-label={t('actions.edit')}
                        title={t('actions.edit')}
                        onClick={() =>
                          setMode({ kind: 'edit', templateId: item.id })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="btn-icon btn-ghost"
                        aria-label={t('actions.duplicate')}
                        title={t('actions.duplicate')}
                        onClick={() =>
                          duplicateMutation.mutate({ id: item.id })
                        }
                        disabled={duplicateMutation.isPending}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        className="btn-icon btn-ghost text-error"
                        aria-label={t('actions.delete')}
                        title={t('actions.delete')}
                        onClick={() =>
                          setPendingDelete({ id: item.id, name: item.name })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title={t('delete.title')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleteMutation.isPending}
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary bg-error hover:bg-error/90"
              onClick={() =>
                pendingDelete && deleteMutation.mutate({ id: pendingDelete.id })
              }
              disabled={deleteMutation.isPending}
            >
              {t('delete.confirm')}
            </button>
          </div>
        }
      >
        <p className="text-sm text-secondary-700">
          {t('delete.confirmMessage')}
        </p>
        {pendingDelete ? (
          <p className="mt-2 text-sm font-medium text-secondary-900">
            {pendingDelete.name}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
