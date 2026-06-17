import { type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TextBlockEditor } from './TextBlockEditor';
import { TemplateFunctionsCheatSheet } from './TemplateFunctionsCheatSheet';
import { TotalsBlockCaption } from './TotalsBlockCaption';
import { ITEMS_TABLE_COLUMNS, TOTALS_LINES } from './receiptEditor.constants';
import type { EditorReceiptBlock } from './defaultLayouts';
import type { AvailabilityMap } from './templateUnavailableDecorations';

/** Props for {@link BlockForm} — the per-block property editor. */
interface BlockFormProps {
  block: EditorReceiptBlock;
  onPatch: (patch: Partial<EditorReceiptBlock>) => void;
  /** ENG-016 pass 5 — passed through to TextBlockEditor for unset-variable hints. */
  unavailableVariables?: AvailabilityMap | null;
}

/**
 * Per-block form. Each branch only uses the patch fields valid for the
 * current discriminator value, and the parent's `patchBlock` widens the
 * union after merge — this keeps every branch type-safe while sharing
 * the same callback.
 */
export function BlockForm({ block, onPatch, unavailableVariables }: BlockFormProps) {
  const { t } = useTranslation('receiptTemplates');

  function handleAlignChange(e: ChangeEvent<HTMLSelectElement>) {
    onPatch({ align: e.target.value as 'left' | 'center' | 'right' });
  }

  switch (block.type) {
    case 'text':
      return (
        <div className="space-y-2">
          <div className="block">
            <span className="label">{t('editor.blockFields.value')}</span>
            <div className="mt-1">
              <TextBlockEditor
                value={block.value}
                onChange={value => onPatch({ value })}
                maxLength={500}
                ariaLabel={t('editor.blockFields.value')}
                unavailableVariables={unavailableVariables}
              />
            </div>
            <p className="mt-1 text-xs text-secondary-500">
              {t('editor.blockFields.valueHelp')}
            </p>
          </div>
          <TemplateFunctionsCheatSheet />
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="label">{t('editor.blockFields.style')}</span>
              <select
                className="input mt-1"
                value={block.style ?? 'normal'}
                onChange={e =>
                  onPatch({
                    style: e.target.value as
                      | 'title'
                      | 'subtitle'
                      | 'normal'
                      | 'muted'
                      | 'monospace',
                  })
                }
              >
                <option value="normal">{t('editor.blockFields.styleNormal')}</option>
                <option value="title">{t('editor.blockFields.styleTitle')}</option>
                <option value="subtitle">{t('editor.blockFields.styleSubtitle')}</option>
                <option value="muted">{t('editor.blockFields.styleMuted')}</option>
                <option value="monospace">{t('editor.blockFields.styleMonospace')}</option>
              </select>
            </label>
            <label className="block">
              <span className="label">{t('editor.blockFields.align')}</span>
              <select
                className="input mt-1"
                value={block.align ?? 'left'}
                onChange={handleAlignChange}
              >
                <option value="left">{t('editor.blockFields.alignLeft')}</option>
                <option value="center">{t('editor.blockFields.alignCenter')}</option>
                <option value="right">{t('editor.blockFields.alignRight')}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={!!block.bold}
                onChange={e => onPatch({ bold: e.target.checked })}
              />
              {t('editor.blockFields.bold')}
            </label>
          </div>
        </div>
      );
    case 'logo':
      return (
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">{t('editor.blockFields.align')}</span>
            <select
              className="input mt-1"
              value={block.align ?? 'center'}
              onChange={handleAlignChange}
            >
              <option value="left">{t('editor.blockFields.alignLeft')}</option>
              <option value="center">{t('editor.blockFields.alignCenter')}</option>
              <option value="right">{t('editor.blockFields.alignRight')}</option>
            </select>
          </label>
          <label className="block">
            <span className="label">{t('editor.blockFields.maxHeightMm')}</span>
            <input
              className="input mt-1"
              type="number"
              min={5}
              max={50}
              value={block.maxHeightMm ?? 18}
              onChange={e =>
                onPatch({ maxHeightMm: Number(e.target.value) || undefined })
              }
            />
          </label>
        </div>
      );
    case 'itemsTable':
      return (
        <div className="space-y-2">
          {/*
            ENG-016 pass 1 (item #4) — bindings caption. Tells the
            operator where the row data comes from so they do not
            wonder why "items" isn't a plain text field. Pure UI + i18n.
          */}
          <div
            className="rounded border border-info/30 bg-info/10 p-2 text-xs text-secondary-700"
            data-testid="items-table-caption"
          >
            {t('editor.blockFields.itemsTableCaption')}
          </div>
          <span className="label">{t('editor.blockFields.columns')}</span>
          <p className="text-xs text-secondary-500">
            {t('editor.blockFields.columnsHelp')}
          </p>
          <div className="flex flex-wrap gap-2">
            {ITEMS_TABLE_COLUMNS.map(col => {
              const checked = block.columns.includes(col);
              return (
                <label
                  key={col}
                  className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      const nextColumns = e.target.checked
                        ? [...block.columns, col]
                        : block.columns.filter(c => c !== col);
                      if (nextColumns.length === 0) return; // keep at least 1
                      onPatch({ columns: nextColumns });
                    }}
                  />
                  {t(`editor.blockColumns.${col}`)}
                </label>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={block.showHeader ?? true}
              onChange={e => onPatch({ showHeader: e.target.checked })}
            />
            {t('editor.blockFields.showHeader')}
          </label>
        </div>
      );
    case 'totalsBlock':
      return (
        <div className="space-y-2">
          {/*
            ENG-016 pass 1 (item #4) — collapsible bindings explainer.
            Lists which sale fields each totals line resolves to.
          */}
          <TotalsBlockCaption />
          <span className="label">{t('editor.blockFields.totalsLines')}</span>
          <p className="text-xs text-secondary-500">
            {t('editor.blockFields.totalsLinesHelp')}
          </p>
          <div className="flex flex-wrap gap-2">
            {TOTALS_LINES.map(line => {
              const checked = block.show.includes(line);
              return (
                <label
                  key={line}
                  className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => {
                      const nextShow = e.target.checked
                        ? [...block.show, line]
                        : block.show.filter(c => c !== line);
                      if (nextShow.length === 0) return;
                      onPatch({ show: nextShow });
                    }}
                  />
                  {t(`editor.totalsLines.${line}`)}
                </label>
              );
            })}
          </div>
        </div>
      );
    case 'tendersTable':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={block.showChange ?? true}
            onChange={e => onPatch({ showChange: e.target.checked })}
          />
          {t('editor.blockFields.showChange')}
        </label>
      );
    case 'qr':
      return (
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block">
            <span className="label">{t('editor.blockFields.source')}</span>
            <input
              className="input mt-1"
              value={block.source}
              maxLength={200}
              onChange={e => onPatch({ source: e.target.value })}
            />
            <p className="mt-1 text-xs text-secondary-500">
              {t('editor.blockFields.valueHelp')}
            </p>
          </label>
          <label className="block">
            <span className="label">{t('editor.blockFields.sizeMm')}</span>
            <input
              className="input mt-1"
              type="number"
              min={10}
              max={60}
              value={block.sizeMm ?? 25}
              onChange={e =>
                onPatch({ sizeMm: Number(e.target.value) || undefined })
              }
            />
          </label>
        </div>
      );
    case 'separator':
      return (
        <label className="block">
          <span className="label">{t('editor.blockFields.char')}</span>
          <input
            className="input mt-1"
            value={block.char ?? '-'}
            maxLength={4}
            onChange={e => onPatch({ char: e.target.value || '-' })}
          />
        </label>
      );
    case 'barcode128':
      return (
        <div className="grid grid-cols-2 gap-2">
          <label className="col-span-2 block">
            <span className="label">{t('editor.blockFields.source')}</span>
            <input
              className="input mt-1"
              value={block.source}
              maxLength={200}
              onChange={e => onPatch({ source: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="label">{t('editor.blockFields.heightMm')}</span>
            <input
              className="input mt-1"
              type="number"
              min={8}
              max={40}
              value={block.heightMm ?? 12}
              onChange={e =>
                onPatch({ heightMm: Number(e.target.value) || undefined })
              }
            />
          </label>
        </div>
      );
    case 'appFooter':
      return (
        // ENG-016 pass 1 (item #5) — single toggle + align. Metadata
        // (name, version, URL, support) is rendered from stable
        // constants by the server so there is nothing else to edit here.
        <div className="space-y-2">
          <p className="text-xs text-secondary-500">
            {t('editor.blockFields.appFooterHelp')}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={block.show ?? true}
              onChange={e => onPatch({ show: e.target.checked })}
              data-testid="app-footer-show-toggle"
            />
            {t('editor.blockFields.appFooterShow')}
          </label>
          <label className="block">
            <span className="label">{t('editor.blockFields.align')}</span>
            <select
              className="input mt-1"
              value={block.align ?? 'center'}
              onChange={handleAlignChange}
            >
              <option value="left">{t('editor.blockFields.alignLeft')}</option>
              <option value="center">{t('editor.blockFields.alignCenter')}</option>
              <option value="right">{t('editor.blockFields.alignRight')}</option>
            </select>
          </label>
        </div>
      );
    case 'wordmark':
      // ENG-086 — single visibility toggle + align. The wordmark itself
      // is brand identity, rendered by the server from stable
      // constants, so there is nothing else to edit here.
      return (
        <div className="space-y-2">
          <p className="text-xs text-secondary-500">
            {t('editor.blockFields.wordmarkHelp')}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={block.show ?? true}
              onChange={e => onPatch({ show: e.target.checked })}
              data-testid="wordmark-show-toggle"
            />
            {t('editor.blockFields.wordmarkShow')}
          </label>
          <label className="block">
            <span className="label">{t('editor.blockFields.align')}</span>
            <select
              className="input mt-1"
              value={block.align ?? 'center'}
              onChange={handleAlignChange}
            >
              <option value="left">{t('editor.blockFields.alignLeft')}</option>
              <option value="center">{t('editor.blockFields.alignCenter')}</option>
              <option value="right">{t('editor.blockFields.alignRight')}</option>
            </select>
          </label>
        </div>
      );
    case 'metaTable': {
      // ENG-086 — rows editor for the 2-column key/value band. Key is
      // a static label; value accepts the same `{{...}}` expressions as
      // a text block. The Zod schema caps the array at 12 rows.
      const MAX_META_ROWS = 12;
      const rows = block.rows;
      return (
        <div className="space-y-2">
          <p className="text-xs text-secondary-500">
            {t('editor.blockFields.metaTableHelp')}
          </p>
          <ul className="space-y-2" data-testid="meta-table-rows">
            {rows.map((row, rowIndex) => (
              // The row has no persisted id, and its label is edited
              // in-place. Keep the React key independent from the typed
              // value so focus survives each keystroke.
              <li
                key={`meta-row-${rowIndex}`}
                className="grid grid-cols-[1fr_2fr_auto] gap-2 rounded border border-line p-2"
              >
                <label className="block">
                  <span className="label text-xs">
                    {t('editor.blockFields.metaTableKey')}
                  </span>
                  <input
                    className="input mt-1"
                    value={row.key}
                    maxLength={50}
                    onChange={e => {
                      const next = rows.slice();
                      next[rowIndex] = { ...row, key: e.target.value };
                      onPatch({ rows: next });
                    }}
                  />
                </label>
                <label className="block">
                  <span className="label text-xs">
                    {t('editor.blockFields.metaTableValue')}
                  </span>
                  <input
                    className="input mt-1"
                    value={row.value}
                    maxLength={200}
                    onChange={e => {
                      const next = rows.slice();
                      next[rowIndex] = { ...row, value: e.target.value };
                      onPatch({ rows: next });
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-icon self-end"
                  aria-label={t('editor.blockFields.metaTableRemoveRow')}
                  disabled={rows.length <= 1}
                  onClick={() => {
                    if (rows.length <= 1) return;
                    onPatch({ rows: rows.filter((_, i) => i !== rowIndex) });
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            disabled={rows.length >= MAX_META_ROWS}
            onClick={() =>
              onPatch({
                rows: [
                  ...rows,
                  {
                    key: t('editor.defaults.metaKey'),
                    value: t('editor.defaults.metaValue'),
                  },
                ],
              })
            }
            data-testid="meta-table-add-row"
          >
            {t('editor.blockFields.metaTableAddRow')}
          </button>
        </div>
      );
    }
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return null;
    }
  }
}
