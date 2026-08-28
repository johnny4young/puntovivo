import { createContext, useContext } from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastInput {
  title: string;
  description?: string | undefined;
  durationMs?: number | undefined;
  action?:
    | {
        label: string;
        onClick: () => void | Promise<void>;
      }
    | undefined;
}

export interface ToastRecord extends ToastInput {
  id: string;
  tone: ToastTone;
}

export interface ToastContextValue {
  show: (toast: ToastInput & { tone?: ToastTone }) => string;
  success: (toast: ToastInput) => string;
  error: (toast: ToastInput) => string;
  info: (toast: ToastInput) => string;
  warning: (toast: ToastInput) => string;
  dismiss: (toastId: string) => void;
}

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}
