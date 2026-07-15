import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { E2E_PASSWORD } from './app';
import { prepareFirstSaleBaseline } from '../../shared/baseline.js';

const DB_PATH = join(process.cwd(), 'packages/server/data/local.db');
const SITE_STOCK = 8;
const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;

export interface BusinessSite {
  id: string;
  name: string;
}

export interface BusinessUser {
  id: string;
  email: string;
  password: string;
}

export interface BusinessProvider {
  id: string;
  name: string;
}

export interface SeededBusinessProduct {
  id: string;
  name: string;
  sku: string;
  stockPerSite: number;
  totalStock: number;
  siteStockBySiteId: Record<string, number>;
}

export interface SeededSaleScenario {
  tenantId: string;
  sites: BusinessSite[];
  cashier: BusinessUser;
  manager: BusinessUser;
  admin: BusinessUser;
  product: SeededBusinessProduct;
}

export interface SeededPurchaseScenario extends SeededSaleScenario {
  provider: BusinessProvider;
}

export interface SeededCashSessionScenario extends SeededSaleScenario {
  activeSite: BusinessSite;
  cashSessionId: string;
  registerName: string;
  expectedBalance: number;
}

export interface SeededFiscalProfileScenario {
  tenantId: string;
  site: BusinessSite;
  admin: BusinessUser;
}

export interface SaleRecord {
  id: string;
  saleNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdBy: string;
  siteId: string | null;
  siteName: string | null;
}

export interface SaleReturnRecord {
  id: string;
  saleId: string;
  total: number;
}

export interface PurchaseRecord {
  id: string;
  purchaseNumber: string;
  status: string;
  total: number;
  createdBy: string;
  providerId: string;
  providerName: string | null;
  siteId: string;
  siteName: string | null;
}

export interface PurchaseReturnRecord {
  id: string;
  purchaseId: string;
  total: number;
  reason: string | null;
}

export interface AuditLogRecord {
  id: string;
  action: string;
  resourceId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface InventoryBalanceRecord {
  onHand: number;
  reserved: number;
}

export interface TransferRecord {
  id: string;
  status: string;
  fromSiteId: string;
  toSiteId: string;
  createdBy: string;
  notes: string | null;
  discrepancyNotes: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
}

export interface TransferItemRecord {
  id: string;
  transferOrderId: string;
  productId: string;
  quantity: number;
  receivedQuantity: number | null;
}

/** Reset the dedicated ENG-202 tenant before each attempt, including retries. */
export async function resetFirstSaleScenario(): Promise<void> {
  const db = openDb();
  try {
    await prepareFirstSaleBaseline(db);
  } finally {
    db.close();
  }
}

export interface CashSessionRecord {
  id: string;
  siteId: string;
  cashierId: string;
  registerName: string;
  status: string;
  openingFloat: number;
  expectedBalance: number;
  actualCount: number | null;
  overShort: number | null;
  openedAt: string;
  closedAt: string | null;
}

function getSqliteBusyTimeoutMs() {
  const raw = process.env.PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60_000) {
    throw new Error('PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS must be an integer from 0 to 60000');
  }
  return parsed;
}

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma(`busy_timeout = ${getSqliteBusyTimeoutMs()}`);
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
}

function readJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  return JSON.parse(value) as T;
}

function getTenantAndSites(db: Database): { tenantId: string; sites: BusinessSite[] } {
  const tenant = db
    .prepare<{
      id: string;
      name: string;
    }>('select id, name from tenants order by created_at asc limit 1')
    .get() as { id: string; name: string } | undefined;

  if (!tenant) {
    throw new Error('No tenant found in local.db');
  }

  // Match the server-side fallback site selection used when no x-site-id
  // header has been persisted yet. This keeps E2E seeded cash sessions on
  // the same site the UI selects on first login, even when the dev seed has
  // more than two active stores.
  const sites = db
    .prepare(
      'select id, name from sites where tenant_id = ? and is_active = 1 order by name asc, id asc limit 2'
    )
    .all(tenant.id) as BusinessSite[];

  if (sites.length < 2) {
    throw new Error('Business E2E requires at least 2 active sites');
  }

  return { tenantId: tenant.id, sites };
}

