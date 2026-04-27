import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DndContextProps,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useToast } from '@/components/feedback/ToastProvider';
import { captureFlipSnapshot, playFlip, type FlipSnapshot } from '@/lib/flipAnimate';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import {
  createEmptyBlock,
  getDefaultLayout,
  type EditorReceiptBlock,
  type EditorReceiptLayout,
  type ReceiptBlockKind,
} from './defaultLayouts';
import { ReceiptTemplatePreview } from './ReceiptTemplatePreview';
import { TextBlockEditor } from './TextBlockEditor';
import { useVariableAvailability } from './templateAvailability';
import type { AvailabilityMap } from './templateUnavailableDecorations';

export interface ReceiptTemplateEditorProps {
  /** When set, edits the existing template; when null, creates a new one. */
  initial:
    | null
    | {
        id: string;
        name: string;
        kind: 'sale' | 'quotation' | 'fiscal_dee';
        layout: EditorReceiptLayout;
        isDefault: boolean;
        isActive: boolean;
      };
  onClose: () => void;
}

const BLOCK_KINDS: ReceiptBlockKind[] = [
  'logo',
  'text',
  'itemsTable',
  'totalsBlock',
  'tendersTable',
  'qr',
  'separator',
  'barcode128',
  // ENG-016 pass 1 (item #5) — Puntovivo-branded footer.
  'appFooter',
];

const PAPER_WIDTHS: EditorReceiptLayout['paperWidth'][] = [
  '58mm',
  '80mm',
  'letter',
  'a4',
];

const ITEMS_TABLE_COLUMNS = [
  'name',
  'qty',
  'unitPrice',
  'taxPercent',
  'discount',
  'total',
] as const;

const TOTALS_LINES = [
  'subtotal',
  'discount',
  'taxTotal',
  'tip',
  'grandTotal',
] as const;

