/**
 * @param {{
 *   stdout?: string | Buffer | null;
 *   stderr?: string | Buffer | null;
 *   error?: Error | null;
 * }} result
 */
export function getGhOutputText(result) {
  return [result.stdout, result.stderr, result.error?.message]
    .map(value => String(value ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * @param {string} context
 * @param {{
 *   stdout?: string | Buffer | null;
 *   stderr?: string | Buffer | null;
 *   error?: Error | null;
 * }} result
 */
export function formatGhFailure(context, result) {
  const outputText = getGhOutputText(result);

  if (outputText.length === 0) {
    return `${context}.`;
  }

  return `${context}: ${outputText}`;
}