function getPasswordHash(db: Database, email: string): string {
  const template = db.prepare('select password_hash from users where email = ?').get(email) as
    { password_hash?: string } | undefined;

  if (!template?.password_hash) {
    throw new Error(`Template user ${email} not found`);
  }

  return template.password_hash;
}

function seedBusinessUser(
  db: ReturnType<typeof openDb>,
  args: {
    tenantId: string;
    sites: BusinessSite[];
    role: 'admin' | 'manager' | 'cashier';
    templateEmail: string;
    seed: string;
  }
): BusinessUser {
  const passwordHash = getPasswordHash(db, args.templateEmail);
  const now = nowIso();
  const userId = makeId(`e2e_${args.role}`);
  const email = `e2e.${args.role}.${args.seed}.${randomUUID().slice(0, 8)}@local.test`;

  db.prepare(
    `insert into users (
      id, tenant_id, email, name, password_hash, session_version, role, is_active, created_at, updated_at
    ) values (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`
  ).run(
    userId,
    args.tenantId,
    email,
    `E2E ${args.role[0].toUpperCase()}${args.role.slice(1)} ${args.seed}`,
    passwordHash,
    args.role,
    now,
    now
  );

  for (const site of args.sites) {
    db.prepare(
      `insert into cash_sessions (
        id, tenant_id, site_id, cashier_id, register_name, opening_float,
        opening_count_denominations, expected_balance, actual_count,
        actual_count_denominations, over_short, status, opened_at,
        closed_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 0, '[]', 0, null, null, null, 'open', ?, null, ?, ?)`
    ).run(
      makeId(`e2e_${args.role}_session`),
      args.tenantId,
      site.id,
      userId,
      `E2E ${args.role} ${args.seed} ${site.name}`,
      now,
      now,
      now
    );
  }

  return {
    id: userId,
    email,
    password: E2E_PASSWORD,
  };
}

function getDefaultUnitId(db: Database): string {
  const unit = db
    .prepare('select id from units where is_active = 1 order by created_at asc, id asc limit 1')
    .get() as { id?: string } | undefined;

  if (!unit?.id) {
    throw new Error('No active unit found');
  }

  return unit.id;
}

function normalizeSeed(seed: string) {
  return seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 24);
}

function seedBusinessActors(db: Database, seed: string) {
  const { tenantId, sites } = getTenantAndSites(db);
  const suffix = normalizeSeed(seed);

  const cashier = seedBusinessUser(db, {
    tenantId,
    sites,
    role: 'cashier',
    templateEmail: 'e2e.cashier@local.test',
    seed: suffix,
  });
  const manager = seedBusinessUser(db, {
    tenantId,
    sites,
    role: 'manager',
    templateEmail: 'e2e.manager@local.test',
    seed: suffix,
  });
  const admin = seedBusinessUser(db, {
    tenantId,
    sites,
    role: 'admin',
    templateEmail: 'e2e.admin@local.test',
    seed: suffix,
  });

  return { tenantId, sites, cashier, manager, admin, suffix };
}

