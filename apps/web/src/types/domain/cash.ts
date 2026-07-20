// cash-session domain shapes ( slice 28).

import type { CashMovementType, CashSessionStatus } from '../ui';

export interface CashSessionDenomination {
  value: number;
  count: number;
}

export interface RegisterAssignment {
  id: string;
  tenantId: string;
  siteId: string;
  registerName: string;
  label: string;
  openingFloat: number;
  denominations: CashSessionDenomination[];
  sortOrder: number;
  isActive: boolean;
  isOccupied: boolean;
  activeSessionId?: string | null;
  activeCashierId?: string | null;
  activeCashierName?: string | null;
  openedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CashSession {
  id: string;
  tenantId: string;
  siteId: string;
  siteName?: string | null;
  cashierId: string;
  cashierName?: string | null;
  registerName: string;
  openingFloat: number;
  openingCountDenominations: CashSessionDenomination[];
  /** Null while an open cashier session is enforcing blind close. */
  expectedBalance: number | null;
  actualCount?: number | null;
  actualCountDenominations?: CashSessionDenomination[] | null;
  overShort?: number | null;
  status: CashSessionStatus;
  openedAt: string;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CashMovement {
  id: string;
  tenantId: string;
  sessionId: string;
  type: CashMovementType;
  amount: number;
  referenceId?: string | null;
  note?: string | null;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
}

export interface CashSessionReportSummary {
  activeSessionCount: number;
  activeRegisterCount: number;
  recentClosureCount: number;
  reviewCount: number;
  netOverShort: number;
  largestDiscrepancy: number;
}

export interface CashSessionReport {
  summary: CashSessionReportSummary;
  activeSessions: CashSession[];
  recentClosures: CashSession[];
}
