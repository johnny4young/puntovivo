import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  companies,
  countryCatalog,
  installationSetup,
  sites,
  tenantLocaleSettings,
  tenants,
  units,
  users,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { hashPasswordSecurely } from '../../security/passwords.js';
import type { CompleteInstallationInput } from '../../trpc/schemas/installation.js';
import { writeAuditLog } from '../audit-logs.js';
import { RING1_RETAIL_PROFILE } from '../modules/manifest.js';
import { resolvePresetPatch } from '../modules/presets.js';

/** Global catalog projection is safe before authentication; business identifiers are not. */
export interface InstallationSetupStatus {
  required: boolean;
  countries: Array<{
    code: string;
    nameEn: string;
    nameEs: string;
    currencyCode: string;
  }>;
}

/** Process-owned capability; only privileged launchers may call getToken, never HTTP handlers. */
export interface InstallationSetupController {
  getStatus: () => InstallationSetupStatus;
  getToken: () => string | null;
  complete: (input: CompleteInstallationInput) => Promise<{ created: true }>;
  dispose: () => void;
}

function closed(): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'SETUP_ALREADY_COMPLETED',
    message: 'Installation setup is not available; sign in with the existing owner',
  });
}

function invalidToken(): never {
  throwServerError({
    trpcCode: 'UNAUTHORIZED',
    errorCode: 'SETUP_TOKEN_INVALID',
    message: 'The installation code is invalid or no longer available',
  });
}

/** Structural DB/transaction capability used only for the installation-global empty boundary. */
type SetupReader = Pick<DatabaseInstance, 'select' | 'get'>;

function hasBusinessIdentity(db: SetupReader): boolean {
  return Boolean(
    db.get(sql`SELECT 1 FROM tenants UNION ALL SELECT 1 FROM users
      UNION ALL SELECT 1 FROM companies UNION ALL SELECT 1 FROM sites LIMIT 1`)
  );
}

/**
 * Fresh databases get an ephemeral 256-bit claim, not a seeded administrator.
 * Missing markers and historical ownership fail closed, including after deletion
 * of an owner's account. Capability expiry follows this process lifetime.
 */
export function createInstallationSetup(db: DatabaseInstance): InstallationSetupController {
  const markerExists = Boolean(
    db.get(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'installation_setup'`)
  );
  if (markerExists && hasBusinessIdentity(db)) {
    // Explicit demo seeds can run after migrations in tooling/tests. Adopt them
    // too, without modifying any existing tenant, user, role or credential.
    db.update(installationSetup)
      .set({ completedAt: new Date().toISOString(), completionKind: 'adopted' })
      .where(and(eq(installationSetup.id, 'local'), isNull(installationSetup.completedAt)))
      .run();
  }
  const isPending = (reader: SetupReader): boolean => {
    if (!markerExists) return false;
    const marker = reader
      .select()
      .from(installationSetup)
      .where(eq(installationSetup.id, 'local'))
      .get();
    return Boolean(marker && marker.completedAt === null && !hasBusinessIdentity(reader));
  };
  let token: Buffer | null = isPending(db) ? randomBytes(32) : null;
  let hashing = false;
  let attempts = 0;
  let windowStartedAt = Date.now();

  return {
    getStatus() {
      const required = token !== null && isPending(db);
      return {
        required,
        countries: required
          ? db
              .select({
                code: countryCatalog.code,
                nameEn: countryCatalog.nameEn,
                nameEs: countryCatalog.nameEs,
                currencyCode: countryCatalog.defaultCurrencyCode,
              })
              .from(countryCatalog)
              .orderBy(asc(countryCatalog.nameEs))
              .all()
          : [],
      };
    },
    getToken() {
      return token !== null && isPending(db) ? token.toString('hex') : null;
    },
    async complete(input) {
      if (!token || !isPending(db)) closed();
      const presented = Buffer.from(input.token, 'hex');
      if (presented.length !== token.length || !timingSafeEqual(token, presented)) invalidToken();
      // A valid capability still does not permit unbounded Argon2 work. Enforce
      // one hash and five attempts/minute per installation, also in tests.
      if (Date.now() - windowStartedAt >= 60_000) {
        attempts = 0;
        windowStartedAt = Date.now();
      }
      if (hashing || attempts >= 5) {
        throwServerError({
          trpcCode: 'TOO_MANY_REQUESTS',
          errorCode: 'SETUP_BUSY',
          message: 'Installation setup is busy; retry shortly',
        });
      }
      const country = db
        .select()
        .from(countryCatalog)
        .where(eq(countryCatalog.code, input.countryCode))
        .get();
      if (!country) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'SETUP_COUNTRY_INVALID',
          message: 'Select a country from the installation catalog',
        });
      }
      attempts += 1;
      hashing = true;
      try {
        const passwordHash = await hashPasswordSecurely(input.password);
        db.transaction(
          tx => {
            if (!token || !isPending(tx)) closed();
            const now = new Date().toISOString();
            const tenantId = nanoid();
            const ownerId = nanoid();
            const companyId = nanoid();
            const siteId = nanoid();
            tx.insert(tenants)
              .values({
                id: tenantId,
                name: input.businessName,
                slug: `business-${tenantId.toLowerCase()}`,
                defaultCurrencyCode: country.defaultCurrencyCode,
                settings: {
                  businessType: input.presetId,
                  modules: { ...RING1_RETAIL_PROFILE, ...resolvePresetPatch(input.presetId) },
                },
                isActive: true,
                createdAt: now,
                updatedAt: now,
              })
              .run();
            tx.insert(users)
              .values({
                id: ownerId,
                tenantId,
                name: input.ownerName,
                email: input.email,
                passwordHash,
                role: 'admin',
                isActive: true,
                createdAt: now,
                updatedAt: now,
              })
              .run();
            tx.insert(companies)
              .values({
                id: companyId,
                tenantId,
                name: input.businessName,
                email: input.email,
                createdAt: now,
                updatedAt: now,
              })
              .run();
            tx.insert(sites)
              .values({
                id: siteId,
                tenantId,
                companyId,
                name: input.siteName,
                isActive: true,
                createdAt: now,
                updatedAt: now,
              })
              .run();
            tx.insert(tenantLocaleSettings)
              .values({ tenantId, countryCode: country.code, updatedAt: now })
              .run();
            // A unit is structural catalog data, not stock or a fiscal assertion.
            // Taxes, legal identifiers, numbering and cash setup stay explicit UI steps.
            tx.insert(units)
              .values({
                id: nanoid(),
                tenantId,
                name: 'Unit',
                abbreviation: 'UN',
                dimension: 'count',
                standardCode: 'EA',
                referenceFactor: 1,
                isActive: true,
                createdAt: now,
                updatedAt: now,
              })
              .run();
            const completed = tx
              .update(installationSetup)
              .set({ completedAt: now, completionKind: 'owner_claim' })
              .where(and(eq(installationSetup.id, 'local'), isNull(installationSetup.completedAt)))
              .run();
            if (completed.changes !== 1) closed();
            writeAuditLog({
              tx,
              tenantId,
              actorId: ownerId,
              action: 'installation.owner_created',
              resourceType: 'tenant',
              resourceId: tenantId,
              after: { siteId, businessType: input.presetId, countryCode: country.code },
            });
          },
          { behavior: 'immediate' }
        );
        token.fill(0);
        token = null;
        return { created: true };
      } finally {
        hashing = false;
      }
    },
    dispose() {
      token?.fill(0);
      token = null;
    },
  };
}
