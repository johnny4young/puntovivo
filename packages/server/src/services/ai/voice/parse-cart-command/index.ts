/**
 * Voice cart-command parser — public barrel.
 *
 * Re-assembles the per-concern modules into the original public surface
 * (the schema + transcript-cap const + parser function + result/context
 * types) so importers resolve unchanged. The prompt constants and the
 * `hydrateCartProducts` helper stay non-public.
 *
 * @module services/ai/voice/parse-cart-command
 */
export {
  VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS,
  VoiceCartCommandSchema,
  type VoiceCartCommand,
} from './schema.js';
export { parseVoiceCartCommand } from './parse.js';
export type {
  MatchedCartProduct,
  CartCommandMatch,
  CartCommandResult,
  CartCommandContext,
  CartCommandInput,
} from './types.js';
