/**
 * ENG-031 - Conversational analytics co-pilot.
 *
 * The model never queries the production SQLite connection directly. Its
 * `runReadOnlySQL` tool executes against a tenant-scoped, bounded in-memory
 * analytics snapshot built from completed sales only.
 *
 * @module services/ai/copilot
 */
import Database from 'better-sqlite3';
import { generateText, stepCountIs, tool } from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  customers,
  products,
  saleItems,
  sales,
  sites,
  users,
} from '../../db/schema.js';
import {
  ServerErrorWithCode,
  throwServerError,
  type ServerErrorCode,
} from '../../lib/errorCodes.js';

import { currentMonthSpend, recordCall } from './auditLog.js';
import type { AIInvocationContext, ProviderFactory } from './client.js';
import { getProvider, isNotImplemented } from './providers/registry.js';
import type { AIProvider } from './providers/types.js';
import { resolveAISettings } from './client.js';
import type { AISettings } from './types.js';

const DEFAULT_WINDOW_DAYS = 90;
const SALES_SNAPSHOT_ROW_LIMIT = 2_000;
const LINE_ITEMS_SNAPSHOT_ROW_LIMIT = 10_000;
const RESULT_ROW_LIMIT = 200;
const SQL_MAX_LENGTH = 3_000;

const ALLOWED_TABLES = new Set(['sales_summary', 'sale_line_items']);
const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|create|replace|truncate|merge|upsert|pragma|attach|detach|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|load_extension|readfile)\b/i;

export interface CopilotChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotContextInput {
  from?: string;
  to?: string;
  siteId?: string | null;
}

export interface CopilotChatInput {
  messages: CopilotChatMessage[];
  context?: CopilotContextInput;
}

export interface CopilotWindow {
  from: string;
  to: string;
  defaulted: boolean;
}

export type CopilotCellValue = string | number | null;
export type CopilotRow = Record<string, CopilotCellValue>;

export interface CopilotChart {
  type: 'bar';
  labelKey: string;
  valueKey: string;
}

export interface CopilotSQLResult {
  sql: string;
  columns: string[];
  rows: CopilotRow[];
  rowCount: number;
  truncated: boolean;
  chart: CopilotChart | null;
  window: CopilotWindow;
}

export interface CopilotChatResult extends CopilotSQLResult {
  answer: string;
  costUsd: number;
  durationMs: number;
  provider: string;
  model: string;
  auditLogId: string;
}

interface SnapshotOptions {
  query: string;
  context?: CopilotContextInput;
}

interface SnapshotRow {
  [key: string]: CopilotCellValue;
}

interface UsageShape {
  inputTokens?: unknown;
  outputTokens?: unknown;
  inputTokenDetails?: unknown;
}

interface CopilotRunOptions {
  factory?: ProviderFactory;
  now?: Date;
}

const defaultFactory: ProviderFactory = (id: AISettings['providerId']) => {
  const provider = getProvider(id);
  if (isNotImplemented(provider)) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `${provider.id} provider lands with ${provider.availableInTicket}`,
    });
  }
  return provider;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function usageNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const record = asRecord(value);
  if (record) {
    const total = record.total;
    return typeof total === 'number' && Number.isFinite(total) ? total : 0;
  }
  return 0;
}

function usageNestedNumber(value: unknown, key: string): number {
  const record = asRecord(value);
  if (!record) {
    return 0;
  }
  const nested = record[key];
  return typeof nested === 'number' && Number.isFinite(nested) ? nested : 0;
}

function resolveWindow(context: CopilotContextInput | undefined, now: Date): CopilotWindow {
  const to = context?.to ? new Date(context.to) : now;
  const from = context?.from
    ? new Date(context.from)
    : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_COPILOT_SQL_REJECTED',
      message: 'Invalid analytics date range',
    });
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    defaulted: !context?.from && !context?.to,
  };
}

function rejectSQL(message: string, details?: Record<string, unknown>): never {
  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'AI_COPILOT_SQL_REJECTED',
    message,
    details,
  });
}

function stripQuotedStrings(query: string): string {
  return query
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, '``');
}

