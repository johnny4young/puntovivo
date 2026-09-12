/**
 * Read top-level mappings out of pnpm-workspace.yaml without adding a YAML
 * runtime dependency. Every reader throws on a line it cannot classify: a
 * policy check that silently skips an unfamiliar spelling checks less while
 * still passing, which is worse than failing.
 */

export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Return the lines of one top-level mapping, without blank and comment lines. */
export function readWorkspaceSection(source, name) {
  const lines = source.split(/\r?\n/u);
  const start = lines.indexOf(`${name}:`);
  if (start === -1) throw new Error(`pnpm-workspace.yaml has no ${name} mapping`);

  const section = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z][\w-]*:/u.test(line)) break;
    if (/^\s*(?:#.*)?$/u.test(line)) continue;
    section.push(line);
  }
  return section;
}

/**
 * Parse the selectors of the packageExtensions mapping. Each entry is a
 * selector on its own line, optionally followed by a comment, and then its
 * indented extension block; any other shape throws.
 */
export function parseWorkspacePackageExtensionSelectors(source) {
  const selectors = [];
  for (const line of readWorkspaceSection(source, 'packageExtensions')) {
    if (/^\s{4}/u.test(line)) continue;

    const match = line.match(/^\s{2}('[^']+'|"[^"]+"|[^\s'"#][^:#]*?):\s*(?:#.*)?$/u);
    if (!match) {
      throw new Error(`Unsupported packageExtensions syntax: ${line.trim()}`);
    }

    const selector = unquoteYamlScalar(match[1]);
    if (selectors.includes(selector)) {
      throw new Error(`Duplicate packageExtensions selector ${selector}`);
    }
    selectors.push(selector);
  }
  return selectors;
}
