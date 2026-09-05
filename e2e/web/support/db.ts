import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { E2E_PASSWORD } from './app';

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

export interface BusinessCustomer {
  id: string;
  name: string;
}

export interface SeededBusinessProduct {
  id: string;
  name: string;
  sku: string;
  unitId: string;
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

export interface SeededPromotionCustomerValueScenario extends SeededSaleScenario {
  customer: BusinessCustomer;
  initialPoints: number;
  initialStoreCredit: number;
}

export interface SeededProviderPayableScenario extends SeededPurchaseScenario {
  purchase: { id: string; purchaseNumber: string; total: number };
}

export interface SeededCashSessionScenario extends SeededSaleScenario {
  activeSite: BusinessSite;
  cashSessionId: string;
  registerName: string;
  expectedBalance: number;
}

/** Isolated actors, site and product used by one restaurant-service browser journey. */
export type SeededRestaurantServiceScenario = SeededSaleScenario;

/** Tenant-scoped persisted projection asserted after a restaurant check settles. */
export interface RestaurantServiceEvidence {
  serviceId: string;
  serviceStatus: string;
  guestCount: number | null;
  checkId: string;
  checkStatus: string;
  checkLabel: string | null;
  saleId: string;
  saleStatus: string;
  saleTotal: number;
  dinerCount: number;
  lineCount: number;
  roundCount: number;
  courseKeys: string[];
  lines: Array<{
    note: string | null;
    seatNumber: number | null;
    modifierName: string | null;
    modifierPriceDelta: number | null;
  }>;
}

export interface SeededFiscalProfileScenario {
  tenantId: string;
  site: BusinessSite;
  admin: BusinessUser;
}

export interface SeededHourlyPayrollScenario extends SeededFiscalProfileScenario {
  worker: BusinessUser;
  workerName: string;
  expectedWorkedSeconds: number;
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

export interface SaleReturnPaymentAllocationRecord {
  salePaymentId: string | null;
  originalMethod: string;
  destination: string;
  amount: number;
  externalReference: string | null;
}

export interface SaleReturnPaymentEvidence extends SaleReturnPaymentAllocationRecord {
  loyaltyPoints: number | null;
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

export interface ProductRecord {
  id: string;
  name: string;
  sku: string;
  cost: number;
  initialCost: number;
  tracksLots: number;
  tracksSerials: number;
}

export interface InventoryLotRecord {
  id: string;
  siteId: string;
  productId: string;
  lotNumber: string;
  expiresAt: string | null;
  onHand: number;
  unitCost: number;
  status: string;
  sourcePurchaseItemId: string | null;
}

export interface InventoryTransformationEvidence {
  id: string;
  recipeName: string;
  status: string;
  inputProductId: string;
  inputLotNumber: string | null;
  inputQuantity: number;
  outputProductId: string;
  outputLotNumber: string | null;
  outputQuantity: number;
  totalInputCost: number;
  totalOutputCost: number;
}

export interface ProductSerialRecord {
  id: string;
  currentSiteId: string;
  productId: string;
  sourcePurchaseItemId: string | null;
  serialNumber: string;
  status: string;
}

export interface TransferSerialRecord {
  transferOrderItemId: string;
  productSerialId: string;
  serialNumber: string;
}

export interface CashSessionRecord {
  id: string;
  siteId: string;
  cashierId: string;
  employeeShiftId: string | null;
  registerName: string;
  status: string;
  openingFloat: number;
  expectedBalance: number;
  actualCount: number | null;
  overShort: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface EmployeeShiftRecord {
  id: string;
  tenantId: string;
  userId: string;
  siteId: string;
  clockedInAt: string;
  clockedOutAt: string | null;
}

export interface SalePaymentEvidence {
  method: string;
  amount: number;
  loyaltyPoints: number | null;
}

export interface SalePromotionEvidence {
  name: string;
  discountPct: number;
  discountAmount: number;
}

export interface CustomerValueEvidence {
  points: number;
  pointsLedger: number;
  storeCredit: number;
  storeCreditLedger: number;
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
    openCashSessions?: boolean;
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

  if (args.openCashSessions !== false) {
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
  }

