/**
 * Session identity guard.
 *
 * `AuthUserIdentity` is deliberately human-shaped: it requires an email, and
 * only a human account can ever receive a session. Keeping that type narrow
 * makes the compiler enforce the rule — a service identity cannot be turned
 * into a token, so no runtime check can be forgotten.
 *
 * @module security/session-identity
 */
import { TRPCError } from '@trpc/server';

import type { UserKind } from '../db/schema/base.js';

export interface SessionCandidate {
  id: string;
  tenantId: string;
  kind?: UserKind | null;
  email: string | null;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  sessionVersion: number;
}

export interface HumanSessionIdentity {
  id: string;
  tenantId: string;
  email: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  sessionVersion: number;
}

/**
 * Narrow a user row to a session identity, refusing every non-human.
 *
 * Service identities exist only to author automatic audit rows; they hold no
 * credentials and must never hold a token, a refresh family or a staff PIN.
 * Failing here (rather than deep inside token signing) keeps the refusal in
 * one place for login, PIN switch, refresh and recovery alike.
 */
export function toHumanSessionIdentity(user: SessionCandidate): HumanSessionIdentity {
  if (user.kind === 'service' || user.email === null) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'A service identity cannot authenticate',
    });
  }
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    role: user.role,
    sessionVersion: user.sessionVersion,
  };
}

/** The credential fields a human row must carry; absent ones never exist on a
 * service identity. Used by tests and by any caller that verifies a password
 * against a row it just read. */
export interface HumanCredentials {
  email: string;
  passwordHash: string;
}

/**
 * Narrow a row to the credentials it must have to be usable in an
 * authentication path. Throws rather than defaulting, so a missing hash can
 * never be silently replaced by an empty string.
 */
export function requireHumanCredentials(user: {
  kind?: UserKind | null;
  email: string | null;
  passwordHash?: string | null;
}): HumanCredentials {
  if (user.kind === 'service' || user.email === null || !user.passwordHash) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'A service identity has no credentials',
    });
  }
  return { email: user.email, passwordHash: user.passwordHash };
}

/**
 * The address of an authenticated actor that must have one.
 *
 * A context actor always represents a signed-in human, so a missing address is
 * a fixture error, not a legitimate state. Throwing keeps callers from
 * defaulting to an empty string, which would make a claim nobody could verify.
 */
export function requireActorEmail(user: { email: string | null }): string {
  if (user.email === null) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'This actor has no address on record',
    });
  }
  return user.email;
}
