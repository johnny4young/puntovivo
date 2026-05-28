import { useEffect, useRef, useCallback, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

// ENG-179b — explicit `| undefined` on every optional field so React
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
   * ENG-105f — Optional override for focus restoration on close.
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
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  // ENG-105f — keep the latest restoreFocusTo accessible from the
  // focus-restore branch without including it in the effect deps
  // (a parent that creates a fresh arrow on every render would
  // otherwise re-fire focus restoration spuriously). The sync runs
  // inside an effect to satisfy `react-hooks/refs` while staying
  // current-render-fresh by the time the close transition fires.
  const restoreFocusToRef = useRef(restoreFocusTo);
  useEffect(() => {
    restoreFocusToRef.current = restoreFocusTo;
  }, [restoreFocusTo]);

  // Focus trap
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (!modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement?.focus();
    } else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement?.focus();
    }
  }, []);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        onClose();
      }
      if (e.key === 'Tab') {
        handleTabKey(e);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEsc, onClose, handleTabKey]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      // Store the currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Focus the modal or first focusable element
      const timer = setTimeout(() => {
        if (modalRef.current) {
          const activeElement = document.activeElement as HTMLElement | null;
          if (
            activeElement &&
            activeElement !== document.body &&
            modalRef.current.contains(activeElement)
          ) {
            return;
          }

          const firstFocusable = modalRef.current.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          firstFocusable?.focus();
        }
      }, 50);

      return () => clearTimeout(timer);
    }

    if (!wasOpenRef.current) {
      return;
    }
    wasOpenRef.current = false;

    // Restore focus on close. The optional override takes
    // precedence when it returns a focusable element; otherwise
    // fall back to the element that was focused at open time.
    const override = restoreFocusToRef.current?.();
    if (override) {
      override.focus();
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

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
      aria-labelledby={title ? 'modal-title' : undefined}
      aria-label={title ? undefined : ariaLabel}
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
          'modal-shell max-h-[min(92vh,56rem)] animate-slide-in sm:max-h-[90vh]',
          sizeClasses[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="modal-header">
            {title && (
              <h2 id="modal-title" className="pr-4 font-display text-2xl leading-tight text-secondary-950 sm:text-[2rem]">
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'btn-ghost btn-icon shrink-0',
                  !title && 'ml-auto'
                )}
                aria-label={t('actions.closeModal')}
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div className={cn('modal-body', contentClassName)}>{children}</div>

        {/* Footer */}
        {footer && (
          <div className={cn('modal-footer', footerClassName)}>
            {footer}
          </div>
        )}
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
  const variantClasses = {
    primary: 'btn-primary',
    secondary: 'btn-outline',
    danger: 'btn-danger',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      id={id}
      className={cn(
        'w-full sm:w-auto sm:min-w-[9rem]',
        variantClasses[variant],
        className
      )}
    >
      {children}
    </button>
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
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
}: ConfirmModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={loading}>
            {cancelText}
          </ModalButton>
          <ModalButton variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? 'Loading...' : confirmText}
          </ModalButton>
        </>
      }
    >
      <p className="text-secondary-600">{message}</p>
    </Modal>
  );
}
