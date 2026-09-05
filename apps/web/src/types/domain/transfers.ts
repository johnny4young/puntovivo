// inter-site transfer domain shapes ( slice 28).

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
  totalReceivedQuantity: number | null;
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
  tracksLots?: boolean;
  tracksSerials?: boolean;
  serials?: Array<{ id: string; serialNumber: string }>;
  lots?: Array<{
    id: string;
    sourceLotId: string;
    destinationLotId: string | null;
    lotNumber: string;
    expiresAt: string | null;
    status: string;
    quantity: number;
    receivedQuantity: number | null;
    unitCost: number;
  }>;
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
