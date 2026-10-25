import { useContext, useLayoutEffect, useRef } from 'react';
import { ToastOutletContext } from './ToastContext';

/** Dialog slot for toasts raised while the dialog is the topmost one. */
export function ToastOutlet() {
  const register = useContext(ToastOutletContext);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (register && ref.current) return register(ref.current);
  }, [register]);

  return <div ref={ref} className="dialog-toast-outlet" />;
}
