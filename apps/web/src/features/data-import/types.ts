import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type RouterInputs = inferRouterInputs<AppRouter>;

export type LaunchImportDataMode = RouterInputs['launchMigration']['previewProducts']['dataMode'];

export type ProductImportPreview = RouterOutputs['launchMigration']['previewProducts'];
export type ProductImportPreviewRow = ProductImportPreview['rows'][number];
export type ProductImportReport = RouterOutputs['launchMigration']['importProducts'];
export type ProductImportIssue = ProductImportPreviewRow['issues'][number];
export type ImportDecimalFormat = 'auto' | 'dot' | 'comma';

export type CustomerImportPreview = RouterOutputs['launchMigration']['previewCustomers'];
export type CustomerImportReport = RouterOutputs['launchMigration']['importCustomers'];
export type ProviderImportPreview = RouterOutputs['launchMigration']['previewProviders'];
export type ProviderImportReport = RouterOutputs['launchMigration']['importProviders'];
export type PartyImportPreview = CustomerImportPreview | ProviderImportPreview;
export type PartyImportReport = CustomerImportReport | ProviderImportReport;
export type PartyImportPreviewRow = PartyImportPreview['rows'][number];
export type PartyImportIssue = PartyImportPreviewRow['issues'][number];
export type CustomerImportRowsInput = RouterInputs['launchMigration']['previewCustomers']['rows'];
export type ProviderImportRowsInput = RouterInputs['launchMigration']['previewProviders']['rows'];

export type CustomerBalanceImportPreview =
  RouterOutputs['launchMigration']['previewCustomerBalances'];
export type CustomerBalanceImportPreviewRow = CustomerBalanceImportPreview['rows'][number];
export type CustomerBalanceImportReport =
  RouterOutputs['launchMigration']['importCustomerBalances'];
export type CustomerBalanceImportIssue = CustomerBalanceImportPreviewRow['issues'][number];
export type CustomerBalanceImportRowsInput =
  RouterInputs['launchMigration']['previewCustomerBalances']['rows'];

export type OpeningCashImportPreview = RouterOutputs['launchMigration']['previewOpeningCash'];
export type OpeningCashImportPreviewRow = OpeningCashImportPreview['rows'][number];
export type OpeningCashImportReport = RouterOutputs['launchMigration']['importOpeningCash'];
export type OpeningCashImportIssue = OpeningCashImportPreviewRow['issues'][number];
export type OpeningCashImportRowsInput =
  RouterInputs['launchMigration']['previewOpeningCash']['rows'];
