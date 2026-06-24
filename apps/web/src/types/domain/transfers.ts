// ENG-179c — inter-site transfer domain shapes (ENG-178 slice 28).

import type { TransferHistoryStatus } from '../ui';

export interface TransferHistoryEntry {
  id: string;
  status: TransferHistoryStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  itemCount: number;
  totalQuantity: number;
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}

export interface TransferDetailLine {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  receivedQuantity: number | null;
}

export interface TransferDetail {
  id: string;
  status: TransferHistoryStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  updatedAt: string;
  items: TransferDetailLine[];
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}
