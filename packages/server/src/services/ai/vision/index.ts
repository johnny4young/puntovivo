/**
 * AI vision barrel.
 *
 * Exposes the provider-invoice OCR pipeline. Slice 1b adds line-to-
 * product matching helpers under the same namespace.
 *
 * @module services/ai/vision
 */
export {
  INVOICE_OCR_MAX_BYTES,
  INVOICE_OCR_MIME_TYPES,
  InvoiceOcrSchema,
  extractInvoiceFromImage,
  type InvoiceOcr,
  type InvoiceOcrInput,
  type InvoiceOcrInvocationContext,
  type InvoiceOcrLine,
  type InvoiceOcrMimeType,
  type InvoiceOcrResult,
  type VisionProviderFactory,
} from './invoice-ocr.js';

export {
  matchInvoiceLinesToProducts,
  type InvoiceLineForMatching,
  type InvoiceLineMatch,
  type InvoiceLineMatcherContext,
  type InvoiceLineMatcherResult,
  type MatchedProductSummary,
} from './invoice-line-matcher.js';

export {
  BENCHMARK_DEFAULT_THRESHOLD,
  DESCRIPTION_SIMILARITY_THRESHOLD,
  UNIT_PRICE_TOLERANCE,
  aggregateBenchmark,
  descriptionSimilarity,
  isLineMatch,
  normalizeDescription,
  scoreFixture,
  type BenchmarkAggregate,
  type BenchmarkResult,
  type FixtureGroundTruth,
  type FixtureScore,
} from './benchmark-scoring.js';
