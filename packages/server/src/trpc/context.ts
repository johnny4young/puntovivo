/**
 * tRPC Context
 *
 * Request context with database, user, tenant, and site information.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseInstance } from '../db/index.js';
import { sites } from '../db/schema.js';
import { verifyAccessToken } from '../security/authTokens.js';
import type { AuthMethod } from '../security/authTokens.js';
import type { UserRole } from '@puntovivo/shared/roles';

export interface Context {
  req: FastifyRequest;
  res: FastifyReply;
  db: DatabaseInstance;
  user: {
    id: string;
    email: string;
    role: UserRole;
    tenantId: string;
    /** Present for real JWT contexts; synthetic direct-caller tests may omit it. */
    sessionVersion?: number;
    authMethod?: AuthMethod;
    authSessionExpiresAt?: number;
  } | null;
  tenantId: string | null;
  siteId: string | null;
}

export async function createContext({
  req,
  res,
}: {
  req: FastifyRequest;
  res: FastifyReply;
}): Promise<Context> {
  let user = null;
  let tenantId = null;
  let siteId = null;

  const payload = await verifyAccessToken(req);
  if (payload) {
    user = {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
      sessionVersion: payload.sessionVersion,
      ...(payload.authMethod ? { authMethod: payload.authMethod } : {}),
      ...(payload.authSessionExpiresAt !== undefined
        ? { authSessionExpiresAt: payload.authSessionExpiresAt }
        : {}),
    };
    tenantId = payload.tenantId;
  }

  // Resolve the active site for this request. Precedence:
  //   1. An explicit `x-site-id` header is honored ONLY when it names a site
  //      that belongs to this tenant AND is active. A foreign, stale, or
  //      inactive selection leaves the request without a site: it is never
  //      swapped for another site, so writes keyed on `ctx.siteId` fail
  //      instead of landing somewhere the operator did not select.
  //   2. A request that omits the header falls back to the tenant's first
  //      active site by name, so single-site tenants still receive a
  //      deterministic `siteId` instead of null.
  // Anonymous (no-tenant) requests never carry a site.
  if (tenantId) {
    const requestedSiteId = getHeaderValue(req.headers['x-site-id']);

    if (requestedSiteId) {
      const requestedSite = await req.server.db
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(eq(sites.id, requestedSiteId), eq(sites.tenantId, tenantId), eq(sites.isActive, true))
        )
        .get();

      siteId = requestedSite?.id ?? null;
    } else {
      const fallbackSite = await req.server.db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
        .orderBy(asc(sites.name))
        .get();

      siteId = fallbackSite?.id ?? null;
    }
  }

  return {
    req,
    res,
    db: req.server.db,
    user,
    tenantId,
    siteId,
  };
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}
