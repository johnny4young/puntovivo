import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type RouterOutputs = inferRouterOutputs<AppRouter>;

export type ProductImportPreview = RouterOutputs['launchMigration']['previewProducts'];
export type ProductImportPreviewRow = ProductImportPreview['rows'][number];
export type ProductImportReport = RouterOutputs['launchMigration']['importProducts'];
export type ProductImportIssue = ProductImportPreviewRow['issues'][number];
export type ImportDecimalFormat = 'auto' | 'dot' | 'comma';
