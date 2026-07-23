import { useId, useRef, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useDialogA11y } from '@/components/feedback/useDialogA11y';
import { Button } from '@/components/ui/Button';
import type { ButtonVariant } from '@/components/ui/Button.variants';

// explicit `| undefined` on every optional field so React
// callers can spread props from a parent state shape that carries
// explicit-undefined fields under `exactOptionalPropertyTypes`.
export interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal title */
  title?: string | undefined;
  /** Accessible label used when the modal has no visible title */
  ariaLabel?: string | undefined;
  /** Id of a visible title rendered by a custom modal header */
  ariaLabelledBy?: string | undefined;
  /** Modal content */
  children: ReactNode;
  /** Footer content (typically action buttons) */
  footer?: ReactNode | undefined;
  /** Modal size */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full' | undefined;
  /** Close on backdrop click */
  closeOnBackdrop?: boolean | undefined;
  /** Close on ESC key */
  closeOnEsc?: boolean | undefined;
  /** Show close button in header */
  showCloseButton?: boolean | undefined;
  /** Custom class for the modal container */
  className?: string | undefined;
  /** Custom class for the modal content */
  contentClassName?: string | undefined;
  /** Custom class for the modal footer */
  footerClassName?: string | undefined;
  /**
   * Optional override for focus restoration on close.
   * When provided and returning a non-null element, that element
   * receives focus instead of the element that was focused when the
   * modal opened. Returning `null` falls back to the default
   * "restore previously-focused element" behavior.
   *
   * Use this when the modal opener (a button, a palette action) is
   * not the right place for the cursor to land after close — e.g.
   * the cashier-speed flow on /sales wants focus on the page-level
   * product search input regardless of whether the modal was opened
   * via shortcut, palette, click, or programmatic trigger.
   */
  restoreFocusTo?: (() => HTMLElement | null) | undefined;
}

const sizeClasses = {
  sm: 'max-w-[30rem]',
  md: 'max-w-[38rem]',
  lg: 'max-w-[56rem]',
  xl: 'max-w-[64rem]',
  full: 'max-w-[72rem]',
};

export function Modal({
  isOpen,
  onClose,
  title,
  ariaLabel,
  ariaLabelledBy,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true,
  showCloseButton = true,
  className,
  contentClassName,
  footerClassName,
  restoreFocusTo,
}: ModalProps) {
  const { t } = useTranslation('common');
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // (review follow-up) — focus-trap, ESC close, focus restoration
  // (incl. the  restoreFocusTo override) and body-scroll-lock now
  // live in the shared useDialogA11y hook (also consumed by Drawer). Modal
  // keeps its historical single-dialog behaviour — it does not pass
  // `requireTopmost`, so the topmost-dialog arbitration is off.
  useDialogA11y({
    isOpen,
    onClose,
    closeOnEsc,
    containerRef: modalRef,
    restoreFocusTo,
  });

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : ariaLabelledBy}
      aria-label={title || ariaLabelledBy ? undefined : ariaLabel}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-secondary-950/60 backdrop-blur-sm animate-fade-in"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Modal container */}
      <div
        ref={modalRef}
        className={cn(
          'modal-shell max-h-[min(92vh,56rem)] animate-pop-in sm:max-h-[90vh]',
          sizeClasses[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="modal-header">
            {title && (
              <h2
                id={titleId}
                className="pr-4 font-display text-2xl leading-tight text-secondary-950 sm:text-[2rem]"
              >
                {title}
              </h2>
            )}
            {showCloseButton && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className={cn('shrink-0', !title && 'ml-auto')}
                aria-label={t('actions.closeModal')}
              >
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>
        )}

        {/* Body */}
        <div className={cn('modal-body', contentClassName)}>{children}</div>

        {/* Footer */}
        {footer && <div className={cn('modal-footer', footerClassName)}>{footer}</div>}
      </div>
    </div>
  );

  // Use createPortal to render at document body
  return createPortal(modalContent, document.body);
}

// Convenient button components for modal actions
export interface ModalButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  /**
   * Optional element id so a parent component can drive
   * `aria-controls` / `aria-describedby` relationships or call
   * `document.getElementById(...)?.focus()`.
   */
  id?: string;
}

export function ModalButton({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  type = 'button',
  className,
  id,
}: ModalButtonProps) {
  const buttonVariant: Record<NonNullable<ModalButtonProps['variant']>, ButtonVariant> = {
    primary: 'primary',
    secondary: 'outline',
    danger: 'danger',
  };

  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      id={id}
      variant={buttonVariant[variant]}
      className={cn('w-full sm:w-auto sm:min-w-[9rem]', className)}
    >
      {children}
    </Button>
  );
}

// Confirmation modal helper
export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  cancelText,
  variant = 'danger',
  loading = false,
  confirmDisabled = false,
  children,
}: ConfirmModalProps) {
  // Localized defaults — callers usually pass explicit strings, but the
  // fallbacks must not leak hardcoded English into a Spanish session.
  const { t } = useTranslation('common');
  const resolvedTitle = title ?? t('actions.confirm');
  const resolvedConfirmText = confirmText ?? t('actions.confirm');
  const resolvedCancelText = cancelText ?? t('actions.cancel');
  const loadingText = t('actions.loading');
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={resolvedTitle}
      size="sm"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={loading}>
            {resolvedCancelText}
          </ModalButton>
          <ModalButton variant={variant} onClick={onConfirm} disabled={loading || confirmDisabled}>
            {loading ? `${loadingText}…` : resolvedConfirmText}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-secondary-600">{message}</p>
        {children}
      </div>
    </Modal>
  );
}
