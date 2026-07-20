import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function createTestContext(): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: {
      userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  return {
    req: mockReq,
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

describe('Logos tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });

    const db = getDatabase();
    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) {
      throw new Error('Expected seeded admin user');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates, lists, updates, and deletes logos', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.logos.create({
      name: 'Front Desk',
      imageUrl: 'https://example.com/front-desk.png',
      isActive: true,
    });
    expect(created.name).toBe('Front Desk');

    const listed = await caller.logos.list({ includeInactive: true });
    expect(listed.items.some(item => item.id === created.id)).toBe(true);

    const updated = await caller.logos.update({
      id: created.id,
      imageUrl: 'https://example.com/front-desk-v2.png',
      isActive: false,
    });
    expect(updated.imageUrl).toBe('https://example.com/front-desk-v2.png');
    expect(updated.isActive).toBe(false);

    const removed = await caller.logos.delete({ id: created.id });
    expect(removed.success).toBe(true);
  });

  it('blocks deleting a logo that is assigned to the company', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const logo = await caller.logos.create({
      name: 'Assigned Logo',
      imageUrl: 'https://example.com/assigned.png',
      isActive: true,
    });

    await caller.companies.setLogo({ logoId: logo.id });

    await expect(caller.logos.delete({ id: logo.id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Unassign this logo from the company before deleting it.',
    });
  });

  // vector 3 — `imageUrl` Zod refine blocks dangerous URL
  // schemes at input time so they never reach storage. Defense in
  // depth pairs with `escapeHtml` in `services/receipt-renderer.ts`.
  describe(' vector 3 — imageUrl scheme blocklist', () => {
    it('rejects javascript: scheme on create', async () => {
      const caller = appRouter.createCaller(createTestContext());
      await expect(
        caller.logos.create({
          name: 'Malicious Logo',
          imageUrl: 'javascript:alert(1)',
          isActive: true,
        })
      ).rejects.toThrow();
    });

    it('rejects javascript: even when the URL parser normalizes control characters', async () => {
      const caller = appRouter.createCaller(createTestContext());
      await expect(
        caller.logos.create({
          name: 'Control Character JS',
          imageUrl: 'java\nscript:alert(1)',
          isActive: true,
        })
      ).rejects.toThrow();
    });

    it('rejects data:text/html scheme on create', async () => {
      const caller = appRouter.createCaller(createTestContext());
      await expect(
        caller.logos.create({
          name: 'Malicious Logo',
          imageUrl: 'data:text/html,<script>alert(1)</script>',
          isActive: true,
        })
      ).rejects.toThrow();
    });

    it('rejects vbscript: and file: schemes on create', async () => {
      const caller = appRouter.createCaller(createTestContext());
      await expect(
        caller.logos.create({
          name: 'Bad VB',
          imageUrl: 'vbscript:msgbox(1)',
          isActive: true,
        })
      ).rejects.toThrow();
      await expect(
        caller.logos.create({
          name: 'Bad File',
          imageUrl: 'file:///etc/passwd',
          isActive: true,
        })
      ).rejects.toThrow();
    });

    it('accepts https:// and data:image/... schemes', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const httpsLogo = await caller.logos.create({
        name: 'HTTPS Logo',
        imageUrl: 'https://example.com/logo.png',
        isActive: true,
      });
      expect(httpsLogo.imageUrl).toBe('https://example.com/logo.png');

      const dataImageLogo = await caller.logos.create({
        name: 'Inline Logo',
        imageUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        isActive: true,
      });
      expect(dataImageLogo.imageUrl.startsWith('data:image/png;')).toBe(true);
    });

    it('rejects javascript: scheme on update', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const logo = await caller.logos.create({
        name: 'Existing Logo',
        imageUrl: 'https://example.com/safe.png',
        isActive: true,
      });
      await expect(
        caller.logos.update({
          id: logo.id,
          imageUrl: 'javascript:alert(1)',
        })
      ).rejects.toThrow();
    });
  });
});
