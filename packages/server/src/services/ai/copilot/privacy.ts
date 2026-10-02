/** Request-local pseudonyms for the identities present in an analytics snapshot. */
import { randomUUID } from 'node:crypto';

/**
 * This is data minimization, not a general PII detector. The dictionary contains
 * only names and staff IDs loaded for this bounded snapshot. Never persist it
 * or reuse its namespace in another request. Duplicate name values deliberately
 * retain the existing SQL name-grouping semantics, not person-ID semantics.
 */
export function createIdentityProjection(values: readonly (string | null)[]) {
  const namespace = randomUUID();
  const replacements = new Map<string, string>();
  for (const value of values) {
    if (value !== null && !replacements.has(value)) {
      replacements.set(value, `person_${namespace}_${replacements.size + 1}`);
    }
  }
  // Longest first prevents a short known name from consuming a longer one.
  // Boundaries avoid rewriting identifiers such as customer_name for "customer".
  const alternatives = [...replacements.keys()]
    .filter(value => value.length > 0)
    .sort((a, b) => b.length - a.length)
    .map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = alternatives.length
    ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'giu')
    : null;
  const folded = new Map<string, string | null>();
  for (const [value, token] of replacements) {
    const key = value.toLowerCase();
    folded.set(key, folded.has(key) ? null : token);
  }

  return {
    /** Exact field projection preserves distinct values and anonymous customers. */
    identity(value: string): string {
      const token = replacements.get(value);
      if (token === undefined) throw new Error('Identity is outside the snapshot projection');
      return token;
    },
    /** Apply known-value protection to every user/assistant turn, not only the last. */
    redact(text: string): string {
      if (!pattern) return text;
      return text.replace(
        pattern,
        match =>
          replacements.get(match) ?? folded.get(match.toLowerCase()) ?? '[ambiguous identity]'
      );
    },
  };
}
