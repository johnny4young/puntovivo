export const PURCHASE_DOCUMENT_TYPES = ['invoice', 'remision', 'other'] as const;
export type PurchaseDocumentType = (typeof PURCHASE_DOCUMENT_TYPES)[number];

/** Mirrors the invoice-OCR upload budget: a supporting paper for one
 * purchase never needs more headroom than the OCR intake allows. */
export const PURCHASE_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type PurchaseDocumentMimeType = (typeof PURCHASE_DOCUMENT_MIME_TYPES)[number];

export const PURCHASE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

export const PURCHASE_DOCUMENT_MIME_EXTENSIONS: Record<PurchaseDocumentMimeType, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

export function isPurchaseDocumentMimeType(value: string): value is PurchaseDocumentMimeType {
  return (PURCHASE_DOCUMENT_MIME_TYPES as readonly string[]).includes(value);
}

export function purchaseDocumentExtensionForMime(mimeType: string): string {
  return isPurchaseDocumentMimeType(mimeType) ? PURCHASE_DOCUMENT_MIME_EXTENSIONS[mimeType] : '';
}
