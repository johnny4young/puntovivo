import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DndContextProps,
  type DragEndEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useToast } from '@/components/feedback/ToastProvider';
import { captureFlipSnapshot, playFlip, type FlipSnapshot } from '@/lib/flipAnimate';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import {
  createEmptyBlock,
  getDefaultLayout,
  type EditorReceiptBlock,
  type EditorReceiptLayout,
  type ReceiptBlockKind,
} from './defaultLayouts';
import { useVariableAvailability } from './templateAvailability';

/**
 * The persisted template an editor session edits. `null` means "create a
 * new template"; a value means "edit the existing one" (the server stores
 * the layout without the editor's in-memory block ids).
 */
export interface ReceiptTemplateInitial {
  id: string;
  name: string;
  kind: 'sale' | 'quotation' | 'fiscal_dee';
  layout: EditorReceiptLayout;
  isDefault: boolean;
  isActive: boolean;
}

/** Params for {@link useReceiptLayoutEditor}. */
export interface UseReceiptLayoutEditorParams {
  initial: ReceiptTemplateInitial | null;
  onClose: () => void;
}

/**
 * Owns all editor state + mutations for ReceiptTemplateEditor: the
 * name/kind/layout fields, the block-keys + active-block selection, the
 * add/remove/move/patch block operations (with the FLIP reorder snapshot
 * + the dnd-kit sensors/accessibility/handlers), and the create/update
 * save path. The component shell consumes the returned bundle and renders
 * it; this hook holds no JSX. Kept on `useState` (not `useReducer`) so the
 * relocation from the inline component is behavior-preserving.
 */
export function useReceiptLayoutEditor({ initial, onClose }: UseReceiptLayoutEditorParams) {
  const { t } = useTranslation(['receiptTemplates', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { availability } = useVariableAvailability();

  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<'sale' | 'quotation' | 'fiscal_dee'>(initial?.kind ?? 'sale');
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

  // pass 1 (item #6) — FLIP reorder animation. `moveBlock`
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
    const appendedIndex = layout.blocks.length;
    if (appendedIndex >= 50) return;
    const newKey = allocateBlockId();
    setLayout(prev => {
      if (prev.blocks.length >= 50) return prev;
      return { ...prev, blocks: [...prev.blocks, createEmptyBlock(blockKind, t)] };
    });
    setBlockKeys(prev => [...prev, newKey]);
    setActiveBlockIndex(appendedIndex);
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
    // pass 1 (item #6) — snapshot the DOM positions BEFORE
    // React reorders the block cards so the post-commit FLIP helper
    // can compute the inverse transform per card. Safe to call even
    // when `blockListRef` is null (first render, tests without a DOM)
    // `captureFlipSnapshot` short-circuits on null.
    pendingFlipRef.current = captureFlipSnapshot(blockListRef.current, '[data-flip-key]');
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

  // pass 2 (item #1) — drag-and-drop reorder via @dnd-kit/sortable.
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
    pendingFlipRef.current = captureFlipSnapshot(blockListRef.current, '[data-flip-key]');
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

  // pass 2 (item #1) — dnd-kit sensors. Pointer activation distance
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
    onError: onErrorToast(toast, t, { titleKey: 'receiptTemplates:toast.createError' }),
  });

  const updateMutation = trpc.receiptTemplates.update.useMutation({
    onSuccess: async () => {
      await utils.receiptTemplates.list.invalidate();
      await utils.receiptTemplates.getById.invalidate();
      toast.success({ title: t('toast.updateSuccess') });
      onClose();
    },
    onError: onErrorToast(toast, t, { titleKey: 'receiptTemplates:toast.updateError' }),
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

  return {
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
  };
}
