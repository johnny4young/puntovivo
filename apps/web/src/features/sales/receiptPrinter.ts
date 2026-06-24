// Sale-receipt printer (ENG-014 / ENG-058 / ENG-062 / ENG-074b).
//
// Decomposed into per-concern modules under `receiptPrinter/` (ENG-178
// slice 29): types, html (buildSaleReceiptHtml + the escapeHtml XSS guard
// + fiscal section), print (browser/Electron path), escpos (hub-client
// bridge routing). This file stays as a thin re-export barrel so existing
// importers resolve unchanged.

export * from './receiptPrinter/index';
