/**
 * shared desktop-session fixture for IPC tests: registers a
 * verified `tenant-1` session with the requested role through the real
 * singleton (`register` + a stub verifier).
 */

import type { AuthTokenPayload } from '@puntovivo/server';
import { register } from '../../session/desktopSession.ts';

export async function registerRole(role: AuthTokenPayload['role']): Promise<void> {
  await register('valid-token', async () => ({
    userId: `user-${role}`,
    tenantId: 'tenant-1',
    email: `${role}@puntovivo.test`,
    role,
    sessionVersion: 1,
    tokenType: 'access' as const,
  }));
}
