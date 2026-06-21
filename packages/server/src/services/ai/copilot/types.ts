/**
 * ENG-031 — co-pilot type surface.
 *
 * The public chat / SQL-result shapes consumed across the service + the tRPC
 * router, plus the internal snapshot / usage / run-option shapes shared
 * between the per-concern modules. Split out of `copilot.ts` (ENG-178) so
 * every module imports its types from one leaf.
 *
 * @module services/ai/copilot/types
 */
import type { ProviderFactory } from '../client.js';

export interface CopilotChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ENG-179b — explicit `| undefined` so the tRPC router input (Zod-
// parsed; optional fields decode as `T | undefined`) assigns cleanly.
export interface CopilotContextInput {
  from?: string | undefined;
  to?: string | undefined;
  siteId?: string | null | undefined;
}

export interface CopilotChatInput {
  messages: CopilotChatMessage[];
  context?: CopilotContextInput | undefined;
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

export interface SnapshotOptions {
  query: string;
  context?: CopilotContextInput | undefined;
}

export interface SnapshotRow {
  [key: string]: CopilotCellValue;
}

export interface UsageShape {
  inputTokens?: unknown;
  outputTokens?: unknown;
  inputTokenDetails?: unknown;
}

export interface CopilotRunOptions {
  factory?: ProviderFactory;
  now?: Date;
}
