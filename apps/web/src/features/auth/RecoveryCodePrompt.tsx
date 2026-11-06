import { lazy, Suspense, useState } from 'react';
import { trpc } from '@/lib/trpc';

const RecoveryCodeModal = lazy(() =>
  import('./RecoveryCodeModal').then(module => ({ default: module.RecoveryCodeModal }))
);

const DISMISSED_KEY = 'puntovivo.recoveryCodePrompt.dismissed';

function wasDismissed(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === userId;
  } catch {
    return false;
  }
}

function rememberDismissed(userId: string): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, userId);
  } catch {
    // Private-mode storage can throw; the prompt simply returns next load.
  }
}

/** Asks an admin without a recovery code to create one, once per app session. */
export function RecoveryCodePrompt({ userId }: { userId: string }) {
  const status = trpc.auth.recoveryCodeStatus.useQuery(undefined, { staleTime: 5 * 60_000 });
  // Latched so the modal stays up while it shows the new code, after the status flips.
  const [open, setOpen] = useState<boolean | null>(null);
  if (open === null && status.data) {
    setOpen(!status.data.configured && !wasDismissed(userId));
  }
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <RecoveryCodeModal
        prompt
        onClose={() => {
          rememberDismissed(userId);
          setOpen(false);
        }}
      />
    </Suspense>
  );
}
