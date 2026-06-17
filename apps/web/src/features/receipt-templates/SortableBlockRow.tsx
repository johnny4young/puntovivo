import { type CSSProperties, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Props for {@link SortableBlockRow}. The parent owns block selection +
 * reorder + remove; this row only renders the chrome and forwards the
 * dnd-kit activation to its grip handle.
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
export function SortableBlockRow({
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
