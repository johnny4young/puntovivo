/** ENG-123a — Launch-migration product import contracts. */
import { z } from 'zod';

export const importDecimalFormatSchema = z.enum(['auto', 'dot', 'comma']);

// Keep the transport bounded while allowing application validation to return
// row-level field issues instead of rejecting an otherwise previewable file.
const importCell = z.string().max(4_000).optional();

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
  .superRefine((rows, ctx) => {
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
  });

export const previewLaunchProductImportInput = z
  .object({
    sourceName: z.string().trim().min(1).max(240),
    decimalFormat: importDecimalFormatSchema.default('auto'),
    rows: launchProductImportRowsSchema,
  })
  .strict();

export const commitLaunchProductImportInput = previewLaunchProductImportInput.extend({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type ImportDecimalFormat = z.infer<typeof importDecimalFormatSchema>;
export type LaunchProductImportRow = z.infer<typeof launchProductImportRowSchema>;
export type PreviewLaunchProductImportInput = z.infer<typeof previewLaunchProductImportInput>;
export type CommitLaunchProductImportInput = z.infer<typeof commitLaunchProductImportInput>;
