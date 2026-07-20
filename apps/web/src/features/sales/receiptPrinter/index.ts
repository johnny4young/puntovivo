// Sale-receipt printer — public barrel ( slice 29).
//
// Re-assembles the per-concern modules into the original public surface
// (buildSaleReceiptHtml + printSaleReceipt + the escpos/drawer dispatchers
// + their result/option types) so importers resolve unchanged. The private
// HTML helpers, `openBrowserPrintWindow`, and the `ReceiptSale` /
// `ReceiptHtmlOptions` internals stay non-public.

export type {
  ReceiptFiscalDocument,
  EscPosDispatchOutcome,
  PrintSaleReceiptOptions,
  HubReceiptBytesPayload,
  HubDrawerBytesPayload,
  CreateEscposReceiptDispatcherInput,
  DrawerKickOutcome,
  DispatchDrawerKickInput,
} from './types';
export { buildSaleReceiptHtml } from './html';
export { printSaleReceipt } from './print';
export { createEscposReceiptDispatcher, dispatchDrawerKick } from './escpos';
