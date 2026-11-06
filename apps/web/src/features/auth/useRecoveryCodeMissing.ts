import { trpc } from '@/lib/trpc';

/** True once the server confirms this admin has no recovery code yet. */
export function useRecoveryCodeMissing(isAdmin: boolean): boolean {
  const status = trpc.auth.recoveryCodeStatus.useQuery(undefined, {
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  return isAdmin && status.data?.configured === false;
}