  return {
    id: userId,
    email,
    password: E2E_PASSWORD,
  };
}

function getDefaultUnitId(db: Database, tenantId: string): string {
  const unit = db
    .prepare(
      `select id
       from units
       where tenant_id = ? and is_active = 1
       order by created_at asc, id asc
       limit 1`
    )
    .get(tenantId) as { id?: string } | undefined;

  if (!unit?.id) {
    throw new Error(`No active unit found for tenant ${tenantId}`);
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
    unitId?: string;
    sites: BusinessSite[];
    seed: string;
    siteStocks: number[];
  }
): SeededBusinessProduct {
  const unitId = args.unitId ?? getDefaultUnitId(db, args.tenantId);
  const tenantUnit = db
    .prepare('select id from units where id = ? and tenant_id = ? and is_active = 1')
    .get(unitId, args.tenantId) as { id?: string } | undefined;
  if (!tenantUnit?.id) {
    throw new Error(`Active unit ${unitId} does not belong to tenant ${args.tenantId}`);
  }
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
    unitId,
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

/**
 * Seed only the generic sale prerequisites for a restaurant journey, then
 * expose the three UI surfaces the browser must exercise. The table and check
 * themselves remain absent so Playwright has to create them through the same
 * admin/waiter paths an operator uses.
 */
export function seedRestaurantServiceScenario(seed: string): SeededRestaurantServiceScenario {
  const scenario = seedScenario(seed);
  const db = openDb();
  try {
    const updated = db
      .prepare(
        `update tenants
         set settings = json_set(
           case when json_valid(settings) then settings else '{}' end,
           '$.modules.dine-in', json('true'),
           '$.modules.mobile-waiter', json('true'),
           '$.modules.pos-touch', json('true')
         ),
         updated_at = ?
         where id = ?`
      )
      .run(nowIso(), scenario.tenantId);
    if (updated.changes !== 1) {
      throw new Error(`Expected one restaurant tenant update, updated ${updated.changes}`);
    }
    return scenario;
  } finally {
    db.close();
  }
}

/**
 * Seeds only the opening customer-value ledgers needed by the retail tender
 * journey. Promotion lifecycle, loyalty configuration and the sale itself are
 * intentionally absent: Playwright must create/configure/commit them through
 * the real UI. The signed opening movements keep the materialized balances
 * reconcilable instead of planting unexplained account totals.
 */
export function seedPromotionCustomerValueScenario(
  seed: string
): SeededPromotionCustomerValueScenario {
  const scenario = seedScenario(seed);
  const db = openDb();

  try {
    const now = nowIso();
    const suffix = `${normalizeSeed(seed)}-${randomUUID().slice(0, 6)}`;
    const customer: BusinessCustomer = {
      id: makeId('e2e_customer_value'),
      name: `E2E Customer Value ${suffix}`,
    };
    const loyaltyAccountId = makeId('e2e_loyalty_account');
    const storeCreditAccountId = makeId('e2e_store_credit_account');
    const initialPoints = 6;
    const initialStoreCredit = 2_500;

    db.transaction(() => {
      db.prepare(
        `insert into customers (
          id, tenant_id, name, is_active, created_at, updated_at
        ) values (?, ?, ?, 1, ?, ?)`
      ).run(customer.id, scenario.tenantId, customer.name, now, now);

      db.prepare(
        `insert into loyalty_accounts (
          id, tenant_id, customer_id, points, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?)`
      ).run(loyaltyAccountId, scenario.tenantId, customer.id, initialPoints, now, now);
      db.prepare(
        `insert into loyalty_movements (
          id, tenant_id, account_id, kind, points, note, created_by, created_at
        ) values (?, ?, ?, 'adjust', ?, ?, ?, ?)`
      ).run(
        makeId('e2e_loyalty_movement'),
        scenario.tenantId,
        loyaltyAccountId,
        initialPoints,
        'E2E opening points',
        scenario.admin.id,
        now
      );

      db.prepare(
        `insert into store_credit_accounts (
          id, tenant_id, customer_id, currency_code, balance,
          sync_status, sync_version, created_at, updated_at
        ) values (?, ?, ?, 'COP', ?, 'pending', 0, ?, ?)`
      ).run(storeCreditAccountId, scenario.tenantId, customer.id, initialStoreCredit, now, now);
      db.prepare(
        `insert into store_credit_movements (
          id, tenant_id, account_id, customer_id, kind, amount,
          balance_after, currency_code, note, created_by, created_at
        ) values (?, ?, ?, ?, 'adjust', ?, ?, 'COP', ?, ?, ?)`
      ).run(
        makeId('e2e_store_credit_movement'),
        scenario.tenantId,
        storeCreditAccountId,
        customer.id,
        initialStoreCredit,
        initialStoreCredit,
        'E2E opening store credit',
        scenario.admin.id,
        now
      );
    })();

    return { ...scenario, customer, initialPoints, initialStoreCredit };
  } finally {
    db.close();
  }
}

/**
 * Seeds one isolated login identity without cash-session or catalog fixtures.
 * Use it for auth lifecycle tests whose sessionVersion mutation must never
 * invalidate the shared demo accounts used by parallel journeys.
 */
export function seedAuthUser(
  seed: string,
  role: 'admin' | 'manager' | 'cashier' = 'admin'
): BusinessUser {
  const db = openDb();
  try {
    const { tenantId, sites } = getTenantAndSites(db);
    const suffix = normalizeSeed(seed);
    return seedBusinessUser(db, {
      tenantId,
      sites,
      role,
      templateEmail: `e2e.${role}@local.test`,
      seed: suffix,
      openCashSessions: false,
    });
  } finally {
    db.close();
  }
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

/**
 * One isolated retail shift fixture. The cashier starts without a drawer so
 * the browser must open and later reconcile it, while the product minimum is
 * deliberately above site stock so a blind count can feed a real replenishment
 * draft. No operational document is inserted here: count, order, receipt,
 * sale, return, payable and transfer must all be created through the UI.
 */
export function seedRetailDailyCycleScenario(seed: string): SeededPurchaseScenario {
  const scenario = seedCashierWithoutSession(seed);
  const db = openDb();

  try {
    const provider = seedProvider(db, scenario.tenantId, normalizeSeed(seed));
    const updated = db
      .prepare(
        `update products
         set min_stock = 10, updated_at = ?
         where tenant_id = ? and id = ?`
      )
      .run(nowIso(), scenario.tenantId, scenario.product.id);
    if (updated.changes !== 1) {
      throw new Error(`Expected one retail-cycle product update, updated ${updated.changes}`);
    }
    return { ...scenario, provider };
  } finally {
    db.close();
  }
}

/**
 * Seeds a completed historical receipt as the prerequisite for an AP journey.
 * The payable itself is intentionally absent: the UI must explicitly register
 * the supplier document instead of inferring debt from this purchase.
 */
export function seedProviderPayableScenario(seed: string): SeededProviderPayableScenario {
  const scenario = seedPurchaseScenario(seed);
  const db = openDb();
  try {
    const now = nowIso();
    const suffix = `${normalizeSeed(seed)}-${randomUUID().slice(0, 6)}`;
    const purchase = {
      id: makeId('e2e_payable_purchase'),
      purchaseNumber: `COM-AP-${suffix}`,
      total: 12_500,
    };
    const unitId = scenario.product.unitId;
    db.transaction(() => {
      db.prepare(
        `insert into purchases (
          id, tenant_id, purchase_number, provider_id, site_id, status,
          subtotal, total, notes, created_by, sync_status, sync_version,
          created_at, updated_at
        ) values (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, 'pending', 1, ?, ?)`
      ).run(
        purchase.id,
        scenario.tenantId,
        purchase.purchaseNumber,
        scenario.provider.id,
        scenario.sites[0]!.id,
        purchase.total,
        purchase.total,
        'E2E supplier document pending',
        scenario.manager.id,
        now,
        now
      );
      db.prepare(
        `insert into purchase_items (
          id, purchase_id, product_id, quantity, unit_id, unit_equivalence,
          cost_per_unit, base_unit_cost, total
        ) values (?, ?, ?, 1, ?, 1, ?, ?, ?)`
      ).run(
        makeId('e2e_payable_purchase_item'),
        purchase.id,
        scenario.product.id,
        unitId,
        purchase.total,
        purchase.total,
        purchase.total
      );
    })();
    return { ...scenario, purchase };
  } finally {
    db.close();
  }
}

export function getProviderPayableTotals(providerId: string): {
  invoices: number;
  payments: number;
  credits: number;
  allocations: number;
  balance: number;
} {
  const db = openDb();
  try {
    const row = db
      .prepare(
        `select
          (select coalesce(sum(amount), 0) from provider_payable_invoices where provider_id = ?) as invoices,
          (select coalesce(sum(amount), 0) from provider_payable_payments where provider_id = ?) as payments,
          (select coalesce(sum(amount), 0) from provider_payable_credits where provider_id = ?) as credits,
          (select coalesce(sum(amount), 0) from provider_payable_allocations where provider_id = ?) as allocations`
      )
      .get(providerId, providerId, providerId, providerId) as {
      invoices: number;
      payments: number;
      credits: number;
      allocations: number;
    };
    const invoices = Number(row.invoices);
    const payments = Number(row.payments);
    const credits = Number(row.credits);
    const allocations = Number(row.allocations);
    return { invoices, payments, credits, allocations, balance: invoices - payments - credits };
  } finally {
    db.close();
  }
}

/**
 * Simulates the provider master-data lifecycle without going through the
 * admin-only directory. Supplier-account history must remain reachable after
 * a provider is deactivated, so the payable journey deliberately changes the
 * flag underneath the manager session and reloads the read side.
 */
export function setProviderActive(tenantId: string, providerId: string, active: boolean): void {
  const db = openDb();
  try {
    const result = db
      .prepare(
        `update providers
         set is_active = ?, updated_at = ?
         where tenant_id = ? and id = ?`
      )
      .run(active ? 1 : 0, nowIso(), tenantId, providerId);
    if (result.changes !== 1) {
      throw new Error(`Expected one provider state change, updated ${result.changes}`);
    }
  } finally {
    db.close();
  }
}

export function seedTransferScenario(seed: string): SeededSaleScenario {
  return seedScenario(seed, { siteStocks: [SITE_STOCK, 0] });
}

function seedIsolatedAdminTenant(
  seed: string,
  namespace: 'fiscal' | 'surface',
  modules: Record<string, boolean>
): SeededFiscalProfileScenario {
  const db = openDb();
  try {
    const suffix = `${normalizeSeed(seed)}-${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    const tenantId = makeId(`e2e_${namespace}_tenant`);
    const companyId = makeId(`e2e_${namespace}_company`);
    const siteId = makeId(`e2e_${namespace}_site`);
    const adminId = makeId(`e2e_${namespace}_admin`);
    const email = `e2e.${namespace}.admin.${suffix}@local.test`;
    const label = namespace === 'fiscal' ? 'Fiscal' : 'Surface';
    const site = { id: siteId, name: `E2E ${label} Site ${suffix}` };
    const passwordHash = getPasswordHash(db, 'e2e.admin@local.test');

    db.transaction(() => {
      db.prepare(
        `insert into tenants (
          id, name, slug, settings, default_currency_code, is_active, created_at, updated_at
        ) values (?, ?, ?, ?, 'COP', 1, ?, ?)`
      ).run(
        tenantId,
        `E2E ${label} Tenant ${suffix}`,
        `e2e-${namespace}-${suffix}`,
        JSON.stringify({ modules }),
        now,
        now
      );
      db.prepare(
        `insert into companies (id, tenant_id, name, created_at, updated_at)
         values (?, ?, ?, ?, ?)`
      ).run(companyId, tenantId, `E2E ${label} Company ${suffix}`, now, now);
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
      ).run(adminId, tenantId, email, `E2E ${label} Admin ${suffix}`, passwordHash, now, now);
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

/** Seed an isolated CO tenant so fiscal-profile import never mutates shared demo settings. */
export function seedFiscalProfileScenario(seed: string): SeededFiscalProfileScenario {
  return seedIsolatedAdminTenant(seed, 'fiscal', {});
}

/**
 * Seed an isolated tenant for direct surface-route gates. Module toggles are
 * tenant-wide, so using the shared demo tenant would race unrelated journeys.
 */
export function seedSurfaceGateScenario(
  seed: string,
  modules: Record<string, boolean>
): SeededFiscalProfileScenario {
  return seedIsolatedAdminTenant(seed, 'surface', modules);
}

/** Isolated pharmacy setup evidence for the live vertical-readiness journey. */
export function seedVerticalReadinessScenario(seed: string): SeededFiscalProfileScenario {
  const scenario = seedSurfaceGateScenario(seed, {});
  const db = openDb();
  try {
    const now = nowIso();
    const unitId = makeId('e2e_vertical_unit');
    const products = [
      {
        id: makeId('e2e_vertical_otc'),
        name: 'E2E Registered OTC',
        sku: `E2E-VR-OTC-${normalizeSeed(seed)}`,
        classification: 'otc',
        registration: 'INVIMA-E2E-OTC',
      },
      {
        id: makeId('e2e_vertical_controlled'),
        name: 'E2E Controlled review item',
        sku: `E2E-VR-CTRL-${normalizeSeed(seed)}`,
        classification: 'controlled',
        registration: 'INVIMA-E2E-CTRL',
      },
    ] as const;

    db.transaction(() => {
      db.prepare('update tenants set settings = ?, updated_at = ? where id = ?').run(
        JSON.stringify({ businessType: 'pharmacy', modules: {} }),
        now,
        scenario.tenantId
      );
      db.prepare(
        `insert into units (
          id, tenant_id, name, abbreviation, dimension, standard_code,
          reference_factor, is_active, created_at, updated_at
        ) values (?, ?, 'Unit', 'u', 'count', 'H87', 1, 1, ?, ?)`
      ).run(unitId, scenario.tenantId, now, now);

      for (const product of products) {
        db.prepare(
          `insert into products (
            id, tenant_id, name, sku, price, price2, price3, cost,
            initial_cost, tracks_lots, is_active, created_at, updated_at
          ) values (?, ?, ?, ?, 12500, 12500, 12500, 7500, 7500, 1, 1, ?, ?)`
        ).run(product.id, scenario.tenantId, product.name, product.sku, now, now);
        db.prepare(
          `insert into unit_x_product (
            id, product_id, unit_id, equivalence, price, is_base, created_at, updated_at
          ) values (?, ?, ?, 1, 12500, 1, ?, ?)`
        ).run(makeId('e2e_vertical_product_unit'), product.id, unitId, now, now);
        db.prepare(
          `insert into pharmacy_product_profiles (
            product_id, tenant_id, classification, sanitary_registration,
            sanitary_registration_normalized, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          product.id,
          scenario.tenantId,
          product.classification,
          product.registration,
          product.registration.toLowerCase(),
          now,
          now
        );
      }
    })();
    return scenario;
  } finally {
    db.close();
  }
}

/**
 * Seed exact one-second attendance so the live payroll UI cannot hide a lossy
 * decimal-hours round trip. Period, run and revision remain UI-owned.
 */
export function seedHourlyPayrollScenario(seed: string): SeededHourlyPayrollScenario {
  const scenario = seedSurfaceGateScenario(seed, {});
  const db = openDb();
  try {
    const suffix = normalizeSeed(seed);
    const workerName = `E2E Cashier ${suffix}`;
    const worker = seedBusinessUser(db, {
      tenantId: scenario.tenantId,
      sites: [scenario.site],
      role: 'cashier',
      templateEmail: 'e2e.cashier@local.test',
      seed: suffix,
      openCashSessions: false,
    });
    const now = nowIso();
    db.transaction(() => {
      db.prepare(
        `insert into employment_contracts (
          id, tenant_id, user_id, site_id, position, effective_from, time_zone,
          currency_code, pay_basis, pay_amount, version, created_by_user_id,
          updated_by_user_id, created_at, updated_at
        ) values (?, ?, ?, ?, 'Hourly payroll probe', '2026-01-01', 'America/Bogota',
          'COP', 'hourly', 36000, 1, ?, ?, ?, ?)`
      ).run(
        makeId('e2e_hourly_contract'),
        scenario.tenantId,
        worker.id,
        scenario.site.id,
        scenario.admin.id,
        scenario.admin.id,
        now,
        now
      );
      db.prepare(
        `insert into payroll_employee_profiles (
          id, tenant_id, user_id, site_id, country_code, identification_type,
          identification_number, contributor_type, contract_kind, integral_salary,
          arl_risk_class, transport_assistance_eligible, payment_method,
          effective_from, version, created_by_user_id, updated_by_user_id,
          created_at, updated_at
        ) values (?, ?, ?, ?, 'CO', 'CC', ?, '01', 'indefinite', 0, 1, 0,
          'cash', '2026-01-01', 1, ?, ?, ?, ?)`
      ).run(
        makeId('e2e_hourly_profile'),
        scenario.tenantId,
        worker.id,
        scenario.site.id,
        `8${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        scenario.admin.id,
        scenario.admin.id,
        now,
        now
      );
      db.prepare(
        `insert into employee_shifts (
          id, tenant_id, user_id, site_id, clocked_in_at, clocked_out_at,
          created_at, updated_at
        ) values (?, ?, ?, ?, '2026-08-03T12:00:00.000Z',
          '2026-08-03T12:00:01.000Z', ?, ?)`
      ).run(makeId('e2e_hourly_shift'), scenario.tenantId, worker.id, scenario.site.id, now, now);
    })();
    return { ...scenario, worker, workerName, expectedWorkedSeconds: 1 };
  } finally {
    db.close();
  }
}

/**
 * Populate an isolated restaurant site beyond the administrative page size.
 * The final row sorts outside page one and contains literal SQLite LIKE
 * metacharacters so the browser journey proves both remote pagination and
 * escaped server-side search without sharing mutable catalog state.
 */
export function seedRestaurantTableCatalog(
  scenario: SeededFiscalProfileScenario,
  totalTables = 101
): { targetName: string; totalTables: number } {
  if (!Number.isInteger(totalTables) || totalTables < 101 || totalTables > 500) {
    throw new Error('Restaurant table catalog fixture requires between 101 and 500 tables');
  }

  const db = openDb();
  try {
    const now = nowIso();
    const targetName = `ZZ Literal %_! ${randomUUID().slice(0, 8)}`;
    const insertTable = db.prepare(
      `insert into restaurant_tables (
        id, tenant_id, site_id, name, seat_count, area, notes,
        is_active, created_at, updated_at
      ) values (?, ?, ?, ?, 4, 'E2E Scale', null, 1, ?, ?)`
    );

    db.transaction(() => {
      for (let index = 1; index < totalTables; index += 1) {
        insertTable.run(
          makeId('e2e_restaurant_table'),
          scenario.tenantId,
          scenario.site.id,
          `E2E Catalog ${String(index).padStart(3, '0')}`,
          now,
          now
        );
      }
      insertTable.run(
        makeId('e2e_restaurant_table'),
        scenario.tenantId,
        scenario.site.id,
        targetName,
        now,
        now
      );
    })();

    return { targetName, totalTables };
  } finally {
    db.close();
  }
}

/**
 * Seeds a fresh cashier with NO open cash sessions. Use this when the
 * test needs to exercise the "open session from zero" flow;
 * `seedSaleScenario` always opens a session per
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
    const seedAvailableRegisters = db.transaction(() => {
      // Close only the sessions owned by this fresh cashier. Closing every
      // session that matches an active template is not parallel-safe: opening
      // a register creates a template, so another worker seeding this helper
      // could close a live session from an unrelated scenario.
      db.prepare(
        `update cash_sessions
           set status = 'closed',
               closed_at = ?,
               actual_count = 0,
               over_short = 0 - expected_balance,
               updated_at = ?
         where cashier_id = ? and status = 'open'`
      ).run(now, now, scenario.cashier.id);

      // Give the scenario its own unoccupied assignment instead of freeing a
      // shared tenant template. Clone the site's denomination shape so modal
      // index-based E2E input remains representative of the production form.
      for (const site of scenario.sites) {
        const source = db
          .prepare(
            `select denominations, sort_order
             from denomination_templates
             where tenant_id = ? and site_id = ? and is_active = 1
             order by sort_order asc, id asc
             limit 1`
          )
          .get(scenario.tenantId, site.id) as
          { denominations: string | null; sort_order: number | null } | undefined;
        const registerName = `E2E Available ${scenario.cashier.id} ${site.id}`;

        db.prepare(
          `insert into denomination_templates (
             id, tenant_id, site_id, register_name, label, opening_float,
             denominations, sort_order, is_active, created_at, updated_at
           ) values (?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)`
        ).run(
          makeId('e2e_register_template'),
          scenario.tenantId,
          site.id,
          registerName,
          registerName,
          source?.denominations ?? '[]',
          (source?.sort_order ?? 0) - 1,
          now,
          now
        );
      }
    });

    seedAvailableRegisters();

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

/**
 * Seed one real open register and explicitly enable the local Customer Display
 * surface. The browser journey must still publish the cart through SalesPage;
 * this helper creates no display projection or sale data.
 */
export function seedCustomerDisplayScenario(seed: string): SeededCashSessionScenario {
  const scenario = seedCashSessionScenario(seed);
  const db = openDb();
  try {
    const now = nowIso();
    db.transaction(() => {
      const updated = db
        .prepare(
          `update tenants
           set settings = json_set(
             case when json_valid(settings) then settings else '{}' end,
             '$.modules.customer-display', json('true')
           ),
           updated_at = ?
           where id = ?`
        )
        .run(now, scenario.tenantId);
      if (updated.changes !== 1) {
        throw new Error(`Expected one Customer Display tenant update, updated ${updated.changes}`);
      }

      // seedCashSessionScenario renames a directly inserted cash session after
      // creation. Production openCashSession writes this template in the same
      // use case; mirror that invariant so the Sales register selector and its
      // locally paired Customer Display publisher agree on the register.
      const nextSortOrder = (
        db
          .prepare(
            `select coalesce(max(sort_order), -1) + 1 as value
             from denomination_templates
             where tenant_id = ? and site_id = ?`
          )
          .get(scenario.tenantId, scenario.activeSite.id) as { value: number }
      ).value;
      db.prepare(
        `insert into denomination_templates (
          id, tenant_id, site_id, register_name, label, opening_float,
          denominations, sort_order, is_active, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        makeId('e2e_customer_display_register'),
        scenario.tenantId,
        scenario.activeSite.id,
        scenario.registerName,
        scenario.registerName,
        scenario.expectedBalance,
        JSON.stringify([{ value: 1000, count: 1 }]),
        nextSortOrder,
        now,
        now
      );
    })();
    return scenario;
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

/** Read the frozen restaurant graph without going through renderer caches. */
export function getRestaurantServiceEvidence(
  tenantId: string,
  tableName: string,
  openedBy: string
): RestaurantServiceEvidence | null {
  const db = openDb();
  try {
    const header = db
      .prepare(
        `select
           service.id as serviceId,
           service.status as serviceStatus,
           service.guest_count as guestCount,
           check_row.id as checkId,
           check_row.status as checkStatus,
           check_row.label as checkLabel,
           sale.id as saleId,
           sale.status as saleStatus,
           sale.total as saleTotal
         from restaurant_services as service
         inner join restaurant_tables as table_row
           on table_row.id = service.table_id
          and table_row.tenant_id = service.tenant_id
         inner join restaurant_checks as check_row
           on check_row.service_id = service.id
          and check_row.tenant_id = service.tenant_id
         inner join sales as sale
           on sale.id = check_row.sale_id
          and sale.tenant_id = service.tenant_id
         where service.tenant_id = ?
           and table_row.name = ?
           and service.opened_by = ?
         order by service.created_at desc, check_row.created_at asc
         limit 1`
      )
      .get(tenantId, tableName, openedBy) as
      | {
          serviceId: string;
          serviceStatus: string;
          guestCount: number | null;
          checkId: string;
          checkStatus: string;
          checkLabel: string | null;
          saleId: string;
          saleStatus: string;
          saleTotal: number;
        }
      | undefined;
    if (!header) return null;

    const scalarCount = (table: string, column: string, id: string) =>
      Number(
        (
          db.prepare(`select count(*) as value from ${table} where ${column} = ?`).get(id) as {
            value: number;
          }
        ).value
      );
    const courseKeys = (
      db
        .prepare(
          `select course_key as courseKey
           from restaurant_courses
           where check_id = ?
           order by position asc, id asc`
        )
        .all(header.checkId) as Array<{ courseKey: string }>
    ).map(row => row.courseKey);
    const lines = db
      .prepare(
        `select
           item.notes as note,
           diner.seat_number as seatNumber,
           modifier.name as modifierName,
           modifier.unit_price_delta as modifierPriceDelta
         from restaurant_check_lines as line
         inner join sale_items as item on item.id = line.sale_item_id
         left join restaurant_diners as diner on diner.id = line.diner_id
         left join restaurant_line_modifiers as modifier on modifier.check_line_id = line.id
         where line.check_id = ?
         order by line.created_at asc, line.id asc, modifier.position asc`
      )
      .all(header.checkId) as RestaurantServiceEvidence['lines'];

    return {
      ...header,
      dinerCount: scalarCount('restaurant_diners', 'service_id', header.serviceId),
      lineCount: scalarCount('restaurant_check_lines', 'check_id', header.checkId),
      roundCount: scalarCount('restaurant_rounds', 'check_id', header.checkId),
      courseKeys,
      lines,
    };
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

export function getProductInventoryModes(productId: string): {
  tracksStock: boolean;
  tracksLots: boolean;
  tracksSerials: boolean;
} | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select tracks_stock as tracksStock,
                tracks_lots as tracksLots,
                tracks_serials as tracksSerials
         from products
         where id = ?`
      )
      .get(productId) as
      { tracksStock: number; tracksLots: number; tracksSerials: number } | undefined;
    return row
      ? {
          tracksStock: row.tracksStock === 1,
          tracksLots: row.tracksLots === 1,
          tracksSerials: row.tracksSerials === 1,
        }
      : null;
  } finally {
    db.close();
  }
}

export function getSalePaymentEvidence(tenantId: string, saleId: string): SalePaymentEvidence[] {
  const db = openDb();
  try {
    return db
      .prepare(
        `select method, amount, loyalty_points as loyaltyPoints
         from sale_payments
         where tenant_id = ? and sale_id = ?
         order by created_at asc, id asc`
      )
      .all(tenantId, saleId) as SalePaymentEvidence[];
  } finally {
    db.close();
  }
}

export function getSalePromotionEvidence(
  tenantId: string,
  saleId: string
): SalePromotionEvidence[] {
  const db = openDb();
  try {
    return db
      .prepare(
        `select
           snapshot.name_snapshot as name,
           snapshot.discount_pct as discountPct,
           snapshot.discount_amount as discountAmount
         from sale_item_promotions as snapshot
         inner join sale_items as item on item.id = snapshot.sale_item_id
         where snapshot.tenant_id = ? and item.sale_id = ?
         order by snapshot.position asc, snapshot.id asc`
      )
      .all(tenantId, saleId) as SalePromotionEvidence[];
  } finally {
    db.close();
  }
}

export function getCustomerValueEvidence(
  tenantId: string,
  customerId: string
): CustomerValueEvidence {
  const db = openDb();
  try {
    const loyalty = db
      .prepare(
        `select
           account.points,
           coalesce(sum(movement.points), 0) as pointsLedger
         from loyalty_accounts as account
         left join loyalty_movements as movement
           on movement.tenant_id = account.tenant_id
          and movement.account_id = account.id
         where account.tenant_id = ? and account.customer_id = ?
         group by account.id, account.points`
      )
      .get(tenantId, customerId) as { points: number; pointsLedger: number } | undefined;
    const storeCredit = db
      .prepare(
        `select
           account.balance as storeCredit,
           coalesce(sum(movement.amount), 0) as storeCreditLedger
         from store_credit_accounts as account
         left join store_credit_movements as movement
           on movement.tenant_id = account.tenant_id
          and movement.account_id = account.id
         where account.tenant_id = ? and account.customer_id = ? and account.currency_code = 'COP'
         group by account.id, account.balance`
      )
      .get(tenantId, customerId) as { storeCredit: number; storeCreditLedger: number } | undefined;

    return {
      points: Number(loyalty?.points ?? 0),
      pointsLedger: Number(loyalty?.pointsLedger ?? 0),
      storeCredit: Number(storeCredit?.storeCredit ?? 0),
      storeCreditLedger: Number(storeCredit?.storeCreditLedger ?? 0),
    };
  } finally {
    db.close();
  }
}

export function findProductBySku(sku: string): ProductRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
          id,
          name,
          sku,
          cost,
          initial_cost as initialCost,
          tracks_lots as tracksLots,
          tracks_serials as tracksSerials
        from products
        where sku = ?
        limit 1`
      )
      .get(sku) as ProductRecord | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getInventoryValuation(tenantId: string): number {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select coalesce(sum(coalesce(stock.total, 0) * product.initial_cost), 0) as totalValue
         from products as product
         left join product_stock_totals as stock
           on stock.tenant_id = product.tenant_id
          and stock.product_id = product.id
         where product.tenant_id = ?
           and product.is_active = 1
           and product.tracks_stock = 1`
      )
      .get(tenantId) as { totalValue: number } | undefined;

    return row?.totalValue ?? 0;
  } finally {
    db.close();
  }
}

export function getInventoryLots(productId: string): InventoryLotRecord[] {
  const db = openDb();

  try {
    return db
      .prepare(
        `select
          lot.id,
          lot.site_id as siteId,
          lot.product_id as productId,
          lot.lot_number as lotNumber,
          lot.expires_at as expiresAt,
          lot.on_hand as onHand,
          lot.unit_cost as unitCost,
          lot.status,
          purchase_lot.purchase_item_id as sourcePurchaseItemId
        from inventory_lots as lot
        left join purchase_item_lots as purchase_lot
          on purchase_lot.inventory_lot_id = lot.id
        where lot.product_id = ?
        order by lot.created_at asc, lot.id asc`
      )
      .all(productId) as InventoryLotRecord[];
  } finally {
    db.close();
  }
}

export function getLatestInventoryTransformation(
  recipeName: string
): InventoryTransformationEvidence | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
          transformation.id,
          transformation.recipe_name_snapshot as recipeName,
          transformation.status,
          input.product_id as inputProductId,
          input_lot.lot_number as inputLotNumber,
          input.base_quantity as inputQuantity,
          output.product_id as outputProductId,
          output.lot_number_snapshot as outputLotNumber,
          output.base_quantity as outputQuantity,
          transformation.total_input_cost as totalInputCost,
          transformation.total_output_cost as totalOutputCost
        from inventory_transformations as transformation
        join inventory_transformation_inputs as input
          on input.transformation_id = transformation.id
        left join inventory_lots as input_lot on input_lot.id = input.lot_id
        join inventory_transformation_outputs as output
          on output.transformation_id = transformation.id
        where transformation.recipe_name_snapshot = ?
        order by transformation.created_at desc, transformation.id desc
        limit 1`
      )
      .get(recipeName) as InventoryTransformationEvidence | undefined;

    return row ?? null;
  } finally {
    db.close();
  }
}

export function getProductSerials(productId: string): ProductSerialRecord[] {
  const db = openDb();

  try {
    return db
      .prepare(
        `select
          id,
          current_site_id as currentSiteId,
          product_id as productId,
          source_purchase_item_id as sourcePurchaseItemId,
          serial_number as serialNumber,
          status
        from product_serials
        where product_id = ?
        order by serial_number asc`
      )
      .all(productId) as ProductSerialRecord[];
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

/**
 * Models the bounded pre-sale_payments ticket shape used by migration and
 * compatibility tests. The sale must already be a real external-tender sale;
 * this helper removes only its later normalized tender rows.
 */
export function stripSalePaymentsForLegacyFixture(tenantId: string, saleId: string): void {
  const db = openDb();
  try {
    const sale = db
      .prepare(
        `select payment_method as paymentMethod
         from sales
         where tenant_id = ? and id = ?`
      )
      .get(tenantId, saleId) as { paymentMethod?: string } | undefined;
    if (!sale || !['card', 'transfer', 'other'].includes(sale.paymentMethod ?? '')) {
      throw new Error('Legacy external-tender fixture requires a tenant-owned external sale');
    }
    const removed = db
      .prepare('delete from sale_payments where tenant_id = ? and sale_id = ?')
      .run(tenantId, saleId);
    if (removed.changes < 1) {
      throw new Error('Legacy external-tender fixture expected at least one normalized payment');
    }
  } finally {
    db.close();
  }
}

export function getSaleReturnExternalEvidence(
  tenantId: string,
  saleId: string
): SaleReturnPaymentAllocationRecord | null {
  const db = openDb();
  try {
    const row = db
      .prepare(
        `select
           allocations.sale_payment_id as salePaymentId,
           allocations.original_method as originalMethod,
           allocations.destination as destination,
           allocations.amount as amount,
           allocations.external_reference as externalReference
         from sale_return_payment_allocations allocations
         inner join sale_returns returns
           on returns.id = allocations.sale_return_id
          and returns.tenant_id = allocations.tenant_id
         where allocations.tenant_id = ? and returns.sale_id = ?
         order by allocations.created_at desc, allocations.id desc
         limit 1`
      )
      .get(tenantId, saleId) as SaleReturnPaymentAllocationRecord | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

export function getSaleReturnPaymentEvidence(
  tenantId: string,
  saleId: string
): SaleReturnPaymentEvidence[] {
  const db = openDb();
  try {
    return db
      .prepare(
        `select
           allocations.sale_payment_id as salePaymentId,
           allocations.original_method as originalMethod,
           allocations.destination as destination,
           allocations.amount as amount,
           allocations.loyalty_points as loyaltyPoints,
           allocations.external_reference as externalReference
         from sale_return_payment_allocations allocations
         inner join sale_returns returns
           on returns.id = allocations.sale_return_id
          and returns.tenant_id = allocations.tenant_id
         where allocations.tenant_id = ? and returns.sale_id = ?
         order by allocations.created_at asc, allocations.id asc`
      )
      .all(tenantId, saleId) as SaleReturnPaymentEvidence[];
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

export function getTransferSerials(transferId: string): TransferSerialRecord[] {
  const db = openDb();

  try {
    return db
      .prepare(
        `select
          product_serial_transfers.transfer_order_item_id as transferOrderItemId,
          product_serial_transfers.product_serial_id as productSerialId,
          product_serial_transfers.serial_number as serialNumber
        from product_serial_transfers
        inner join transfer_order_items
          on transfer_order_items.id = product_serial_transfers.transfer_order_item_id
        where transfer_order_items.transfer_order_id = ?
        order by product_serial_transfers.serial_number asc`
      )
      .all(transferId) as TransferSerialRecord[];
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
        employee_shift_id as employeeShiftId,
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

export function getEmployeeShift(shiftId: string): EmployeeShiftRecord | null {
  const db = openDb();

  try {
    const row = db
      .prepare(
        `select
        id,
        tenant_id as tenantId,
        user_id as userId,
        site_id as siteId,
        clocked_in_at as clockedInAt,
        clocked_out_at as clockedOutAt
       from employee_shifts
       where id = ?`
      )
      .get(shiftId) as EmployeeShiftRecord | undefined;
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

/** Isolated delivery journey prerequisites; no sale, delivery or financial evidence is pre-created. */
function seedFulfillmentSaleScenario(seed: string, modules: Record<string, boolean>) {
  const base = seedSurfaceGateScenario(seed, modules);
  const db = openDb();
  try {
    const admin = seedBusinessUser(db, {
      tenantId: base.tenantId,
      sites: [base.site],
      role: 'admin',
      templateEmail: 'e2e.admin@local.test',
      seed: normalizeSeed(seed),
    });
    const unitId = makeId('e2e_delivery_unit');
    db.prepare('INSERT INTO units (id, tenant_id, name, abbreviation) VALUES (?, ?, ?, ?)').run(
      unitId,
      base.tenantId,
      'Unit',
      'un'
    );
    db.prepare(
      'INSERT INTO sequentials (id, tenant_id, site_id, document_type, prefix) VALUES (?, ?, ?, ?, ?)'
    ).run(makeId('e2e_delivery_seq'), base.tenantId, base.site.id, 'sale', 'DEL-');
    const product = seedBusinessProduct(db, {
      tenantId: base.tenantId,
      sites: [base.site],
      seed: normalizeSeed(seed),
      siteStocks: [8],
      unitId,
    });
    return { ...base, admin, product };
  } finally {
    db.close();
  }
}

/** Isolated prerequisites for sale-backed delivery; the journey creates its own financial records. */
export function seedDeliverySaleScenario(seed: string) {
  return seedFulfillmentSaleScenario(seed, { delivery: true });
}
/** Reservations and restaurant orders share one real isolated site/register/product setup. */
export function seedReservationSaleScenario(seed: string) {
  return seedFulfillmentSaleScenario(seed, {
    'dine-in': true,
    'mobile-waiter': true,
    'pos-touch': true,
  });
}

/** Fractional catalog prerequisite for external fulfillment; signed ingress and UI own all operational writes. */
export function seedExternalOrderScenario(seed: string) {
  const scenario = seedFulfillmentSaleScenario(seed, { delivery: true });
  const db = openDb();
  try {
    db.prepare(
      'UPDATE products SET sell_by_fraction = 1, fraction_step = 0.001, fraction_minimum = 0.001 WHERE tenant_id = ? AND id = ?'
    ).run(scenario.tenantId, scenario.product.id);
    return scenario;
  } finally {
    db.close();
  }
}
