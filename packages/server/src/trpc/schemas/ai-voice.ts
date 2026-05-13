/**
 * ENG-040c slice 1 — Schema for `ai.transcribeAudio`.
 * ENG-040c slice 3 — Schema for `ai.parseCartCommand`.
 *
 * @module trpc/schemas/ai-voice
 */
import { z } from 'zod';

import { VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS } from '../../services/ai/voice/parse-cart-command.js';
import {
  VOICE_TRANSCRIBE_MAX_BYTES,
  VOICE_TRANSCRIBE_MIME_TYPES,
} from '../../services/ai/voice/transcribe.js';

const dataUrlPrefix = /^data:[^;]+;base64,/;

export const transcribeAudioInput = z.object({
  /**
   * Base64-encoded audio bytes. Accepts both the raw payload and a
   * `data:audio/...;base64,` URL — the prefix is stripped server-side
   * so the rest of the pipeline sees a clean base64 string. Max raw
   * decoded size: `VOICE_TRANSCRIBE_MAX_BYTES` (enforced after decode
   * in the service layer; the Zod ceiling here is a defense-in-depth
   * byte length to bound payload growth at the transport).
   */
  audioBase64: z
    .string()
    .min(1)
    // ~4/3 expansion: a 10 MB raw payload is roughly 13.4 MB base64.
    // Add 32 KB of slack for the optional data-URL prefix. The service
    // layer re-checks the decoded byte count.
    .max(Math.ceil(VOICE_TRANSCRIBE_MAX_BYTES * 1.4) + 32 * 1024)
    .transform(value => value.replace(dataUrlPrefix, '')),
  mimeType: z.enum(VOICE_TRANSCRIBE_MIME_TYPES),
});
export type TranscribeAudioInput = z.infer<typeof transcribeAudioInput>;

export const parseCartCommandInput = z.object({
  /**
   * Cashier transcript produced by `ai.transcribeAudio`. Trimmed +
   * length-capped at `VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS`
   * (defense-in-depth — the service layer re-checks).
   */
  transcript: z
    .string()
    .trim()
    .min(1)
    .max(VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS),
});
export type ParseCartCommandInput = z.infer<typeof parseCartCommandInput>;