function extractCTENames(query: string): Set<string> {
  const ctes = new Set<string>();
  if (!/^\s*with\b/i.test(query)) {
    return ctes;
  }

  for (const match of query.matchAll(/\b(?:with|,)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(/gi)) {
    ctes.add(match[1]!.toLowerCase());
  }
  return ctes;
}

function sanitizeTableName(raw: string): string {
  return raw.replace(/["'`[\]]/g, '').split('.')[0]!.toLowerCase();
}

export function validateReadOnlySQL(query: string): string {
  const normalized = query.trim();
  if (!normalized) {
    rejectSQL('SQL query is required');
  }
  if (normalized.length > SQL_MAX_LENGTH) {
    rejectSQL('SQL query is too long', { maxLength: SQL_MAX_LENGTH });
  }
  if (!/^(select|with)\b/i.test(normalized)) {
    rejectSQL('Only SELECT or WITH queries are allowed');
  }
  if (/[;]/.test(normalized)) {
    rejectSQL('Multiple SQL statements are not allowed');
  }
  if (/--|\/\*|\*\//.test(normalized)) {
    rejectSQL('SQL comments are not allowed');
  }

  const inspected = stripQuotedStrings(normalized);
  if (FORBIDDEN_SQL.test(inspected)) {
    rejectSQL('Only read-only analytics queries are allowed');
  }

  const cteNames = extractCTENames(inspected);
  for (const match of inspected.matchAll(/\b(?:from|join)\s+([`"]?[a-zA-Z_][a-zA-Z0-9_."`]*\]?)/gi)) {
    const table = sanitizeTableName(match[1]!);
    if (!ALLOWED_TABLES.has(table) && !cteNames.has(table)) {
      rejectSQL(`Table ${table} is not available in the analytics snapshot`, {
        allowedTables: Array.from(ALLOWED_TABLES),
      });
    }
  }

  return normalized;
}

function normalizeValue(value: unknown): CopilotCellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return String(value);
}

function normalizeRow(row: SnapshotRow): CopilotRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
  );
}

function inferChart(columns: string[], rows: CopilotRow[]): CopilotChart | null {
  if (rows.length === 0 || rows.length > 25) {
    return null;
  }

  const valueKey = columns.find(column =>
    rows.some(row => typeof row[column] === 'number')
  );
  if (!valueKey) {
    return null;
  }

  const labelKey =
    columns.find(column => column !== valueKey && rows.some(row => typeof row[column] === 'string')) ??
    columns.find(column => column !== valueKey) ??
    null;
  if (!labelKey) {
    return null;
  }

  return { type: 'bar', labelKey, valueKey };
}

async function assertTenantSite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): Promise<void> {
  const row = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();

  if (!row) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_COPILOT_SQL_REJECTED',
      message: 'Requested analytics site is not available for this tenant',
    });
  }
}

async function loadSalesSnapshot(
  db: DatabaseInstance,
  tenantId: string,
  window: CopilotWindow,
  siteId: string | null
) {
  const filters: SQL[] = [
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    gte(sales.createdAt, window.from),
    lte(sales.createdAt, window.to),
  ];
  if (siteId) {
    filters.push(eq(cashSessions.siteId, siteId));
  }

  const rows = await db
    .select({
      saleId: sales.id,
      saleNumber: sales.saleNumber,
      soldAt: sales.createdAt,
      siteId: cashSessions.siteId,
      siteName: sites.name,
      cashierId: users.id,
      cashierName: users.name,
      customerName: customers.name,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      paymentStatus: sales.paymentStatus,
      status: sales.status,
    })
    .from(sales)
    .innerJoin(cashSessions, eq(sales.cashSessionId, cashSessions.id))
    .innerJoin(sites, eq(cashSessions.siteId, sites.id))
    .innerJoin(users, eq(sales.createdBy, users.id))
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(and(...filters))
    .orderBy(desc(sales.createdAt))
    .limit(SALES_SNAPSHOT_ROW_LIMIT + 1);

  if (rows.length > SALES_SNAPSHOT_ROW_LIMIT) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_COPILOT_QUERY_LIMIT_EXCEEDED',
      message: 'Analytics question needs a narrower date range or site filter',
      details: { rowLimit: SALES_SNAPSHOT_ROW_LIMIT },
    });
  }

  return rows;
}