export function ReceiptTemplateEditor({
  initial,
  onClose,
}: ReceiptTemplateEditorProps) {
  const { t } = useTranslation(['receiptTemplates', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { availability } = useVariableAvailability();

  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<'sale' | 'quotation' | 'fiscal_dee'>(
    initial?.kind ?? 'sale'
  );
  const initialLayout = initial?.layout ?? getDefaultLayout('sale', t);
  const [layout, setLayout] = useState<EditorReceiptLayout>(initialLayout);

  // Stable per-block React keys. We cannot key on array index because
  // moveBlock / removeBlock would make React reuse the wrong DOM
  // subtree (open edit forms would "follow" the index instead of the
  // block, with focus and uncontrolled state flickering). Each new
  // block gets a fresh id from a counter; ids are kept in lockstep
  // with `layout.blocks` and persisted only in editor memory (the
  // server stores the layout without ids).
  //
  // The counter starts at `initialLayout.blocks.length` so the
  // pre-generated keys for the initial blocks (`init-0`, `init-1`,
  // ...) never collide with the `b-N` ids minted by `allocateBlockId`
  // for blocks added later. The ref is only mutated inside event
  // handlers (addBlock, handleKindChange) so the
  // "no-refs-during-render" lint rule stays satisfied.
  const nextBlockIdRef = useRef(initialLayout.blocks.length);
  const allocateBlockId = () => {
    nextBlockIdRef.current += 1;
    return `b-${nextBlockIdRef.current}`;
  };
  const [blockKeys, setBlockKeys] = useState<string[]>(() =>
    initialLayout.blocks.map((_, i) => `init-${i}`)
  );
  const [activeBlockIndex, setActiveBlockIndex] = useState<number | null>(
    initialLayout.blocks.length > 0 ? 0 : null
  );

  // ENG-016 pass 1 (item #6) — FLIP reorder animation. `moveBlock`
  // captures a snapshot of the block-list card positions into
  // `pendingFlipRef` before React commits the new array; the
  // `useLayoutEffect` below plays the inverse transform once the
  // commit lands so the user can follow each block to its new position.
  // Under `prefers-reduced-motion: reduce` the helper returns `[]`
  // without scheduling animations, matching the original instant UX.
  const blockListRef = useRef<HTMLUListElement | null>(null);
  const pendingFlipRef = useRef<FlipSnapshot | null>(null);
  useLayoutEffect(() => {
    const snapshot = pendingFlipRef.current;
    if (!snapshot || !blockListRef.current) return;
    pendingFlipRef.current = null;
    playFlip(blockListRef.current, '[data-flip-key]', snapshot);
  }, [blockKeys]);

  function patchBlock(index: number, patch: Partial<EditorReceiptBlock>) {
    setLayout(prev => {
      const blocks = prev.blocks.slice();
      const current = blocks[index];
      if (!current) return prev;
      // Type assertion: the patch must come from a per-type form so the
      // discriminated union narrowing carries through at the callsite.
      blocks[index] = { ...current, ...patch } as EditorReceiptBlock;
      return { ...prev, blocks };
    });
  }

  function addBlock(blockKind: ReceiptBlockKind) {
    let appendedIndex: number | null = null;
    setLayout(prev => {
      if (prev.blocks.length >= 50) return prev;
      appendedIndex = prev.blocks.length;
      return { ...prev, blocks: [...prev.blocks, createEmptyBlock(blockKind, t)] };
    });
    if (appendedIndex !== null) {
      const newKey = allocateBlockId();
      setBlockKeys(prev => [...prev, newKey]);
      setActiveBlockIndex(appendedIndex);
    }
  }

  function removeBlock(index: number) {
    setLayout(prev => ({
      ...prev,
      blocks: prev.blocks.filter((_, i) => i !== index),
    }));
    setBlockKeys(prev => prev.filter((_, i) => i !== index));
    setActiveBlockIndex(null);
  }

  function moveBlock(index: number, direction: -1 | 1) {
    // ENG-016 pass 1 (item #6) — snapshot the DOM positions BEFORE
    // React reorders the block cards so the post-commit FLIP helper
    // can compute the inverse transform per card. Safe to call even
    // when `blockListRef` is null (first render, tests without a DOM)
    // — `captureFlipSnapshot` short-circuits on null.
    pendingFlipRef.current = captureFlipSnapshot(
      blockListRef.current,
      '[data-flip-key]'
    );
    setLayout(prev => {
      const next = prev.blocks.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[index]!;
      next[index] = next[target]!;
      next[target] = tmp;
      return { ...prev, blocks: next };
    });
    setBlockKeys(prev => {
      const next = prev.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const tmp = next[index]!;
      next[index] = next[target]!;
      next[target] = tmp;
      return next;
    });
    setActiveBlockIndex(index + direction);
  }

  // ENG-016 pass 2 (item #1) — drag-and-drop reorder via @dnd-kit/sortable.
  // The pointer + keyboard sensors emit `onDragEnd` with the dragged block's
  // key + the destination key; this helper translates those keys into the
  // existing index-based mutation and reuses the FLIP machinery so the post-
  // drop landing transition matches the keyboard-button path. Out-of-range
  // moves and "drop on self" no-op for free.
  function moveBlockTo(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= layout.blocks.length || toIndex >= layout.blocks.length) {
      return;
    }
    pendingFlipRef.current = captureFlipSnapshot(
      blockListRef.current,
      '[data-flip-key]'
    );
    setLayout(prev => {
      const next = prev.blocks.slice();
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      next.splice(toIndex, 0, moved);
      return { ...prev, blocks: next };
    });
    setBlockKeys(prev => {
      const next = prev.slice();
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev;
      next.splice(toIndex, 0, moved);
      return next;
    });
    setActiveBlockIndex(toIndex);
  }

  // ENG-016 pass 2 (item #1) — dnd-kit sensors. Pointer activation distance
  // (4px) ensures simple clicks on the grip do not start a drag; keyboard
  // sensor wires the standard sortable coordinate getter so arrow keys move
  // the picked-up block one slot per press.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const draggingIndex = useMemo(
    () => (draggingKey ? blockKeys.indexOf(draggingKey) : -1),
    [draggingKey, blockKeys]
  );
  const dndAccessibility = useMemo<NonNullable<DndContextProps['accessibility']>>(() => {
    const getBlockAnnouncementLabel = (id: UniqueIdentifier) => {
      const blockKey = String(id);
      const index = blockKeys.indexOf(blockKey);
      const block = index >= 0 ? layout.blocks[index] : undefined;
      if (!block) return blockKey;

      return t('editor.dragAndDrop.blockAnnouncementLabel', {
        index: index + 1,
        type: t(`editor.blockTypes.${block.type}`),
      });
    };

    return {
      screenReaderInstructions: {
        draggable: t('editor.dragAndDrop.screenReaderInstructions'),
      },
      announcements: {
        onDragStart({ active }) {
          return t('editor.dragAndDrop.announcements.dragStart', {
            active: getBlockAnnouncementLabel(active.id),
          });
        },
        onDragOver({ active, over }) {
          const activeLabel = getBlockAnnouncementLabel(active.id);
          if (!over) {
            return t('editor.dragAndDrop.announcements.dragOverNone', {
              active: activeLabel,
            });
          }
          return t('editor.dragAndDrop.announcements.dragOver', {
            active: activeLabel,
            over: getBlockAnnouncementLabel(over.id),
          });
        },
        onDragEnd({ active, over }) {
          const activeLabel = getBlockAnnouncementLabel(active.id);
          if (!over) {
            return t('editor.dragAndDrop.announcements.dragEndNone', {
              active: activeLabel,
            });
          }
          return t('editor.dragAndDrop.announcements.dragEnd', {
            active: activeLabel,
            over: getBlockAnnouncementLabel(over.id),
          });
        },
        onDragCancel({ active }) {
          return t('editor.dragAndDrop.announcements.dragCancel', {
            active: getBlockAnnouncementLabel(active.id),
          });
        },
      },
    };
  }, [blockKeys, layout.blocks, t]);

  function handleDragStart(event: DragStartEvent) {
    setDraggingKey(String(event.active.id));
  }
  function handleDragEnd(event: DragEndEvent) {
    setDraggingKey(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = blockKeys.indexOf(String(active.id));
    const toIndex = blockKeys.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    moveBlockTo(fromIndex, toIndex);
  }
  function handleDragCancel() {
    setDraggingKey(null);
  }

  function setPaperWidth(width: EditorReceiptLayout['paperWidth']) {
    setLayout(prev => ({ ...prev, paperWidth: width }));
  }

  function handleKindChange(nextKind: 'sale' | 'quotation' | 'fiscal_dee') {
    setKind(nextKind);
    if (!initial) {
      // For brand-new templates, swap to the canonical preset for the
      // newly-selected kind. Editing an existing template never replaces
      // its layout from a kind change because the operator may have a
      // valid reason to pick a non-default starting point.
      const presetLayout = getDefaultLayout(nextKind, t);
      setLayout(presetLayout);
      setBlockKeys(presetLayout.blocks.map(() => allocateBlockId()));
      setActiveBlockIndex(presetLayout.blocks.length > 0 ? 0 : null);
    }
  }

  const createMutation = trpc.receiptTemplates.create.useMutation({
    onSuccess: async () => {
      await utils.receiptTemplates.list.invalidate();
      toast.success({ title: t('toast.createSuccess') });
      onClose();
    },
    onError: error => {
      toast.error({
        title: t('toast.createError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const updateMutation = trpc.receiptTemplates.update.useMutation({
    onSuccess: async () => {
      await utils.receiptTemplates.list.invalidate();
      await utils.receiptTemplates.getById.invalidate();
      toast.success({ title: t('toast.updateSuccess') });
      onClose();
    },
    onError: error => {
      toast.error({
        title: t('toast.updateError'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSave() {
    // Guard against double-submit even when the disabled attribute has
    // not yet propagated to the DOM (rapid double click before React
    // re-renders, programmatic submit, etc.).
    if (isPending) return;
    if (layout.blocks.length === 0) {
      toast.error({ title: t('errors.atLeastOneBlock') });
      return;
    }
    if (!name.trim()) {
      toast.error({ title: t('errors:server.RECEIPT_TEMPLATE_NAME_REQUIRED') });
      return;
    }
    if (initial) {
      updateMutation.mutate({
        id: initial.id,
        name: name.trim(),
        layout,
      });
    } else {
      createMutation.mutate({
        kind,
        name: name.trim(),
        layout,
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="block">
            <span className="label">{t('editor.fields.name')}</span>
            <input
              className="input mt-1"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('editor.fields.namePlaceholder')}
              maxLength={100}
            />
          </label>
          <label className="block">
            <span className="label">{t('editor.fields.kind')}</span>
            <select
              className="input mt-1"
              value={kind}
              onChange={e => handleKindChange(e.target.value as typeof kind)}
              disabled={!!initial}
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
              value={layout.paperWidth}
              onChange={e => setPaperWidth(e.target.value as EditorReceiptLayout['paperWidth'])}
            >
              {PAPER_WIDTHS.map(width => (
                <option key={width} value={width}>
                  {t(`paperWidths.${width}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card space-y-3 p-6">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('editor.blocksPanel.title')}
            </h2>
            <p className="text-sm text-secondary-500">
              {t('editor.blocksPanel.description')}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {BLOCK_KINDS.map(blockKind => (
              <button
                key={blockKind}
                type="button"
                className="btn-outline btn-sm"
                onClick={() => addBlock(blockKind)}
                disabled={layout.blocks.length >= 50}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t(`editor.blockTypes.${blockKind}`)}
              </button>
            ))}
          </div>

          {/*
            ENG-016 pass 2 (item #1) — drag-and-drop reorder. <DndContext>
            owns the pointer/keyboard sensors; <SortableContext> exposes the
            ordered block-key list to its descendants. The block list itself
            stays as the same <ul> structure so pass-1's FLIP attribute
            (data-flip-key) and the keyboard ↑/↓ buttons keep working
            unchanged. Drag activation is gated to the grip icon only —
            see SortableBlockRow.
          */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            accessibility={dndAccessibility}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={blockKeys}
              strategy={verticalListSortingStrategy}
            >
              <ul
                ref={blockListRef}
                className="space-y-2"
                data-testid="block-list"
              >
                {layout.blocks.length === 0 ? (
                  <li className="rounded border border-dashed border-line p-4 text-center text-sm text-secondary-500">
                    {t('editor.blocksPanel.empty')}
                  </li>
                ) : (
                  layout.blocks.map((block, index) => {
                    const blockKey = blockKeys[index] ?? `idx-${index}`;
                    return (
                      <SortableBlockRow
                        key={blockKey}
                        blockKey={blockKey}
                        index={index}
                        active={activeBlockIndex === index}
                        isLast={index === layout.blocks.length - 1}
                        gripLabel={t('editor.dragAndDrop.gripAriaLabel')}
                        moveUpLabel={t('actions.moveUp')}
                        moveDownLabel={t('actions.moveDown')}
                        removeLabel={t('actions.removeBlock')}
                        title={
                          <>
                            {index + 1}. {t(`editor.blockTypes.${block.type}`)}
                          </>
                        }
                        expandedForm={
                          activeBlockIndex === index ? (
                            <div className="mt-3 space-y-2 border-t border-line pt-3">
                              <BlockForm
                                block={block}
                                onPatch={patch => patchBlock(index, patch)}
                                unavailableVariables={availability}
                              />
                            </div>
                          ) : undefined
                        }
                        onSelect={() =>
                          setActiveBlockIndex(activeBlockIndex === index ? null : index)
                        }
                        onMoveUp={() => moveBlock(index, -1)}
                        onMoveDown={() => moveBlock(index, 1)}
                        onRemove={() => removeBlock(index)}
                      />
                    );
                  })
                )}
              </ul>
            </SortableContext>
            <DragOverlay>
              {draggingKey && draggingIndex >= 0 ? (
                <div
                  className="rounded border border-primary bg-primary/10 p-2 shadow-md"
                  data-testid="drag-overlay"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-secondary-900">
                    <GripVertical className="h-4 w-4 text-secondary-500" />
                    <span>
                      {draggingIndex + 1}.{' '}
                      {t(
                        `editor.blockTypes.${layout.blocks[draggingIndex]?.type ?? 'text'}`
                      )}
                    </span>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>

        <div className="card space-y-3 p-6">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('editor.previewPanel.title')}
            </h2>
            <p className="text-sm text-secondary-500">
              {t('editor.previewPanel.description')}
            </p>
          </div>
          <ReceiptTemplatePreview layout={layout} kind={kind} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn-outline"
          onClick={onClose}
          disabled={isPending}
        >
          {t('actions.cancel')}
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={isPending}
        >
          {t('actions.save')}
        </button>
      </div>
    </div>
  );
}

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
function BlockForm({ block, onPatch, unavailableVariables }: BlockFormProps) {
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
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * ENG-016 pass 2 (item #1) — sortable wrapper around an existing block
 * card. Owns the `useSortable` hook so the parent component does not
 * have to thread the dnd-kit transforms through. Critical contract:
 *
 *  - `data-flip-key` MUST stay on the outer `<li>` so pass-1's FLIP
 *    helper continues to animate the keyboard `↑/↓` reorder path.
 *  - The drag listeners attach to the grip icon ONLY; the row title,
 *    the `↑/↓` buttons, and the trash button stay clickable without
 *    starting a drag.
 *  - `transform` + `transition` from `useSortable` are applied to the
 *    `<li>` so the dragged item visually follows the pointer until
 *    drop (the `<DragOverlay>` portal in the parent renders the
 *    floating clone).
 */
interface SortableBlockRowProps {
  blockKey: string;
  index: number;
  active: boolean;
  isLast: boolean;
  gripLabel: string;
  moveUpLabel: string;
  moveDownLabel: string;
  removeLabel: string;
  title: ReactNode;
  expandedForm?: ReactNode;
  onSelect: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

function SortableBlockRow({
  blockKey,
  index,
  active,
  isLast,
  gripLabel,
  moveUpLabel,
  moveDownLabel,
  removeLabel,
  title,
  expandedForm,
  onSelect,
  onMoveUp,
  onMoveDown,
  onRemove,
}: SortableBlockRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: blockKey });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      data-flip-key={blockKey}
      style={style}
      className={`rounded border p-2 transition ${
        active ? 'border-primary bg-primary/5' : 'border-line bg-surface'
      }`}
      data-testid={`block-row-${index}`}
    >
      <div className="flex items-center justify-between gap-2">
        {/*
          Grip handle is the SOLE drag activator. `setActivatorNodeRef`
          + `attributes` + `listeners` are spread here so pointer drag
          and keyboard sortable activation only fire from this element.
          The row title, `↑/↓` buttons, and trash button stay clickable.
        */}
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="btn-icon btn-ghost cursor-grab text-secondary-500"
          aria-label={gripLabel}
          data-testid="block-grip"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex-1 text-left text-sm font-medium text-secondary-900"
          onClick={onSelect}
        >
          {title}
        </button>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            className="btn-icon btn-ghost"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label={moveUpLabel}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-icon btn-ghost"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label={moveDownLabel}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-icon btn-ghost text-error"
            onClick={onRemove}
            aria-label={removeLabel}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expandedForm}
    </li>
  );
}

/**
 * ENG-016 pass 1 (item #4) — collapsible explainer shown above the
 * `totalsBlock` controls. Pulls each line's source from i18n so the
 * caption stays in sync with whatever the renderer shows.
 */
function TotalsBlockCaption() {
  const { t } = useTranslation('receiptTemplates');
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded border border-info/30 bg-info/10 p-2 text-xs text-secondary-700"
      data-testid="totals-block-caption"
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left font-medium"
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {t('editor.blockFields.totalsBlockCaption')}
      </button>
      {open ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t('editor.blockFields.totalsBlockBindings.subtotal')}</li>
          <li>{t('editor.blockFields.totalsBlockBindings.discount')}</li>
          <li>{t('editor.blockFields.totalsBlockBindings.taxTotal')}</li>
          <li>{t('editor.blockFields.totalsBlockBindings.tip')}</li>
          <li>{t('editor.blockFields.totalsBlockBindings.grandTotal')}</li>
        </ul>
      ) : null}
    </div>
  );
}

/**
 * ENG-016 pass 3 (item #3) — collapsible reference of every whitelisted
 * template function. Signatures + canonical examples live in code so
 * they stay in lockstep with the server function registry; only the
 * one-line description per function is translated. Items #2 (rich
 * autocomplete) and #7 (in-preview error markers) replace this static
 * panel with an integrated tooltip, but until then operators can scan
 * this list to learn the syntax without leaving the editor.
 */
const TEMPLATE_FUNCTION_REFERENCE: ReadonlyArray<{
  name:
    | 'currency'
    | 'date'
    | 'upper'
    | 'lower'
    | 'round'
    | 'limit'
    | 'concat'
    | 'default'
    | 'abs'
    | 'max'
    | 'min'
    | 'sum';
  signature: string;
  example: string;
}> = [
  { name: 'currency', signature: 'currency(value, decimals?)', example: '{{ currency(sale.grandTotal) }}' },
  { name: 'date', signature: 'date(value, pattern?)', example: "{{ date(sale.createdAt, 'dd/MM/yyyy') }}" },
  { name: 'upper', signature: 'upper(value)', example: '{{ upper(company.name) }}' },
  { name: 'lower', signature: 'lower(value)', example: '{{ lower(sale.cashier) }}' },
  { name: 'round', signature: 'round(value, decimals?)', example: '{{ round(sale.grandTotal, 2) }}' },
  { name: 'limit', signature: 'limit(value, n)', example: '{{ limit(sale.notes, 30) }}' },
  { name: 'concat', signature: 'concat(a, b, …)', example: "{{ concat('Caja: ', sale.cashier) }}" },
  { name: 'default', signature: 'default(value, fallback)', example: "{{ default(fiscal.cufe, 'Sin CUFE') }}" },
  { name: 'abs', signature: 'abs(value)', example: '{{ abs(sale.discount) }}' },
  { name: 'max', signature: 'max(a, b, …)', example: '{{ max(sale.grandTotal, 0) }}' },
  { name: 'min', signature: 'min(a, b, …)', example: '{{ min(sale.discount, 100) }}' },
  { name: 'sum', signature: 'sum(a, b, …)', example: '{{ sum(sale.subtotal, sale.taxTotal) }}' },
];

function TemplateFunctionsCheatSheet() {
  const { t } = useTranslation('receiptTemplates');
  return (
    <details
      className="rounded border border-secondary-200 bg-secondary-50 px-3 py-2 text-xs text-secondary-700"
      data-testid="template-functions-cheatsheet"
    >
      <summary className="cursor-pointer font-medium">
        {t('editor.functionsHelp.title')}
      </summary>
      <p className="mt-2 text-secondary-600">
        {t('editor.functionsHelp.intro')}
      </p>
      <ul className="mt-2 space-y-2">
        {TEMPLATE_FUNCTION_REFERENCE.map(fn => (
          <li key={fn.name} className="space-y-0.5">
            <code className="block text-[0.7rem] font-medium text-secondary-900">
              {fn.signature}
            </code>
            <span className="block text-secondary-600">
              {t(`editor.functionsHelp.entries.${fn.name}`)}
            </span>
            <code className="block text-[0.7rem] text-primary-700">
              {fn.example}
            </code>
          </li>
        ))}
      </ul>
    </details>
  );
}
