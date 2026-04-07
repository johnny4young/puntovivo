/**
 * tRPC Context
 *
 * Request context with database, user, tenant, and site information.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseInstance } from '../db/index.js';
import { sites } from '../db/schema.js';

export interface Context {
  req: FastifyRequest;
  res: FastifyReply;
  db: DatabaseInstance;
  user: {
    id: string;
    email: string;
    role: string;
    tenantId: string;
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

  // Try to extract user from JWT if it exists
  try {
    await req.jwtVerify();
    const payload = req.user as {
      userId: string;
      email: string;
      role: string;
      tenantId: string;
    };
    user = {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId,
    };
    tenantId = payload.tenantId;
  } catch {
    // No valid token - allow public procedures
  }

  if (tenantId) {
    const requestedSiteId = getHeaderValue(req.headers['x-site-id']);

    if (requestedSiteId) {
      const requestedSite = await req.server.db
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(
            eq(sites.id, requestedSiteId),
            eq(sites.tenantId, tenantId),
            eq(sites.isActive, true)
          )
        )
        .get();

      if (requestedSite) {
        siteId = requestedSite.id;
      }
    }

    if (!siteId) {
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
