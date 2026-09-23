import {
  AnalyzeExpenseCommand,
  TextractClient,
  type ExpenseDocument,
  type ExpenseField,
  type LineItemFields,
} from '@aws-sdk/client-textract';

import type { InvoiceOcr, InvoiceOcrMimeType } from '../vision/invoice-ocr.js';
import { throwServerError } from '../../../lib/errorCodes.js';

export interface TextractInvoiceOcrInput {
  documentBase64: string;
  mimeType: InvoiceOcrMimeType;
  region: string;
  usdPerPage: number;
  abortSignal?: AbortSignal | undefined;
}

export interface TextractInvoiceOcrResult {
  invoice: InvoiceOcr;
  costUsd: number;
  durationMs: number;
  provider: 'textract';
  model: 'aws-textract-analyze-expense';
}

export function resolveTextractPriceConfig(env: NodeJS.ProcessEnv = process.env): {
  region: string;
  usdPerPage: number;
} {
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? 'us-east-1';
  const raw = env.PUNTOVIVO_TEXTRACT_ANALYZE_EXPENSE_PRICES_USD;
  let prices: unknown;
  try {
    prices = raw ? JSON.parse(raw) : null;
  } catch {
    prices = null;
  }
  const usdPerPage =
    prices && typeof prices === 'object' && !Array.isArray(prices)
      ? (prices as Record<string, unknown>)[region]
      : undefined;
  if (typeof usdPerPage !== 'number' || !Number.isFinite(usdPerPage) || usdPerPage <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `Textract AnalyzeExpense page price is not configured for AWS region ${region}`,
    });
  }
  return { region, usdPerPage };
}

function normalizeKey(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function fieldKey(field: ExpenseField): string {
  return normalizeKey(field.Type?.Text ?? field.LabelDetection?.Text);
}

function fieldValue(field: ExpenseField): string | null {
  const value = field.ValueDetection?.Text?.trim();
  return value && value.length > 0 ? value : null;
}

function parseMoney(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  const decimalIndex = Math.max(lastComma, lastDot);
  if (decimalIndex > -1 && cleaned.length - decimalIndex - 1 <= 2) {
    const integerPart = cleaned.slice(0, decimalIndex).replace(/[^\d-]/g, '');
    const decimalPart = cleaned.slice(decimalIndex + 1).replace(/[^\d]/g, '');
    const parsed = Number(`${integerPart}.${decimalPart}`);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(cleaned.replace(/[^\d-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseQuantity(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw.replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function summaryMap(doc: ExpenseDocument): Map<string, string> {
  const out = new Map<string, string>();
  for (const field of doc.SummaryFields ?? []) {
    const key = fieldKey(field);
    const value = fieldValue(field);
    if (key && value) out.set(key, value);
  }
  return out;
}

function firstSummary(map: Map<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = map.get(key);
    if (value) return value;
  }
  return null;
}

function lineFieldMap(row: LineItemFields): Map<string, string> {
  const out = new Map<string, string>();
  for (const field of row.LineItemExpenseFields ?? []) {
    const key = fieldKey(field);
    const value = fieldValue(field);
    if (key && value) out.set(key, value);
  }
  return out;
}

function parseLine(row: LineItemFields): InvoiceOcr['lines'][number] | null {
  const fields = lineFieldMap(row);
  const description = firstSummary(fields, ['ITEM', 'DESCRIPTION', 'PRODUCT_CODE', 'NAME']);
  if (!description) return null;
  const quantity = parseQuantity(firstSummary(fields, ['QUANTITY', 'QTY']));
  const unitPrice = parseMoney(firstSummary(fields, ['UNIT_PRICE', 'PRICE']));
  const totalLine = parseMoney(firstSummary(fields, ['EXPENSE_ROW', 'TOTAL', 'AMOUNT']));
  return {
    description,
    quantity,
    unitPrice,
    totalLine,
  };
}

function toInvoice(doc: ExpenseDocument): InvoiceOcr {
  const summary = summaryMap(doc);
  const lines = (doc.LineItemGroups ?? [])
    .flatMap(group => group.LineItems ?? [])
    .map(parseLine)
    .filter((line): line is InvoiceOcr['lines'][number] => line !== null);

  return {
    supplierName: firstSummary(summary, ['VENDOR_NAME', 'SUPPLIER_NAME', 'RECEIVER_NAME']),
    supplierTaxId: firstSummary(summary, ['VENDOR_TAX_ID', 'TAX_PAYER_ID', 'TAX_ID', 'NIT']),
    invoiceNumber: firstSummary(summary, [
      'INVOICE_RECEIPT_ID',
      'INVOICE_ID',
      'RECEIPT_ID',
      'DOCUMENT_NUMBER',
    ]),
    invoiceDate: firstSummary(summary, ['INVOICE_RECEIPT_DATE', 'INVOICE_DATE', 'RECEIPT_DATE']),
    currencyCode: firstSummary(summary, ['CURRENCY']),
    lines,
    subtotal: parseMoney(firstSummary(summary, ['SUBTOTAL', 'SUB_TOTAL'])),
    taxAmount: parseMoney(firstSummary(summary, ['TAX', 'TOTAL_TAX', 'IVA'])),
    total: parseMoney(firstSummary(summary, ['TOTAL', 'AMOUNT_DUE', 'INVOICE_RECEIPT_TOTAL'])),
  };
}

export async function extractInvoiceWithTextract(
  input: TextractInvoiceOcrInput,
  client = new TextractClient({
    region: input.region,
    // An SDK retry can submit and bill the same document more than once.
    maxAttempts: 1,
  })
): Promise<TextractInvoiceOcrResult> {
  const startedAt = Date.now();
  const output = await client.send(
    new AnalyzeExpenseCommand({
      Document: {
        Bytes: Buffer.from(input.documentBase64, 'base64'),
      },
    }),
    input.abortSignal ? { abortSignal: input.abortSignal } : {}
  );
  const pages = output.DocumentMetadata?.Pages;
  if (typeof pages !== 'number' || !Number.isInteger(pages) || pages <= 0) {
    throw new Error('Textract returned missing or invalid billed page count');
  }
  const firstDoc = output.ExpenseDocuments?.[0] ?? {};
  return {
    invoice: toInvoice(firstDoc),
    costUsd: pages * input.usdPerPage,
    durationMs: Date.now() - startedAt,
    provider: 'textract',
    model: 'aws-textract-analyze-expense',
  };
}
