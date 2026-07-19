import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, type ModalProps } from '@/components/form-controls/Modal';
import { cn } from '@/lib/utils';

export interface OverlayProps
  extends Omit<ModalProps, 'title' | 'children' | 'contentClassName' | 'ariaLabelledBy'> {
  /**
   * Tracked uppercase micro-label rendered above the title. Use one of
   * the established Puntovivo kickers ("APERTURA DE CAJA", "NOVEDADES",
   * "DEVOLUCIÓN") so the surface inherits the editorial chrome the
   * design system spelled out.
   */
  kicker?: string;
  /**
   * Display-font title. Required — the Overlay's whole point is to
   * stage the kicker → title → description rhythm.
   */
  title: ReactNode;
  /**
   * Supporting paragraph rendered under the title. Keep it under two
   * lines; longer copy belongs in the body.
   */
  description?: ReactNode;
  /**
   * Inline-right slot inside the editorial header — e.g. a status pill
   * or a step indicator on multi-step flows.
   */
  headerAside?: ReactNode;
  /**
   * Main body content. Stays unstyled so callers control density.
   */
  children: ReactNode;
  /**
   * Optional class for the body wrapper (the same hatch as Modal's
   * contentClassName).
   */
  bodyClassName?: string;
}

/**
 * Editorial overlay primitive built on top of `Modal`.
 *
 * Born from ENG-082's "Apertura de caja · primer día" V11 screen but
 * designed to be re-used by every announcement / first-run / what's-new
 * surface in the app (ENG-092 will consume it for the per-release
 * announcement system).
 *
 * The chrome — backdrop, focus trap, ESC handling, portal mount, body
 * scroll lock — is delegated to the underlying Modal so we never fork
 * those invariants. Overlay's only job is to render the editorial
 * `kicker → title → description` header that the design-system handoff
 * keeps reaching for.
 */
export function Overlay({
  kicker,
  title,
  description,
  headerAside,
  children,
  bodyClassName,
  showCloseButton = true,
  ...modalProps
}: OverlayProps) {
  const { t } = useTranslation('common');
  const titleId = useId();
  return (
    <Modal
      {...modalProps}
      // Modal renders its own `title` row when this prop is non-empty; we
      // want a custom editorial header instead, so we hand it nothing.
      title={undefined}
      ariaLabelledBy={titleId}
      // The body slot is where the editorial header + caller children
      // both live. We pad it manually so the title block lines up with
      // the surrounding `modal-body` padding the rest of the app uses.
      showCloseButton={false}
      contentClassName="px-0 py-0"
    >
      <div className="modal-body relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            {kicker && (
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary-700">
                {kicker}
              </p>
            )}
            <h2
              id={titleId}
              className={cn(
                'font-display text-[22px] font-normal leading-none tracking-[-0.02em] text-secondary-950',
                kicker && 'mt-2'
              )}
            >
              {title}
            </h2>
            {description && (
              <p className="mt-2.5 text-[12.5px] leading-[1.55] text-secondary-600">{description}</p>
            )}
          </div>
          <div className="flex items-start gap-2">
            {headerAside}
            {showCloseButton && (
              <button
                type="button"
                onClick={modalProps.onClose}
                className="btn-ghost btn-icon shrink-0"
                aria-label={t('actions.closeModal')}
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className={cn('mt-6', bodyClassName)}>{children}</div>
      </div>
    </Modal>
  );
}
