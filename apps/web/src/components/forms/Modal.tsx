import { useEffect, useRef, useCallback, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Modal title */
  title?: string;
  /** Modal content */
  children: ReactNode;
  /** Footer content (typically action buttons) */
  footer?: ReactNode;
  /** Modal size */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Close on backdrop click */
  closeOnBackdrop?: boolean;
  /** Close on ESC key */
  closeOnEsc?: boolean;
  /** Show close button in header */
  showCloseButton?: boolean;
  /** Custom class for the modal container */
  className?: string;
  /** Custom class for the modal content */
  contentClassName?: string;
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-4xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEsc = true,
  showCloseButton = true,
  className,
  contentClassName,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  // Focus trap
  const handleTabKey = useCallback(
    (e: KeyboardEvent) => {
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
    },
    []
  );

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
      // Store the currently focused element
      previousActiveElement.current = document.activeElement as HTMLElement;

      // Focus the modal or first focusable element
      const timer = setTimeout(() => {
        if (modalRef.current) {
          const firstFocusable = modalRef.current.querySelector<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          firstFocusable?.focus();
        }
      }, 50);

      return () => clearTimeout(timer);
    } else {
      // Restore focus to the previous element
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 animate-fade-in"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Modal container */}
      <div
        ref={modalRef}
        className={cn(
          'relative w-full bg-white rounded-xl shadow-xl animate-slide-in',
          'flex flex-col max-h-[90vh]',
          sizeClasses[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-secondary-200">
            {title && (
              <h2
                id="modal-title"
                className="text-lg font-semibold text-secondary-900"
              >
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'p-1.5 rounded-lg text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 transition-colors',
                  !title && 'ml-auto'
                )}
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        )}

        {/* Body */}
        <div
          className={cn(
            'flex-1 overflow-y-auto px-6 py-4',
            contentClassName
          )}
        >
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-secondary-200 bg-secondary-50 rounded-b-xl">
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
}

export function ModalButton({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  type = 'button',
  className,
}: ModalButtonProps) {
  const variantClasses = {
    primary: 'bg-primary-600 text-white hover:bg-primary-700 focus:ring-primary-500/20',
    secondary: 'bg-white text-secondary-700 border border-secondary-300 hover:bg-secondary-50 focus:ring-secondary-500/20',
    danger: 'bg-danger-600 text-white hover:bg-danger-700 focus:ring-danger-500/20',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-offset-0',
        'disabled:opacity-50 disabled:cursor-not-allowed',
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
          <ModalButton
            variant={variant}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Loading...' : confirmText}
          </ModalButton>
        </>
      }
    >
      <p className="text-secondary-600">{message}</p>
    </Modal>
  );
}
