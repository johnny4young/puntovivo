/**
 * Reusable side Drawer (slide-over).
 *
 * A portal-based overlay that keeps the primary screen in place while
 * secondary content slides in from the edge. On desktop (`sm:+`) it is a
 * right-anchored full-height panel; on mobile it is a bottom sheet.
 *
 * It shares the dialog a11y contract with `Modal` through the common
 * `useDialogA11y` hook (focus-trap, ESC close, focus-restoration via the
 * `restoreFocusTo` override, body-scroll-lock), and adds two
 * things on top of Modal's baseline:
 * - a unique `useId()` title id, so several labelled drawers can mount
 * without clashing `aria-labelledby` targets;
 * - topmost-dialog arbitration (`requireTopmost`), so a single ESC only
 * closes the frontmost dialog and stacked focus-traps do not fight.
 *
 * Why a separate primitive (not a Modal size): a drawer must not steal the
 * whole viewport — the operator should still see the screen it slid over.
 *
 * @module components/feedback/Drawer
 */
import { useId, useRef, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useDialogA11y } from './useDialogA11y';
import { Button } from '@/components/ui/Button';

// explicit `| undefined` on every optional field so callers can
// spread props from a parent state shape under `exactOptionalPropertyTypes`.
export interface DrawerProps {
  /** Whether the drawer is open. */
  isOpen: boolean;
  /** Called when the drawer requests close (ESC, backdrop, close button). */
  onClose: () => void;
  /** Visible heading; also wires `aria-labelledby`. */
  title?: string | undefined;
  /** Accessible label when there is no visible title. */
  ariaLabel?: string | undefined;
  /** Drawer body. */
  children: ReactNode;
  /** Optional non-scrolling region between the title bar and body. */
  pinnedContent?: ReactNode | undefined;
  /** Optional sticky footer (action buttons). */
  footer?: ReactNode | undefined;
  /** Close on backdrop click. Default true. */
  closeOnBackdrop?: boolean | undefined;
  /** Close on ESC key. Default true. */
  closeOnEsc?: boolean | undefined;
  /** Show the header close button. Default true. */
  showCloseButton?: boolean | undefined;
  /** Max width of the desktop panel. Default `lg` (32rem). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | undefined;
  /** Extra classes for the sliding panel. */
  className?: string | undefined;
  /** Extra classes for the scrollable body. */
  contentClassName?: string | undefined;
  /**
   * focus-restoration override. When it returns a focusable
   * element, that element receives focus on close instead of the element
   * focused at open time. `/sales` uses it to send focus back to the
   * product search input regardless of how the drawer was opened.
   */
  restoreFocusTo?: (() => HTMLElement | null) | undefined;
  /** `data-testid` for the sliding panel. */
  testId?: string | undefined;
}

const sizeClasses = {
  sm: 'sm:max-w-[22rem]',
  md: 'sm:max-w-[26rem]',
  lg: 'sm:max-w-[32rem]',
  xl: 'sm:max-w-[40rem]',
};

export function Drawer({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  pinnedContent,
  footer,
  closeOnBackdrop = true,
  closeOnEsc = true,
  showCloseButton = true,
  size = 'lg',
  className,
  contentClassName,
  restoreFocusTo,
  testId,
}: DrawerProps) {
  const { t } = useTranslation('common');
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useDialogA11y({
    isOpen,
    onClose,
    closeOnEsc,
    containerRef: panelRef,
    restoreFocusTo,
    dialogRef,
    requireTopmost: true,
  });

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  const content = (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : ariaLabel}
    >
      <div
        className="fixed inset-0 bg-secondary-950/60 backdrop-blur-sm animate-fade-in"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        data-testid={testId}
        className={cn('drawer-shell relative z-10', sizeClasses[size], className)}
      >
        {(title || showCloseButton) && (
          <div className="modal-header shrink-0 items-center">
            {title ? (
              <h2 id={titleId} className="font-display text-xl leading-tight text-secondary-950">
                {title}
              </h2>
            ) : (
              <span />
            )}
            {showCloseButton && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="shrink-0"
                aria-label={t('actions.closeModal')}
              >
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>
        )}
        {pinnedContent && <div className="drawer-pinned-content shrink-0">{pinnedContent}</div>}
        <div className={cn('modal-body min-h-0', contentClassName)}>{children}</div>
        {footer && <div className="modal-footer shrink-0">{footer}</div>}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
