import { useContext, useLayoutEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { ToastOutletContext } from './ToastContext';

/** Dialog slot for toasts raised while the dialog is the topmost one. */
export function ToastOutlet({ className }: { className?: string | undefined }) {
  const register = useContext(ToastOutletContext);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (register && ref.current) return register(ref.current);
  }, [register]);

  return <div ref={ref} className={cn('dialog-toast-outlet', className)} />;
}