function seedBusinessProduct(
  db: Database,
  args: {
    tenantId: string;
    sites: BusinessSite[];
    seed: string;
    siteStocks: number[];
  }
): SeededBusinessProduct {
  const unitId = getDefaultUnitId(db);
  const now = nowIso();
  const productId = makeId('e2e_product');
  const uniqueSuffix = randomUUID().slice(0, 6).toUpperCase();
  const sku = `E2E-${args.seed.toUpperCase().slice(0, 12)}-${uniqueSuffix}`;
  // Bake the unique suffix into the product name so tests that search by
  // name still narrow to a single product even when `seed` collides across
  // runs (the seed is based on `parallelIndex-Date.now()` and the 24-char
  // `normalizeSeed` truncation lets same-minute runs share a prefix).
  const productName = `E2E ${args.seed} ${uniqueSuffix} Product`;
  const stockBySiteId = Object.fromEntries(
    args.sites.map((site, index) => [site.id, args.siteStocks[index] ?? 0])
  );
  const totalStock = Object.values(stockBySiteId).reduce((sum, stock) => sum + stock, 0);

  db.prepare(
    `insert into products (
      id, tenant_id, name, sku, price, price2, price3, cost, initial_cost,
      min_stock, sell_by_fraction, is_active, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
  ).run(productId, args.tenantId, productName, sku, 12500, 12500, 12500, 7500, 7500, 1, now, now);

  db.prepare(
    `insert into unit_x_product (
      id, product_id, unit_id, equivalence, price, is_base, created_at, updated_at
    ) values (?, ?, ?, 1, ?, 1, ?, ?)`
  ).run(makeId('e2e_unit_product'), productId, unitId, 12500, now, now);

  for (const site of args.sites) {
    db.prepare(
      `insert into inventory_balances (
        id, tenant_id, site_id, product_id, on_hand, reserved,
        sync_status, sync_version, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 0, 'pending', 0, ?, ?)`
    ).run(
      makeId('e2e_balance'),
      args.tenantId,
      site.id,
      productId,
      stockBySiteId[site.id] ?? 0,
      now,
      now
    );
  }

  return {
    id: productId,
    name: productName,
    sku,
    stockPerSite: stockBySiteId[args.sites[0]?.id ?? ''] ?? 0,
    totalStock,
    siteStockBySiteId: stockBySiteId,
  };
}

function seedProvider(db: Database, tenantId: string, seed: string): BusinessProvider {
  const id = makeId('e2e_provider');
  const now = nowIso();
  const name = `E2E Provider ${seed} ${randomUUID().slice(0, 6)}`;

  db.prepare(
    `insert into providers (
      id, tenant_id, name, is_active, created_at, updated_at
    ) values (?, ?, ?, 1, ?, ?)`
  ).run(id, tenantId, name, now, now);

  return { id, name };
}

function getOpenCashSessionId(db: Database, cashierId: string, siteId: string): string {
  const session = db
    .prepare(
      `select id
     from cash_sessions
     where cashier_id = ? and site_id = ? and status = 'open'
     order by created_at desc, id desc
     limit 1`
    )
    .get(cashierId, siteId) as { id?: string } | undefined;

  if (!session?.id) {
    throw new Error(`Open cash session not found for cashier ${cashierId} at site ${siteId}`);
  }

  return session.id;
}

function seedScenario(
  seed: string,
  options?: {
    siteStocks?: number[];
  }
): SeededSaleScenario {
  const db = openDb();

  try {
    const actors = seedBusinessActors(db, seed);
    const siteStocks = options?.siteStocks ?? actors.sites.map(() => SITE_STOCK);
    const product = seedBusinessProduct(db, {
      tenantId: actors.tenantId,
      sites: actors.sites,
      seed: actors.suffix,
      siteStocks,
    });

    return {
      tenantId: actors.tenantId,
      sites: actors.sites,
      cashier: actors.cashier,
      manager: actors.manager,
      admin: actors.admin,
      product,
    };
  } finally {
    db.close();
  }
}

export function seedSaleScenario(seed: string): SeededSaleScenario {
  return seedScenario(seed);
}

export function seedPurchaseScenario(seed: string): SeededPurchaseScenario {
  const scenario = seedScenario(seed);
  const db = openDb();

  try {
    const provider = seedProvider(db, scenario.tenantId, normalizeSeed(seed));
    return { ...scenario, provider };
  } finally {
    db.close();
  }
}

export function seedTransferScenario(seed: string): SeededSaleScenario {
  return seedScenario(seed, { siteStocks: [SITE_STOCK, 0] });
}

/** Seed an isolated CO tenant so fiscal-profile import never mutates shared demo settings. */
export function seedFiscalProfileScenario(seed: string): SeededFiscalProfileScenario {
  const db = openDb();
  try {
    const suffix = `${normalizeSeed(seed)}-${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    const tenantId = makeId('e2e_fiscal_tenant');
    const companyId = makeId('e2e_fiscal_company');
    const siteId = makeId('e2e_fiscal_site');
    const adminId = makeId('e2e_fiscal_admin');
    const email = `e2e.fiscal.admin.${suffix}@local.test`;
    const site = { id: siteId, name: `E2E Fiscal Site ${suffix}` };
    const passwordHash = getPasswordHash(db, 'e2e.admin@local.test');

    db.transaction(() => {
      db.prepare(
        `insert into tenants (
          id, name, slug, settings, default_currency_code, is_active, created_at, updated_at
        ) values (?, ?, ?, ?, 'COP', 1, ?, ?)`
      ).run(
        tenantId,
        `E2E Fiscal Tenant ${suffix}`,
        `e2e-fiscal-${suffix}`,
        JSON.stringify({ modules: {} }),
        now,
        now
      );
      db.prepare(
        `insert into companies (id, tenant_id, name, created_at, updated_at)
         values (?, ?, ?, ?, ?)`
      ).run(companyId, tenantId, `E2E Fiscal Company ${suffix}`, now, now);
      db.prepare(
        `insert into sites (
          id, tenant_id, company_id, name, is_active, created_at, updated_at
        ) values (?, ?, ?, ?, 1, ?, ?)`
      ).run(siteId, tenantId, companyId, site.name, now, now);
      db.prepare(
        `insert into tenant_locale_settings (
          tenant_id, country_code, version, updated_at
        ) values (?, 'CO', 1, ?)`
      ).run(tenantId, now);
      db.prepare(
        `insert into users (
          id, tenant_id, email, name, password_hash, session_version,
          role, is_active, created_at, updated_at
        ) values (?, ?, ?, ?, ?, 1, 'admin', 1, ?, ?)`
      ).run(adminId, tenantId, email, `E2E Fiscal Admin ${suffix}`, passwordHash, now, now);
    })();

    return {
      tenantId,
      site,
      admin: { id: adminId, email, password: E2E_PASSWORD },
    };
  } finally {
    db.close();
  }
}

/**
 * Seeds a fresh cashier with NO open cash sessions. Use this when the
 * test needs to exercise the "open session from zero" flow (CASH-01 /
 * CASH-02 / CASH-03) — `seedSaleScenario` always opens a session per
 * site by default, which short-circuits the open-modal test path.
 *
 * The tenant, product, and sites are still seeded identically to the
 * default scenario so inventory assertions continue to work.
 */
export function seedCashierWithoutSession(seed: string): SeededSaleScenario {
  const scenario = seedScenario(seed);
  const db = openDb();

  try {
    const now = nowIso();

    // 1. Close every open session the default seed opened for this
    //    cashier so the UI treats them as "no active register".
    db.prepare(
      `update cash_sessions
         set status = 'closed',
             closed_at = ?,
             actual_count = 0,
             over_short = 0 - expected_balance,
             updated_at = ?
       where cashier_id = ? and status = 'open'`
    ).run(now, now, scenario.cashier.id);

    // 2. Free up the default register templates (names like "Main
    //    register") at this tenant's sites. Leftover admin@localhost or
    //    prior-cashier sessions can occupy the template and disable the
    //    Open cash session CTA — we want this scenario to hit the
    //    happy path where the template is free.
    //
    //    We scope to the template registerName (exact match) so we only
    //    touch sessions that would conflict with the open-session modal.
    const templates = db
      .prepare(
        `select register_name from denomination_templates
         where tenant_id = ? and is_active = 1`
      )
      .all(scenario.tenantId) as Array<{ register_name: string }>;

    for (const template of templates) {
      db.prepare(
        `update cash_sessions
           set status = 'closed',
               closed_at = ?,
               actual_count = 0,
               over_short = 0 - expected_balance,
               updated_at = ?
         where tenant_id = ? and status = 'open' and register_name = ?`
      ).run(now, now, scenario.tenantId, template.register_name);
    }

    return scenario;
  } finally {
    db.close();
  }
}

export function seedCashSessionScenario(seed: string): SeededCashSessionScenario {
  const scenario = seedScenario(seed);
  const db = openDb();

  try {
    const activeSite = scenario.sites[0]!;
    const cashSessionId = getOpenCashSessionId(db, scenario.cashier.id, activeSite.id);
    const expectedBalance = 1000;
    const registerName = `E2E Close ${normalizeSeed(seed)} ${randomUUID().slice(0, 4)}`;
    const now = nowIso();

    db.prepare(
      `update cash_sessions
       set register_name = ?, opening_float = ?, expected_balance = ?,
           opening_count_denominations = ?, updated_at = ?
       where id = ?`
    ).run(
      registerName,
      expectedBalance,
      expectedBalance,
      JSON.stringify([{ value: 1000, count: 1 }]),
      now,
      cashSessionId
    );

    return {
      ...scenario,
      activeSite,
      cashSessionId,
      registerName,
      expectedBalance,
    };
  } finally {
    db.close();
  }
}

export function findLatestSaleForProduct(productId: string, createdBy: string): SaleRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        sales.id as id,
        sales.sale_number as saleNumber,
        sales.status as status,
        sales.payment_status as paymentStatus,
        sales.total as total,
        sales.created_by as createdBy,
        cash_sessions.site_id as siteId,
        sites.name as siteName
      from sales
      inner join sale_items on sale_items.sale_id = sales.id
      left join cash_sessions on cash_sessions.id = sales.cash_session_id
      left join sites on sites.id = cash_sessions.site_id
      where sale_items.product_id = ? and sales.created_by = ?
      order by sales.created_at desc, sales.id desc
      limit 1`
      )
      .get(productId, createdBy) as SaleRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getProductStock(productId: string): number | null {
  const db = openDb();

  try {
    const row = db
      .prepare('select sum(on_hand) as stock from inventory_balances where product_id = ?')
      .get(productId) as { stock?: number | null } | undefined;

    return row?.stock ?? null;
  } finally {
    db.close();
  }
}

export function getInventoryBalance(
  siteId: string,
  productId: string
): InventoryBalanceRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        'select on_hand as onHand, reserved from inventory_balances where site_id = ? and product_id = ?'
      )
      .get(siteId, productId) as InventoryBalanceRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getSaleById(saleId: string): SaleRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        sales.id as id,
        sales.sale_number as saleNumber,
        sales.status as status,
        sales.payment_status as paymentStatus,
        sales.total as total,
        sales.created_by as createdBy,
        cash_sessions.site_id as siteId,
        sites.name as siteName
      from sales
      left join cash_sessions on cash_sessions.id = sales.cash_session_id
      left join sites on sites.id = cash_sessions.site_id
      where sales.id = ?`
      )
      .get(saleId) as SaleRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getSaleReturnBySaleId(saleId: string): SaleReturnRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        'select id, sale_id as saleId, refund_amount as total from sale_returns where sale_id = ?'
      )
      .get(saleId) as SaleReturnRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function findLatestPurchaseForProduct(
  productId: string,
  createdBy: string
): PurchaseRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        purchases.id as id,
        purchases.purchase_number as purchaseNumber,
        purchases.status as status,
        purchases.total as total,
        purchases.created_by as createdBy,
        purchases.provider_id as providerId,
        providers.name as providerName,
        purchases.site_id as siteId,
        sites.name as siteName
      from purchases
      inner join purchase_items on purchase_items.purchase_id = purchases.id
      left join providers on providers.id = purchases.provider_id
      left join sites on sites.id = purchases.site_id
      where purchase_items.product_id = ? and purchases.created_by = ?
      order by purchases.created_at desc, purchases.id desc
      limit 1`
      )
      .get(productId, createdBy) as PurchaseRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getPurchaseById(purchaseId: string): PurchaseRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        purchases.id as id,
        purchases.purchase_number as purchaseNumber,
        purchases.status as status,
        purchases.total as total,
        purchases.created_by as createdBy,
        purchases.provider_id as providerId,
        providers.name as providerName,
        purchases.site_id as siteId,
        sites.name as siteName
      from purchases
      left join providers on providers.id = purchases.provider_id
      left join sites on sites.id = purchases.site_id
      where purchases.id = ?`
      )
      .get(purchaseId) as PurchaseRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getPurchaseReturnByPurchaseId(purchaseId: string): PurchaseReturnRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        id,
        purchase_id as purchaseId,
        return_amount as total,
        reason
       from purchase_returns
       where purchase_id = ?
       order by created_at desc, id desc
       limit 1`
      )
      .get(purchaseId) as PurchaseReturnRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function findLatestTransferByNotes(notes: string): TransferRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        id,
        status,
        from_site_id as fromSiteId,
        to_site_id as toSiteId,
        created_by as createdBy,
        notes,
        discrepancy_notes as discrepancyNotes,
        received_at as receivedAt,
        received_by as receivedBy
       from transfer_orders
       where notes = ?
       order by created_at desc, id desc
       limit 1`
      )
      .get(notes) as TransferRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getTransferById(transferId: string): TransferRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        id,
        status,
        from_site_id as fromSiteId,
        to_site_id as toSiteId,
        created_by as createdBy,
        notes,
        discrepancy_notes as discrepancyNotes,
        received_at as receivedAt,
        received_by as receivedBy
       from transfer_orders
       where id = ?`
      )
      .get(transferId) as TransferRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getTransferItems(transferId: string): TransferItemRecord[] {
  const db = openDb();

  try {
    return db
      .prepare(
        `select
        id,
        transfer_order_id as transferOrderId,
        product_id as productId,
        quantity,
        received_quantity as receivedQuantity
       from transfer_order_items
       where transfer_order_id = ?
       order by created_at asc, id asc`
      )
      .all(transferId) as TransferItemRecord[];
  } finally {
    db.close();
  }
}

export function getLatestCashSessionForCashierSite(
  cashierId: string,
  siteId: string
): CashSessionRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        id,
        site_id as siteId,
        cashier_id as cashierId,
        register_name as registerName,
        status,
        opening_float as openingFloat,
        expected_balance as expectedBalance,
        actual_count as actualCount,
        over_short as overShort,
        opened_at as openedAt,
        closed_at as closedAt
       from cash_sessions
       where cashier_id = ? and site_id = ?
       order by updated_at desc, created_at desc, id desc
       limit 1`
      )
      .get(cashierId, siteId) as CashSessionRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getAuditLog(action: string, resourceId: string): AuditLogRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select id, action, resource_id as resourceId, before, after, metadata
       from audit_logs
       where action = ? and resource_id = ?
       order by created_at desc, id desc
       limit 1`
      )
      .get(action, resourceId) as
      | {
          id: string;
          action: string;
          resourceId: string;
          before: string | null;
          after: string | null;
          metadata: string | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      action: row.action,
      resourceId: row.resourceId,
      before: readJson<Record<string, unknown>>(row.before),
      after: readJson<Record<string, unknown>>(row.after),
      metadata: readJson<Record<string, unknown>>(row.metadata),
    };
  } finally {
    db.close();
  }
}
