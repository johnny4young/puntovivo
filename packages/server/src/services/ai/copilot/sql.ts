/**
 * co-pilot read-only SQL guard + analytics window resolution.
 *
 * `validateReadOnlySQL` enforces the SELECT/WITH-only, single-statement,
 * comment-free, allowlisted-table contract the co-pilot's `runReadOnlySQL`
 * tool depends on; `resolveWindow` derives the bounded analytics window
 * (default 90 days) shared by the snapshot loader + the chat orchestrator.
 * Split out of `copilot.ts` ().
 *
 * @module services/ai/copilot/sql
 */
import { throwServerError } from '../../../lib/errorCodes.js';

import { ALLOWED_TABLES, DEFAULT_WINDOW_DAYS, FORBIDDEN_SQL, SQL_MAX_LENGTH } from './constants.js';
import type { CopilotContextInput, CopilotWindow } from './types.js';

export function resolveWindow(context: CopilotContextInput | undefined, now: Date): CopilotWindow {
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

export function rejectSQL(message: string, details?: Record<string, unknown>): never {
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
  return raw
    .replace(/["'`[\]]/g, '')
    .split('.')[0]!
    .toLowerCase();
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
  for (const match of inspected.matchAll(
    /\b(?:from|join)\s+([`"]?[a-zA-Z_][a-zA-Z0-9_."`]*\]?)/gi
  )) {
    const table = sanitizeTableName(match[1]!);
    if (!ALLOWED_TABLES.has(table) && !cteNames.has(table)) {
      rejectSQL(`Table ${table} is not available in the analytics snapshot`, {
        allowedTables: Array.from(ALLOWED_TABLES),
      });
    }
  }

  return normalized;
}
