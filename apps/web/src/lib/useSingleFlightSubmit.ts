/**
 * One submit per gesture, for the money modals.
 *
 * `Modal` renders `footer` as a SIBLING of `children`, so a modal whose body
 * is a `<form>` has its confirm button OUTSIDE that form. `disabled={isSaving}`
 * on the footer button therefore guards the CLICK path and nothing else: the
 * form carries no submit button of its own, so a form with at most one
 * implicit-submission-blocking field submits on Enter, straight into
 * `onSubmit`, past the disabled button entirely. Held Enter on a repeating
 * keyboard is not a race — it is a loop, and every iteration writes another
 * row. On `customerLedger.addPayment` that means the customer's debt is paid
 * down twice from one gesture.
 *
 * The guard has two halves because they close different windows:
 *
 * - `canSubmit` is the parent's render-captured pending flag. It covers the
 *   whole time the mutation is in flight, including after the submit callback
 *   itself has resolved, and it is the only half that can see state the
 *   callback does not own.
 * - `inFlight` is a ref, so it flips synchronously. `canSubmit` is a state
 *   value: two dispatches inside one task both read the pre-update value, and
 *   the ref is what makes the second one a no-op.
 *
 * `DeliveryOrderDetail` already carries the ref half by hand; this collapses
 * that shape into one implementation so the modals do not each re-derive it.
 *
 * @module lib/useSingleFlightSubmit
 */

import { useRef } from 'react';

/**
 * Wrap a submit callback so it runs at most once per in-flight window.
 *
 * @param canSubmit whether a submit is allowed right now — normally
 *   `!isSaving`, plus any other precondition the footer button disables on.
 *   Pass the same expression the button uses, so the Enter path and the click
 *   path cannot disagree.
 * @param submit the callback to guard. Re-created every render is fine, and
 *   the returned wrapper is too: `form.handleSubmit` already returns a fresh
 *   handler per render, so nothing downstream depends on a stable identity.
 * @returns a callback that resolves to `undefined` when it declined.
 */
export function useSingleFlightSubmit<TArgs extends readonly unknown[], TResult>(
  canSubmit: boolean,
  submit: (...args: TArgs) => TResult | Promise<TResult>
): (...args: TArgs) => Promise<TResult | undefined> {
  const inFlight = useRef(false);

  // A fresh closure per render, capturing THIS render's `canSubmit` and
  // `submit`. The alternative — latest-value refs assigned during render —
  // reads and writes a ref in the render phase, which breaks under concurrent
  // rendering when a render is discarded, and the React lint rule rejects it.
  // The ref below is only ever touched inside the handler, at event time.
  return async (...args: TArgs): Promise<TResult | undefined> => {
    if (!canSubmit || inFlight.current) return undefined;
    inFlight.current = true;
    try {
      return await submit(...args);
    } finally {
      // Released on failure too: a rejected write must stay retryable, and
      // the parent's own pending flag is what covers the success path until
      // the modal closes.
      inFlight.current = false;
    }
  };
}
