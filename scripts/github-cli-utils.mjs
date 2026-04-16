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

/**
 * `gh release view` does not expose a stable machine-readable not-found code,
 * so we intentionally match the known 404/release-missing responses and treat
 * everything else as an operational failure that should stop the workflow.
 *
 * @param {{
 *   status?: number | null;
 *   stdout?: string | Buffer | null;
 *   stderr?: string | Buffer | null;
 *   error?: Error | null;
 * }} result
 */
export function isMissingReleaseLookup(result) {
  if (result.status === 0) {
    return false;
  }

  const outputText = getGhOutputText(result);
  return /release\b.*\bnot found\b/i.test(outputText) || /\b404\b/.test(outputText);
}
