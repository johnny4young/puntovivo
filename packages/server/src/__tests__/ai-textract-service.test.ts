import { describe, expect, it, vi } from 'vitest';
import { TextractClient } from '@aws-sdk/client-textract';

import {
  extractInvoiceWithTextract,
  resolveTextractPriceConfig,
} from '../services/ai/invoice/textract.js';

const INPUT = {
  documentBase64: 'aGVsbG8=',
  mimeType: 'image/png' as const,
  region: 'us-east-1',
  usdPerPage: 0.02,
};

describe('Textract AnalyzeExpense pricing and transport', () => {
  it('fails closed without a positive price for the exact runtime region', () => {
    expect(() => resolveTextractPriceConfig({ AWS_REGION: 'us-east-1' })).toThrow();
    expect(() =>
      resolveTextractPriceConfig({
        AWS_REGION: 'us-east-1',
        PUNTOVIVO_TEXTRACT_ANALYZE_EXPENSE_PRICES_USD: '{"us-west-2":0.01}',
      })
    ).toThrow();
    expect(() =>
      resolveTextractPriceConfig({
        AWS_REGION: 'us-east-1',
        PUNTOVIVO_TEXTRACT_ANALYZE_EXPENSE_PRICES_USD: '{"us-east-1":0}',
      })
    ).toThrow();
    expect(() =>
      resolveTextractPriceConfig({
        AWS_REGION: 'us-east-1',
        PUNTOVIVO_TEXTRACT_ANALYZE_EXPENSE_PRICES_USD: 'not-json',
      })
    ).toThrow();
  });

  it('accepts an explicit region price and calculates cost from returned page count', async () => {
    expect(
      resolveTextractPriceConfig({
        AWS_REGION: 'us-east-1',
        PUNTOVIVO_TEXTRACT_ANALYZE_EXPENSE_PRICES_USD: '{"us-east-1":0.02}',
      })
    ).toEqual({ region: 'us-east-1', usdPerPage: 0.02 });
    const send = vi.fn().mockResolvedValue({
      DocumentMetadata: { Pages: 2 },
      ExpenseDocuments: [{ SummaryFields: [], LineItemGroups: [] }],
    });
    const abortSignal = new AbortController().signal;
    const result = await extractInvoiceWithTextract({ ...INPUT, abortSignal }, {
      send,
    } as unknown as TextractClient);
    expect(result.costUsd).toBe(0.04);
    expect(result.provider).toBe('textract');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toEqual({ abortSignal });
  });

  it('refuses to report a zero-dollar success without billable page metadata', async () => {
    const send = vi.fn().mockResolvedValue({ ExpenseDocuments: [] });
    await expect(
      extractInvoiceWithTextract(INPUT, { send } as unknown as TextractClient)
    ).rejects.toThrow(/page count/);
  });
});
