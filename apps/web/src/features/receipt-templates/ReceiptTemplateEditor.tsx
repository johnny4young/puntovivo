import { useState } from 'react';
import { ChevronDown, GripVertical, Plus, SlidersHorizontal } from 'lucide-react';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ReceiptTemplatePreview } from './ReceiptTemplatePreview';
import { ReceiptTemplateBasics } from './ReceiptTemplateBasics';
import { BlockForm } from './BlockForm';
import { SortableBlockRow } from './SortableBlockRow';
import { BLOCK_KINDS } from './receiptEditor.constants';
import { useReceiptLayoutEditor, type ReceiptTemplateInitial } from './useReceiptLayoutEditor';

export interface ReceiptTemplateEditorProps {
  /** When set, edits the existing template; when null, creates a new one. */
  initial: ReceiptTemplateInitial | null;
  onClose: () => void;
}

export function ReceiptTemplateEditor({ initial, onClose }: ReceiptTemplateEditorProps) {
  const [isStructureEditorOpen, setIsStructureEditorOpen] = useState(false);
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
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="space-y-6">
          <ReceiptTemplateBasics
            isEditing={!!initial}
            kind={kind}
            name={name}
            paperWidth={layout.paperWidth}
            onKindChange={handleKindChange}
            onNameChange={setName}
            onPaperWidthChange={setPaperWidth}
          />

          <section className="card overflow-hidden" aria-labelledby="receipt-structure-title">
            <div className="flex flex-col gap-4 p-6">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                    initial
                      ? 'bg-secondary-100 text-secondary-700'
                      : 'bg-success-50 text-success-700'
                  }`}
                >
                  <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p
                    className={`text-[0.66rem] font-bold uppercase tracking-[0.17em] ${
                      initial ? 'text-secondary-500' : 'text-success-700'
                    }`}
                  >
                    {t(
                      initial
                        ? 'editor.structureSummary.existingEyebrow'
                        : 'editor.structureSummary.presetEyebrow'
                    )}
                  </p>
                  <h2
                    id="receipt-structure-title"
                    className="mt-1 text-lg font-semibold text-secondary-950"
                  >
                    {t(
                      initial
                        ? 'editor.structureSummary.existingTitle'
                        : 'editor.structureSummary.presetTitle'
                    )}
                  </h2>
                  <p className="mt-1 max-w-[58ch] text-sm leading-5 text-secondary-600">
                    {t(
                      initial
                        ? 'editor.structureSummary.existingDescription'
                        : 'editor.structureSummary.presetDescription',
                      {
                        count: layout.blocks.length,
                      }
                    )}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn-outline self-start"
                aria-expanded={isStructureEditorOpen}
                aria-controls="receipt-structure-editor"
                onClick={() => setIsStructureEditorOpen(open => !open)}
              >
                {isStructureEditorOpen
                  ? t('editor.structureSummary.hideAction')
                  : t('editor.structureSummary.openAction')}
                <ChevronDown
                  className={`ml-2 h-4 w-4 transition-transform ${
                    isStructureEditorOpen ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>

            {isStructureEditorOpen ? (
              <div
                id="receipt-structure-editor"
                className="space-y-4 border-t border-line bg-surface-2/45 p-6"
              >
                <div>
                  <h3 className="text-lg font-semibold text-secondary-900">
                    {t('editor.blocksPanel.title')}
                  </h3>
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
                   pass 2 (item #1) — drag-and-drop reorder. <DndContext>
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
                  <SortableContext items={blockKeys} strategy={verticalListSortingStrategy}>
                    <ul ref={blockListRef} className="space-y-2" data-testid="block-list">
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
                            {t(`editor.blockTypes.${layout.blocks[draggingIndex]?.type ?? 'text'}`)}
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>
            ) : null}
          </section>
        </div>

        <div className="card space-y-3 self-start p-6 xl:sticky xl:top-24">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('editor.previewPanel.title')}
            </h2>
            <p className="text-sm text-secondary-500">{t('editor.previewPanel.description')}</p>
          </div>
          <ReceiptTemplatePreview layout={layout} kind={kind} />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={onClose} disabled={isPending}>
          {t('actions.cancel')}
        </button>
        <button type="button" className="btn-primary" onClick={handleSave} disabled={isPending}>
          {t('actions.save')}
        </button>
      </div>
    </div>
  );
}
