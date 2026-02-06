/**
 * tRPC Context
 * 
 * Request context with database, user, and tenant information
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseInstance } from '../db/index.js';

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

  // Try to extract user from JWT if it exists
  try {
    await req.jwtVerify();
    const payload = req.user as any;
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

  return {
    req,
    res,
    db: req.server.db,
    user,
    tenantId,
  };
}
