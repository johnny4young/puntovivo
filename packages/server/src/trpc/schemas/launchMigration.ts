/** ENG-123a — Launch-migration product import contracts. */
import { z } from 'zod';

export const importDecimalFormatSchema = z.enum(['auto', 'dot', 'comma']);
export const launchImportDataModeSchema = z.enum(['demo', 'real']);

// Keep the transport bounded while allowing application validation to return
// row-level field issues instead of rejecting an otherwise previewable file.
const importCell = z.string().max(4_000).optional();

function addUniqueRowNumberIssues(
  rows: ReadonlyArray<{ rowNumber: number }>,
  ctx: z.RefinementCtx
) {
  const seen = new Set<number>();
  rows.forEach((row, index) => {
    if (seen.has(row.rowNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, 'rowNumber'],
        message: 'Import row numbers must be unique',
      });
    }
    seen.add(row.rowNumber);
  });
}

export const launchProductImportRowSchema = z
  .object({
    rowNumber: z.number().int().min(2).max(1_000_000),
    values: z
      .object({
        name: importCell,
        sku: importCell,
        description: importCell,
        barcode: importCell,
        price: importCell,
        cost: importCell,
        stock: importCell,
        minStock: importCell,
        taxRate: importCell,
      })
      .strict(),
  })
  .strict();

const launchProductImportRowsSchema = z
  .array(launchProductImportRowSchema)
  .min(1, 'At least one import row is required')
  .max(500, 'A single import can contain at most 500 rows')
  .superRefine(addUniqueRowNumberIssues);

export const previewLaunchProductImportInput = z
  .object({
    dataMode: launchImportDataModeSchema,
    sourceName: z.string().trim().min(1).max(240),
    decimalFormat: importDecimalFormatSchema.default('auto'),
    rows: launchProductImportRowsSchema,
  })
  .strict();

export const commitLaunchProductImportInput = previewLaunchProductImportInput.extend({
  confirmedRealData: z.literal(true),
  dataMode: z.literal('real'),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const launchCustomerImportRowSchema = z
  .object({
    rowNumber: z.number().int().min(2).max(1_000_000),
    values: z
      .object({
        name: importCell,
        taxId: importCell,
        email: importCell,
        phone: importCell,
        address: importCell,
        city: importCell,
        state: importCell,
        postalCode: importCell,
        country: importCell,
        notes: importCell,
      })
      .strict(),
  })
  .strict();

const launchCustomerImportRowsSchema = z
  .array(launchCustomerImportRowSchema)
  .min(1, 'At least one import row is required')
  .max(500, 'A single import can contain at most 500 rows')
  .superRefine(addUniqueRowNumberIssues);

export const previewLaunchCustomerImportInput = z
  .object({
    dataMode: launchImportDataModeSchema,
    sourceName: z.string().trim().min(1).max(240),
    rows: launchCustomerImportRowsSchema,
  })
  .strict();

export const commitLaunchCustomerImportInput = previewLaunchCustomerImportInput.extend({
  confirmedRealData: z.literal(true),
  dataMode: z.literal('real'),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const launchProviderImportRowSchema = z
  .object({
    rowNumber: z.number().int().min(2).max(1_000_000),
    values: z
      .object({
        name: importCell,
        taxId: importCell,
        email: importCell,
        phone: importCell,
        address: importCell,
        contactName: importCell,
        cityCode: importCell,
      })
      .strict(),
  })
  .strict();

const launchProviderImportRowsSchema = z
  .array(launchProviderImportRowSchema)
  .min(1, 'At least one import row is required')
  .max(500, 'A single import can contain at most 500 rows')
  .superRefine(addUniqueRowNumberIssues);

export const previewLaunchProviderImportInput = z
  .object({
    dataMode: launchImportDataModeSchema,
    sourceName: z.string().trim().min(1).max(240),
    rows: launchProviderImportRowsSchema,
  })
  .strict();

export const commitLaunchProviderImportInput = previewLaunchProviderImportInput.extend({
  confirmedRealData: z.literal(true),
  dataMode: z.literal('real'),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const launchCustomerBalanceImportRowSchema = z
  .object({
    rowNumber: z.number().int().min(2).max(1_000_000),
    values: z
      .object({
        taxId: importCell,
        email: importCell,
        openingBalance: importCell,
        note: importCell,
      })
      .strict(),
  })
  .strict();

const launchCustomerBalanceImportRowsSchema = z
  .array(launchCustomerBalanceImportRowSchema)
  .min(1, 'At least one import row is required')
  .max(500, 'A single import can contain at most 500 rows')
  .superRefine(addUniqueRowNumberIssues);

export const previewLaunchCustomerBalanceImportInput = z
  .object({
    dataMode: launchImportDataModeSchema,
    sourceName: z.string().trim().min(1).max(240),
    decimalFormat: importDecimalFormatSchema.default('auto'),
    rows: launchCustomerBalanceImportRowsSchema,
  })
  .strict();

export const commitLaunchCustomerBalanceImportInput =
  previewLaunchCustomerBalanceImportInput.extend({
    confirmedRealData: z.literal(true),
    dataMode: z.literal('real'),
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  });

export type ImportDecimalFormat = z.infer<typeof importDecimalFormatSchema>;
export type LaunchImportDataMode = z.infer<typeof launchImportDataModeSchema>;
export type LaunchProductImportRow = z.infer<typeof launchProductImportRowSchema>;
export type PreviewLaunchProductImportInput = z.infer<typeof previewLaunchProductImportInput>;
export type CommitLaunchProductImportInput = z.infer<typeof commitLaunchProductImportInput>;
export type LaunchCustomerImportRow = z.infer<typeof launchCustomerImportRowSchema>;
export type PreviewLaunchCustomerImportInput = z.infer<typeof previewLaunchCustomerImportInput>;
export type CommitLaunchCustomerImportInput = z.infer<typeof commitLaunchCustomerImportInput>;
export type LaunchProviderImportRow = z.infer<typeof launchProviderImportRowSchema>;
export type PreviewLaunchProviderImportInput = z.infer<typeof previewLaunchProviderImportInput>;
export type CommitLaunchProviderImportInput = z.infer<typeof commitLaunchProviderImportInput>;
export type LaunchCustomerBalanceImportRow = z.infer<typeof launchCustomerBalanceImportRowSchema>;
export type PreviewLaunchCustomerBalanceImportInput = z.infer<
  typeof previewLaunchCustomerBalanceImportInput
>;
export type CommitLaunchCustomerBalanceImportInput = z.infer<
  typeof commitLaunchCustomerBalanceImportInput
>;
