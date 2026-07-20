// Sale-receipt printer ( /  /  / ).
//
// Decomposed into per-concern modules under `receiptPrinter/` (
// slice 29): types, html (buildSaleReceiptHtml + the escapeHtml XSS guard
// + fiscal section), print (browser/Electron path), escpos (hub-client
// bridge routing). This file stays as a thin re-export barrel so existing
// importers resolve unchanged.

export * from './receiptPrinter/index';