async function loadLineItemSnapshot(
  db: DatabaseInstance,
  tenantId: string,
  window: CopilotWindow,
  siteId: string | null
) {
  const filters: SQL[] = [
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    gte(sales.createdAt, window.from),
    lte(sales.createdAt, window.to),
  ];
  if (siteId) {
    filters.push(eq(cashSessions.siteId, siteId));
  }

  const rows = await db
    .select({
      saleId: sales.id,
      saleNumber: sales.saleNumber,
      soldAt: sales.createdAt,
      siteId: cashSessions.siteId,
      siteName: sites.name,
      productId: products.id,
      productName: products.name,
      sku: products.sku,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxAmount: saleItems.taxAmount,
      costAtSale: saleItems.costAtSale,
      lineTotal: saleItems.total,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(cashSessions, eq(sales.cashSessionId, cashSessions.id))
    .innerJoin(sites, eq(cashSessions.siteId, sites.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(and(...filters))
    .orderBy(desc(sales.createdAt))
    .limit(LINE_ITEMS_SNAPSHOT_ROW_LIMIT + 1);

  if (rows.length > LINE_ITEMS_SNAPSHOT_ROW_LIMIT) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_COPILOT_QUERY_LIMIT_EXCEEDED',
      message: 'Analytics question needs a narrower date range or site filter',
      details: { rowLimit: LINE_ITEMS_SNAPSHOT_ROW_LIMIT },
    });
  }

  return rows;
}

function createSnapshotDatabase() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE sales_summary (
      sale_id TEXT PRIMARY KEY,
      sale_number TEXT NOT NULL,
      sold_at TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      customer_name TEXT,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL,
      discount_amount REAL NOT NULL,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE sale_line_items (
      sale_id TEXT NOT NULL,
      sale_number TEXT NOT NULL,
      sold_at TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount REAL NOT NULL,
      tax_rate REAL NOT NULL,
      tax_amount REAL NOT NULL,
      cost_at_sale REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE INDEX idx_sales_summary_date_site ON sales_summary(sale_date, site_name);
    CREATE INDEX idx_sale_line_items_date_site ON sale_line_items(sale_date, site_name);
    CREATE INDEX idx_sale_line_items_product ON sale_line_items(product_name);
  `);
  return sqlite;
}

function insertSnapshotRows(
  sqlite: Database.Database,
  saleRows: Awaited<ReturnType<typeof loadSalesSnapshot>>,
  lineRows: Awaited<ReturnType<typeof loadLineItemSnapshot>>
) {
  const insertSale = sqlite.prepare(`
    INSERT INTO sales_summary (
      sale_id, sale_number, sold_at, sale_date, site_id, site_name,
      cashier_id, cashier_name, customer_name, subtotal, tax_amount,
      discount_amount, total, payment_method, payment_status, status
    ) VALUES (
      @saleId, @saleNumber, @soldAt, date(@soldAt), @siteId, @siteName,
      @cashierId, @cashierName, @customerName, @subtotal, @taxAmount,
      @discountAmount, @total, @paymentMethod, @paymentStatus, @status
    )
  `);
  const insertLine = sqlite.prepare(`
    INSERT INTO sale_line_items (
      sale_id, sale_number, sold_at, sale_date, site_id, site_name,
      product_id, product_name, sku, quantity, unit_price, discount,
      tax_rate, tax_amount, cost_at_sale, line_total
    ) VALUES (
      @saleId, @saleNumber, @soldAt, date(@soldAt), @siteId, @siteName,
      @productId, @productName, @sku, @quantity, @unitPrice, @discount,
      @taxRate, @taxAmount, @costAtSale, @lineTotal
    )
  `);

  const tx = sqlite.transaction(() => {
    for (const row of saleRows) {
      insertSale.run(row);
    }
    for (const row of lineRows) {
      insertLine.run(row);
    }
  });
  tx();
}

export async function runReadOnlySQL(
  db: DatabaseInstance,
  tenantId: string,
  options: SnapshotOptions,
  now: Date = new Date()
): Promise<CopilotSQLResult> {
  const safeQuery = validateReadOnlySQL(options.query);
  const window = resolveWindow(options.context, now);
  const requestedSiteId = options.context?.siteId ?? null;
  if (requestedSiteId) {
    await assertTenantSite(db, tenantId, requestedSiteId);
  }

  const [saleRows, lineRows] = await Promise.all([
    loadSalesSnapshot(db, tenantId, window, requestedSiteId),
    loadLineItemSnapshot(db, tenantId, window, requestedSiteId),
  ]);

  const sqlite = createSnapshotDatabase();
  try {
    insertSnapshotRows(sqlite, saleRows, lineRows);
    sqlite.pragma('query_only = ON');

    const cappedQuery = `SELECT * FROM (${safeQuery}) LIMIT ${RESULT_ROW_LIMIT + 1}`;
    const statement = sqlite.prepare(cappedQuery);
    const rawRows = statement.all() as SnapshotRow[];
    const truncated = rawRows.length > RESULT_ROW_LIMIT;
    const rows = rawRows.slice(0, RESULT_ROW_LIMIT).map(normalizeRow);
    const columns = statement.columns().map(column => column.name);

    return {
      sql: safeQuery,
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      chart: inferChart(columns, rows),
      window,
    };
  } catch (error) {
    if (
      error instanceof TRPCError ||
      (error instanceof Error && error.cause instanceof ServerErrorWithCode)
    ) {
      throw error;
    }
    rejectSQL(error instanceof Error ? error.message : 'Analytics SQL failed');
  } finally {
    sqlite.close();
  }
}

function buildSystemPrompt(window: CopilotWindow, siteId: string | null): string {
  return [
    'You are Puntovivo analytics co-pilot for POS managers.',
    'Answer in the same language as the user, concise and operational.',
    'Always use the runReadOnlySQL tool before answering revenue, sales, product, cashier, or site questions.',
    'Never invent numbers. If a query is rejected or too broad, ask for a narrower date range or site.',
    'The only SQL tables available are:',
    '- sales_summary(sale_id, sale_number, sold_at, sale_date, site_id, site_name, cashier_id, cashier_name, customer_name, subtotal, tax_amount, discount_amount, total, payment_method, payment_status, status)',
    '- sale_line_items(sale_id, sale_number, sold_at, sale_date, site_id, site_name, product_id, product_name, sku, quantity, unit_price, discount, tax_rate, tax_amount, cost_at_sale, line_total)',
    'Use only a single SELECT or WITH statement. No semicolons, PRAGMA, ATTACH, temp tables, or mutations.',
    `The current bounded analytics window is ${window.from} to ${window.to}${window.defaulted ? ' (default 90 days)' : ''}.`,
    siteId
      ? `The active UI site context is ${siteId}. Use it only when the user asks for the current site.`
      : 'No active UI site context is available.',
    "For \"ayer\", filter by sale_date = date('now', '-1 day'). For site names like Sur, use lower(site_name) LIKE '%sur%'.",
    'When the SQL result has rows, summarize the answer and mention whether rows were truncated.',
  ].join('\n');
}

function buildPrompt(messages: CopilotChatMessage[]): string {
  return messages
    .map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n\n');
}

function serverErrorCodeFrom(error: unknown): ServerErrorCode {
  if (error instanceof TRPCError && error.cause instanceof ServerErrorWithCode) {
    return error.cause.errorCode;
  }
  if (error instanceof Error && error.cause instanceof ServerErrorWithCode) {
    return error.cause.errorCode;
  }
  return 'AI_PROVIDER_ERROR';
}

async function resolveConfiguredProvider(
  ctx: AIInvocationContext,
  factory: ProviderFactory
): Promise<{ provider: AIProvider; modelId: string; settings: AISettings }> {
  const settings = await resolveAISettings(ctx.db, ctx.tenantId);
  if (!settings.enabled) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_DISABLED',
      message: 'AI features are disabled for this tenant',
    });
  }

  const provider = factory(settings.providerId);
  if (!provider.isConfigured()) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `Provider ${provider.id} is not configured (set the API key env var)`,
    });
  }
  if (settings.monthlyBudgetUsd <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: 'AI monthly budget is zero',
    });
  }
  const spent = await currentMonthSpend(ctx.db, ctx.tenantId);
  if (spent >= settings.monthlyBudgetUsd) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: `AI monthly budget exhausted ($${spent.toFixed(4)} of $${settings.monthlyBudgetUsd.toFixed(2)})`,
    });
  }

  return {
    provider,
    modelId: settings.modelId ?? provider.defaultModelId,
    settings,
  };
}

export async function runCopilotChat(
  ctx: AIInvocationContext,
  input: CopilotChatInput,
  options: CopilotRunOptions = {}
): Promise<CopilotChatResult> {
  const now = options.now ?? new Date();
  const window = resolveWindow(input.context, now);
  const factory = options.factory ?? defaultFactory;
  const { provider, modelId } = await resolveConfiguredProvider(ctx, factory);
  const startedAt = Date.now();
  let lastSQLResult: CopilotSQLResult | null = null;

  try {
    const providerOptions = provider.cacheControlForSystemPrompt();
    const result = await generateText({
      model: provider.languageModel(modelId),
      system: buildSystemPrompt(window, ctx.siteId),
      prompt: buildPrompt(input.messages),
      tools: {
        getCurrentSiteContext: tool({
          description: 'Return the active site and bounded analytics window for this chat.',
          inputSchema: z.object({}),
          execute: async () => ({
            siteId: ctx.siteId,
            window,
            allowedTables: Array.from(ALLOWED_TABLES),
            resultRowLimit: RESULT_ROW_LIMIT,
          }),
        }),
        runReadOnlySQL: tool({
          description:
            'Run a read-only SELECT/WITH query against tenant-scoped sales analytics snapshot tables.',
          inputSchema: z.object({
            query: z.string().min(1).max(SQL_MAX_LENGTH),
          }),
          execute: async ({ query }) => {
            lastSQLResult = await runReadOnlySQL(
              ctx.db,
              ctx.tenantId,
              { query, context: input.context },
              now
            );
            return lastSQLResult;
          },
        }),
      },
      stopWhen: stepCountIs(5),
      maxOutputTokens: 700,
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });

    const usage = result.usage as UsageShape;
    const inputTokens = usageNumber(usage.inputTokens);
    const outputTokens = usageNumber(usage.outputTokens);
    const inputRecord = asRecord(usage.inputTokens);
    const detailsRecord = asRecord(usage.inputTokenDetails);
    const cacheReadTokens =
      usageNestedNumber(inputRecord, 'cacheRead') ||
      usageNestedNumber(detailsRecord, 'cacheReadTokens');
    const cacheWriteTokens =
      usageNestedNumber(inputRecord, 'cacheWrite') ||
      usageNestedNumber(detailsRecord, 'cacheWriteTokens');
    const costUsd = provider.pricing.calculateCostUsd(modelId, {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
    });
    const durationMs = Date.now() - startedAt;

    const { id: auditLogId } = await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'copilot',
      providerId: provider.id,
      modelId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      durationMs,
      errorCode: null,
    });

    const emptyResult: CopilotSQLResult = {
      sql: '',
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      chart: null,
      window,
    };
    const sqlResult = lastSQLResult ?? emptyResult;

    return {
      ...sqlResult,
      answer: result.text,
      costUsd,
      durationMs,
      provider: provider.id,
      model: modelId,
      auditLogId,
    };
  } catch (error) {
    const errorCode = serverErrorCodeFrom(error);
    await recordCall(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'copilot',
      providerId: provider.id,
      modelId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - startedAt,
      errorCode,
    });

    if (error instanceof TRPCError) {
      throw error;
    }

    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: error instanceof Error ? error.message : 'AI provider call failed',
      details: { cause: String(error) },
    });
  }
}

export const copilotLimits = {
  defaultWindowDays: DEFAULT_WINDOW_DAYS,
  salesSnapshotRowLimit: SALES_SNAPSHOT_ROW_LIMIT,
  lineItemsSnapshotRowLimit: LINE_ITEMS_SNAPSHOT_ROW_LIMIT,
  resultRowLimit: RESULT_ROW_LIMIT,
};
