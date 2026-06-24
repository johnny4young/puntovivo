/**
 * Voice cart-command LLM-output schema + transcript bound (ENG-040c).
 *
 * @module services/ai/voice/parse-cart-command/schema
 */
import { z } from 'zod';

/** Bounded transcript size — a 60s burst at average speech density
 *  caps around 150 words. 1000 chars covers that with margin and
 *  bounds parser-prompt cost. */
export const VOICE_CART_COMMAND_MAX_TRANSCRIPT_CHARS = 1000;

/**
 * Output schema the language model fills via `generateObject`.
 *
 * Bounded to ADD operations only — quantity-update, remove, and
 * clear-cart commands are deferred to a follow-up slice once pilot
 * operators report the patterns they actually use. `quantity` is
 * nullable because Spanish voice commands often omit it ("agrega
 * coca cola"); the UI defaults nulls to 1 on apply.
 *
 * `confidence` is a soft signal the modal can use to color the
 * preview; `reason` carries an operator-readable hint when the
 * parser couldn't extract anything (the procedure surfaces this as
 * `mode='unrecognized'` rather than throwing so the modal can
 * render the hint inline).
 */
export const VoiceCartCommandSchema = z.object({
  items: z
    .array(
      z.object({
        productHint: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('Free-text product reference as the cashier spoke it.'),
        quantity: z
          .number()
          .nullable()
          .describe('Quantity stated by the cashier; null if not stated.'),
        // ENG-039a — Free-form modifier ("sin queso", "extra
        // picante") preserved verbatim as a note until structured
        // modifiers ship in a later ENG-039 child. The schema
        // accepts null or any string up to 200 chars; the service
        // layer collapses whitespace-only strings to null so the
        // downstream cart row never stores empty padding.
        note: z
          .string()
          .max(200)
          .nullable()
          .describe('Free-form modifier as the cashier spoke it; null when no modifier.'),
      })
    )
    .max(50)
    .describe('Add-to-cart actions extracted from the transcript.'),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z
    .string()
    .nullable()
    .describe('Operator-readable hint when items=[]; explains why nothing was extracted.'),
});
export type VoiceCartCommand = z.infer<typeof VoiceCartCommandSchema>;
