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

/**
 * Model-facing analytics must at least read an actual snapshot table. A
 * constant SELECT or a CTE shadowing a table name is not source evidence.
 * This is deliberately only a provenance floor: a table-reading query may
 * still calculate the wrong KPI, which the UI must never call proof.
 */
export function validateModelAnalyticsSQL(query: string): string {
  const normalized = validateReadOnlySQL(query);
  // The lightweight SQL guard cannot reliably distinguish every recursive,
  // column-list or quoted CTE shadow from a base table. Fail closed here;
  // authorized local read-only SQL still retains WITH support.
  const inspected = stripQuotedStrings(normalized);
  // SQLite bracket identifiers can contain fake FROM/JOIN tokens. The model
  // source guard does not tokenize them, so never accept them as evidence.
  // Keep this restriction separate from authorized local read-only SQL.
  if (/[[\]]/.test(inspected)) {
    rejectSQL('Model analytics bracket-quoted identifiers are not supported');
  }
  if (/\bwith\b/i.test(inspected)) {
    rejectSQL('Model analytics CTE queries are not supported');
  }
  // Quoted identifiers are collapsed by the string stripper above, so the
  // table allow-list would never see `FROM "sqlite_master"`. Model SQL only
  // needs plain identifiers; string literals use single quotes.
  if (/["`]/.test(inspected)) {
    rejectSQL('Model analytics quoted identifiers are not supported');
  }
  // Schema tables and table-valued pragmas are not analytics sources, even
  // inside the isolated in-memory snapshot.
  if (/\b(?:sqlite_\w+|pragma_\w+)\b/i.test(inspected)) {
    rejectSQL('Model analytics query must read only snapshot source tables');
  }
  // `FROM a, b` lists are not covered by the FROM/JOIN regex, which only
  // inspects the first item. Every top-level item must be a source table
  // or a parenthesized subquery (whose own FROM is checked separately).
  for (const item of fromListItems(inspected)) {
    if (item.startsWith('(')) continue;
    const table = sanitizeTableName(item.split(/\s+/)[0] ?? '');
    if (!ALLOWED_TABLES.has(table)) {
      rejectSQL('Model analytics query must read only snapshot source tables');
    }
  }
  const readsSource = Array.from(
    inspected.matchAll(/\b(?:from|join)\s+([`"]?[a-zA-Z_][a-zA-Z0-9_."`]*\]?)/gi)
  ).some(match => {
    const table = sanitizeTableName(match[1]!);
    return ALLOWED_TABLES.has(table);
  });
  if (!readsSource) {
    rejectSQL('Model analytics query must read a snapshot source table');
  }
  return normalized;
}

const FROM_LIST_END =
  /^(?:where|group|order|limit|having|window|union|intersect|except|join|inner|left|right|full|cross|natural|on|using)\b/i;

/** Top-level comma-separated items of every FROM clause, lower-cased and trimmed. */
function fromListItems(inspected: string): string[] {
  const items: string[] = [];
  for (const match of inspected.matchAll(/\bfrom\b/gi)) {
    let depth = 0;
    let current = '';
    let index = match.index + match[0].length;
    for (; index < inspected.length; index += 1) {
      const char = inspected[index]!;
      if (char === '(') depth += 1;
      if (char === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
      if (depth === 0) {
        if (char === ',') {
          items.push(current.trim().toLowerCase());
          current = '';
          continue;
        }
        if (/\s/.test(char) && FROM_LIST_END.test(inspected.slice(index + 1))) {
          current += char;
          break;
        }
      }
      current += char;
    }
    items.push(current.trim().toLowerCase());
  }
  return items.filter(item => item.length > 0);
}
