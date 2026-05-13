/**
 * ENG-040c voice barrel.
 *
 * - slice 1 (`transcribe.ts`) — Whisper transcription pipeline.
 * - slice 3 (`parse-cart-command.ts`) — cart-command parser that
 *   maps transcripts to add-to-cart actions via `generateObject` +
 *   ENG-033 embeddings.
 *
 * @module services/ai/voice
 */
export {
  VOICE_TRANSCRIBE_MAX_BYTES,
  VOICE_TRANSCRIBE_MIME_TYPES,
  transcribeAudio,
  type VoiceProviderFactory,
  type VoiceTranscribeInput,
  type VoiceTranscribeInvocationContext,
  type VoiceTranscribeMimeType,
  type VoiceTranscribeResult,
} from './transcribe.js';

export {
  VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS,
  VoiceCartCommandSchema,
  parseVoiceCartCommand,
  type CartCommandContext,
  type CartCommandInput,
  type CartCommandMatch,
  type CartCommandResult,
  type MatchedCartProduct,
  type VoiceCartCommand,
} from './parse-cart-command.js';
