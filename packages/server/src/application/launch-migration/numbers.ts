/** ENG-123a/ENG-123d — Locale-independent spreadsheet number parsing. */
import type { ImportDecimalFormat } from '../../trpc/schemas/launchMigration.js';

function normalizeExplicitNumber(
  unsigned: string,
  decimalSeparator: '.' | ',',
  thousandsSeparator: '.' | ','
): string | null {
  const decimalParts = unsigned.split(decimalSeparator);
  if (decimalParts.length > 2) return null;
  const integerPart = decimalParts[0] ?? '';
  const fractionPart = decimalParts[1];
  const groups = integerPart.split(thousandsSeparator);
  if (
    groups.length > 1 &&
    (!/^[0-9]{1,3}$/.test(groups[0] ?? '') ||
      groups.slice(1).some(group => !/^[0-9]{3}$/.test(group)))
  ) {
    return null;
  }
  if (groups.length === 1 && !/^[0-9]+$/.test(integerPart)) return null;
  if (fractionPart !== undefined && !/^[0-9]+$/.test(fractionPart)) return null;
  return `${groups.join('')}${fractionPart === undefined ? '' : `.${fractionPart}`}`;
}

/**
 * Parse the two common spreadsheet number conventions without using the
 * process locale. Explicit modes are deterministic; auto treats the last of
 * comma/dot as the decimal separator and a plausible lone three-digit suffix
 * as a thousands group.
 */
export function parseImportNumber(
  raw: string | undefined,
  decimalFormat: ImportDecimalFormat
): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 0;
  // Accept common currency symbols, but never erase arbitrary characters.
  // Silently stripping letters/operators could turn values such as `abc12`
  // or `=1+1` into valid-looking prices.
  const spacedSource = trimmed.replace(/\u00a0/g, ' ');
  if (/[\t\r\n]/.test(spacedSource)) return null;
  const numericSource = spacedSource.replace(/[$€£¥₱₡₹-]/g, '').trim();
  if (
    numericSource.includes(' ') &&
    !/^[0-9]{1,3}(?: [0-9]{3})+(?:[.,][0-9]+)?$/.test(numericSource)
  ) {
    return null;
  }
  const compactSource = spacedSource.replace(/ /g, '');
  if ((compactSource.match(/[$€£¥₱₡₹]/g)?.length ?? 0) > 1) return null;
  if (!/^(?:(?:[$€£¥₱₡₹]-?)|(?:-?[$€£¥₱₡₹]?))[0-9][0-9.,]*(?:[$€£¥₱₡₹])?$/.test(compactSource)) {
    return null;
  }
  const compact = compactSource.replace(/[$€£¥₱₡₹]/g, '');
  if (!compact || !/^-?[0-9][0-9.,]*$/.test(compact)) return null;

  const sign = compact.startsWith('-') ? '-' : '';
  const unsigned = sign ? compact.slice(1) : compact;
  let normalizedUnsigned: string | null;

  if (decimalFormat === 'dot') {
    normalizedUnsigned = normalizeExplicitNumber(unsigned, '.', ',');
  } else if (decimalFormat === 'comma') {
    normalizedUnsigned = normalizeExplicitNumber(unsigned, ',', '.');
  } else {
    const lastComma = unsigned.lastIndexOf(',');
    const lastDot = unsigned.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      const decimalSeparator = lastComma > lastDot ? ',' : '.';
      normalizedUnsigned = normalizeExplicitNumber(
        unsigned,
        decimalSeparator,
        decimalSeparator === ',' ? '.' : ','
      );
    } else {
      const separator = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : null;
      if (!separator) {
        normalizedUnsigned = unsigned;
      } else {
        const pieces = unsigned.split(separator);
        const suffix = pieces.at(-1) ?? '';
        const validThousands =
          /^[0-9]{1,3}$/.test(pieces[0] ?? '') &&
          pieces.slice(1).every(group => /^[0-9]{3}$/.test(group));
        if (pieces.length > 2) {
          normalizedUnsigned = validThousands ? pieces.join('') : null;
        } else {
          normalizedUnsigned =
            suffix.length === 3 && validThousands
              ? pieces.join('')
              : /^[0-9]+$/.test(pieces[0] ?? '') && /^[0-9]+$/.test(suffix)
                ? `${pieces[0]}.${suffix}`
                : null;
        }
      }
    }
  }

  if (normalizedUnsigned === null) return null;
  const parsed = Number(`${sign}${normalizedUnsigned}`);
  return Number.isFinite(parsed) ? parsed : null;
}
