/**
 * ENG-040c slice 1 — AI voice barrel.
 *
 * Exposes the Whisper transcription pipeline. Cart-command parsing
 * (slice 2) will land alongside it under the same namespace.
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
