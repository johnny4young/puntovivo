import { GripVertical, Plus } from 'lucide-react';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { EditorReceiptLayout } from './defaultLayouts';
import { ReceiptTemplatePreview } from './ReceiptTemplatePreview';
import { BlockForm } from './BlockForm';
import { SortableBlockRow } from './SortableBlockRow';
import { BLOCK_KINDS, PAPER_WIDTHS } from './receiptEditor.constants';
import {
  useReceiptLayoutEditor,
  type ReceiptTemplateInitial,
} from './useReceiptLayoutEditor';

export interface ReceiptTemplateEditorProps {
  /** When set, edits the existing template; when null, creates a new one. */
  initial: ReceiptTemplateInitial | null;
  onClose: () => void;
}

export function ReceiptTemplateEditor({
  initial,
  onClose,
}: ReceiptTemplateEditorProps) {
  const {
    t,
    name,
    setName,
    kind,
    handleKindChange,
    layout,
    setPaperWidth,
    blockKeys,
    activeBlockIndex,
    setActiveBlockIndex,
    addBlock,
    removeBlock,
    moveBlock,
    patchBlock,
    availability,
    sensors,
    dndAccessibility,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
    draggingKey,
    draggingIndex,
    blockListRef,
    isPending,
    handleSave,
  } = useReceiptLayoutEditor({ initial, onClose });

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
