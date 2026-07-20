/**
 * (review follow-up) — shared dialog accessibility hook.
 *
 * Encapsulates the focus-trap + ESC-to-close + focus-restoration +
 * body-scroll-lock behaviour that both `Modal` (form-controls/Modal.tsx)
 * and `Drawer` (feedback/Drawer.tsx) need, so the two primitives stop
 * duplicating ~70 lines of effect plumbing.
 *
 * Behaviour is identical to the original inlined Modal logic when
 * `requireTopmost` is false (Modal keeps its exact prior behaviour). When
 * `requireTopmost` is true (Drawer), ESC and the Tab-trap only act when
 * this dialog is the last `[role="dialog"][aria-modal="true"]` in the DOM
 * so stacked dialogs do not all close on a single ESC and their focus
 * traps do not fight.
 *
 * @module components/feedback/useDialogA11y
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Focusable-descendant selector shared by the focus-in + Tab-trap logic. */
const FOCUSABLE_SELECTOR =
  'button:not(:disabled):not([hidden]), [href]:not([hidden]), input:not(:disabled):not([hidden]), select:not(:disabled):not([hidden]), textarea:not(:disabled):not([hidden]), [tabindex]:not([tabindex="-1"]):not([hidden])';
const MODAL_DIALOG_SELECTOR = '[role="dialog"][aria-modal="true"]';

interface IsolationState {
  count: number;
  previousAriaHidden: string | null;
  previousInert: boolean;
}

// several dialogs can be stacked. Reference counts prevent a
// closing parent/child from exposing the application while another dialog
// still owns the screen-reader cursor.
const isolatedElements = new WeakMap<HTMLElement, IsolationState>();

function acquireIsolation(element: HTMLElement): void {
  const current = isolatedElements.get(element);
  if (current) {
    current.count += 1;
    return;
  }
  isolatedElements.set(element, {
    count: 1,
    previousAriaHidden: element.getAttribute('aria-hidden'),
    previousInert: element.inert === true,
  });
  element.setAttribute('aria-hidden', 'true');
  element.inert = true;
}

function releaseIsolation(element: HTMLElement): void {
  const current = isolatedElements.get(element);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;

  if (current.previousAriaHidden === null) {
    element.removeAttribute('aria-hidden');
  } else {
    element.setAttribute('aria-hidden', current.previousAriaHidden);
  }
  element.inert = current.previousInert;
  isolatedElements.delete(element);
}

// explicit `| undefined` on optional fields for callers spreading
// a parent state shape under `exactOptionalPropertyTypes`.
export interface UseDialogA11yOptions {
  /** Whether the dialog is open (drives every effect). */
  isOpen: boolean;
  /** Called when ESC requests close (only fires while `closeOnEsc`). */
  onClose: () => void;
  /** Honour ESC-to-close. */
  closeOnEsc: boolean;
  /** Ref to the panel that owns the focus-trap + initial focus target. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * focus-restoration override. When it returns a focusable
   * element, that element receives focus on close instead of the element
   * focused at open time.
   */
  restoreFocusTo?: (() => HTMLElement | null) | undefined;
  /**
   * Ref to the `[role="dialog"][aria-modal="true"]` element, used for
   * topmost-dialog arbitration when `requireTopmost` is true.
   */
  dialogRef?: RefObject<HTMLElement | null> | undefined;
  /**
   * When true, ESC and the Tab-trap only act if this dialog is the topmost
   * modal dialog in the DOM. Default false (Modal's historical behaviour).
   */
  requireTopmost?: boolean | undefined;
}

function isTopmostModalDialog(dialog: HTMLElement | null): boolean {
  if (!dialog) return false;
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(MODAL_DIALOG_SELECTOR));
  return dialogs.at(-1) === dialog;
}

export function useDialogA11y({
  isOpen,
  onClose,
  closeOnEsc,
  containerRef,
  restoreFocusTo,
  dialogRef,
  requireTopmost = false,
}: UseDialogA11yOptions): void {
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  // Keep the latest restoreFocusTo accessible from the close branch without
  // listing it in the effect deps (a parent passing a fresh arrow each render
  // would otherwise re-fire focus restoration spuriously).
  const restoreFocusToRef = useRef(restoreFocusTo);
  useEffect(() => {
    restoreFocusToRef.current = restoreFocusTo;
  }, [restoreFocusTo]);

  // `requireTopmost` + `dialogRef` are stable for a given primitive
  // (Modal: false/undefined; Drawer: true/ref) so this callback is stable.
  const isActive = useCallback(() => {
    if (!requireTopmost) return true;
    if (!dialogRef?.current) return true;
    return isTopmostModalDialog(dialogRef.current);
  }, [requireTopmost, dialogRef]);

  // Focus trap.
  const handleTabKey = useCallback(
    (e: KeyboardEvent) => {
      if (!isActive()) return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    },
    [isActive, containerRef]
  );

  // Keyboard: ESC close + Tab trapping.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive()) return;
      if (e.key === 'Escape' && closeOnEsc) onClose();
      if (e.key === 'Tab') handleTabKey(e);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEsc, onClose, handleTabKey, isActive]);

  // aria-modal alone is advisory and VoiceOver can still walk the
  // page behind a dialog. Isolate background siblings at every ancestor level
  // so both portals and inline dialogs work. The topmost dialog additionally
  // isolates lower dialogs; lower dialogs keep their own application isolation
  // so they become active again safely when the top layer closes.
  useEffect(() => {
    if (!isOpen) return;
    const activeDialog =
      dialogRef?.current ?? containerRef.current?.closest<HTMLElement>(MODAL_DIALOG_SELECTOR);
    if (!activeDialog) return;

    const activeIsTopmost = isTopmostModalDialog(activeDialog);
    const targets = new Set<HTMLElement>();
    let activeBranch: HTMLElement = activeDialog;
    let parent = activeBranch.parentElement;

    while (parent) {
      Array.from(parent.children).forEach(child => {
        if (!(child instanceof HTMLElement) || child === activeBranch) return;
        const containsDialog = Boolean(
          child.matches(MODAL_DIALOG_SELECTOR) || child.querySelector(MODAL_DIALOG_SELECTOR)
        );
        if (!containsDialog || activeIsTopmost) targets.add(child);
      });
      if (parent === document.body) break;
      activeBranch = parent;
      parent = activeBranch.parentElement;
    }

    const targetList = Array.from(targets);
    const focusedElement = document.activeElement as HTMLElement | null;
    if (focusedElement && targetList.some(target => target.contains(focusedElement))) {
      previousActiveElement.current = focusedElement;
      containerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    }
    targetList.forEach(acquireIsolation);
    return () => targetList.forEach(releaseIsolation);
  }, [isOpen, containerRef, dialogRef]);

  // Focus management: focus first element on open, restore on close.
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      previousActiveElement.current ??= document.activeElement as HTMLElement;
      const timer = setTimeout(() => {
        const container = containerRef.current;
        if (!container) return;
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body && container.contains(active)) {
          return;
        }
        container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const previouslyFocused = previousActiveElement.current;
    previousActiveElement.current = null;
    const override = restoreFocusToRef.current?.();
    if (override) {
      override.focus();
    } else {
      previouslyFocused?.focus();
    }
  }, [isOpen, containerRef]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!isOpen) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [isOpen]);
}
