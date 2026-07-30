/**
 * Dependency-free Code 128 encoder for receipt HTML and ESC/POS output.
 *
 * Receipt identifiers are generated from printable ASCII, so Code Set B gives
 * us a deliberately small and deterministic contract: characters 32–126,
 * modulo-103 checksum, and no implicit character replacement. Invalid input
 * returns `null` so callers can preserve a truthful human-readable fallback.
 *
 * @module services/barcode128-encoder
 */

const CODE128_START_B = 104;
const CODE128_STOP = 106;
const CODE128_QUIET_ZONE_MODULES = 10;
const DEFAULT_BAR_HEIGHT = 48;
const HRI_HEIGHT = 14;

/**
 * Module widths for Code 128 values 0–106. Each entry alternates black and
 * white widths; the stop value has the specification's seventh terminal bar.
 */
const CODE128_PATTERNS: ReadonlyArray<ReadonlyArray<number>> = [
  [2, 1, 2, 2, 2, 2],
  [2, 2, 2, 1, 2, 2],
  [2, 2, 2, 2, 2, 1],
  [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2],
  [1, 3, 1, 2, 2, 2],
  [1, 2, 2, 2, 1, 3],
  [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2],
  [2, 2, 1, 2, 1, 3],
  [2, 2, 1, 3, 1, 2],
  [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2],
  [1, 2, 2, 1, 3, 2],
  [1, 2, 2, 2, 3, 1],
  [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2],
  [1, 2, 3, 2, 2, 1],
  [2, 2, 3, 2, 1, 1],
  [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1],
  [2, 1, 3, 2, 1, 2],
  [2, 2, 3, 1, 1, 2],
  [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2],
  [3, 2, 1, 1, 2, 2],
  [3, 2, 1, 2, 2, 1],
  [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2],
  [3, 2, 2, 2, 1, 1],
  [2, 1, 2, 1, 2, 3],
  [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1],
  [1, 1, 1, 3, 2, 3],
  [1, 3, 1, 1, 2, 3],
  [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3],
  [1, 3, 2, 1, 1, 3],
  [1, 3, 2, 3, 1, 1],
  [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3],
  [2, 3, 1, 3, 1, 1],
  [1, 1, 2, 1, 3, 3],
  [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1],
  [1, 1, 3, 1, 2, 3],
  [1, 1, 3, 3, 2, 1],
  [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1],
  [2, 1, 1, 3, 3, 1],
  [2, 3, 1, 1, 3, 1],
  [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1],
  [2, 1, 3, 1, 3, 1],
  [3, 1, 1, 1, 2, 3],
  [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1],
  [3, 1, 2, 1, 1, 3],
  [3, 1, 2, 3, 1, 1],
  [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1],
  [2, 2, 1, 4, 1, 1],
  [4, 3, 1, 1, 1, 1],
  [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2],
  [1, 2, 1, 1, 2, 4],
  [1, 2, 1, 4, 2, 1],
  [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1],
  [1, 1, 2, 2, 1, 4],
  [1, 1, 2, 4, 1, 2],
  [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1],
  [1, 4, 2, 1, 1, 2],
  [1, 4, 2, 2, 1, 1],
  [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4],
  [4, 1, 3, 1, 1, 1],
  [2, 4, 1, 1, 1, 2],
  [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2],
  [1, 2, 1, 1, 4, 2],
  [1, 2, 1, 2, 4, 1],
  [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2],
  [1, 2, 4, 2, 1, 1],
  [4, 1, 1, 2, 1, 2],
  [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1],
  [2, 1, 2, 1, 4, 1],
  [2, 1, 4, 1, 2, 1],
  [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3],
  [1, 1, 1, 3, 4, 1],
  [1, 3, 1, 1, 4, 1],
  [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1],
  [4, 1, 1, 1, 1, 3],
  [4, 1, 1, 3, 1, 1],
  [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1],
  [3, 1, 1, 1, 4, 1],
  [4, 1, 1, 1, 3, 1],
  [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4],
  [2, 1, 1, 2, 3, 2],
  [2, 3, 3, 1, 1, 1, 2],
];

export interface Code128SvgOptions {
  /** Height of the bars in SVG view-box units. */
  barHeight?: number;
}

export interface Code128EscposOptions {
  /** Barcode height in printer dots. Epson accepts 1–255. */
  heightDots?: number;
  /** Narrow-module width in printer dots. Epson accepts 2–6. */
  moduleWidth?: number;
  /**
   * Printable paper width in dots. When supplied, values that cannot retain a
   * 10-module quiet zone on both sides are rejected instead of asking the
   * printer to silently omit an over-wide barcode.
   */
  maxWidthDots?: number;
}

/**
 * Encode printable ASCII as Code Set B values, including start, checksum and
 * stop symbols.
 */
export function encodeCode128Values(source: string): number[] | null {
  if (!source || source.trim().length === 0) return null;

  const values: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const codePoint = source.charCodeAt(index);
    if (codePoint < 32 || codePoint > 126) return null;
    values.push(codePoint - 32);
  }

  const weighted = values.reduce(
    (checksum, value, index) => checksum + value * (index + 1),
    CODE128_START_B
  );
  const checksum = weighted % 103;
  return [CODE128_START_B, ...values, checksum, CODE128_STOP];
}

/**
 * Render Code 128 as a self-contained monochrome SVG. The quiet zone is part
 * of the view box, and the original value is printed as human-readable text.
 */
export function encodeCode128Svg(source: string, options: Code128SvgOptions = {}): string | null {
  const values = encodeCode128Values(source);
  if (!values) return null;

  const barHeight = clampInteger(options.barHeight ?? DEFAULT_BAR_HEIGHT, 24, 160);
  const bars: string[] = [];
  let cursor = CODE128_QUIET_ZONE_MODULES;

  for (const value of values) {
    const pattern = CODE128_PATTERNS[value];
    if (!pattern) return null;
    for (let index = 0; index < pattern.length; index += 1) {
      const width = pattern[index] ?? 0;
      if (index % 2 === 0) {
        bars.push(`M${cursor},0h${width}v${barHeight}h-${width}z`);
      }
      cursor += width;
    }
  }

  const totalWidth = cursor + CODE128_QUIET_ZONE_MODULES;
  const totalHeight = barHeight + HRI_HEIGHT;
  const safeSource = escapeXml(source);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${safeSource}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${bars.join('')}" fill="#000"/><text x="${totalWidth / 2}" y="${totalHeight - 2}" text-anchor="middle" font-family="monospace" font-size="10" fill="#000">${safeSource}</text></svg>`;
}

/**
 * Emit Epson ESC/POS Code 128 function-B commands. The data begins with `{B`
 * to select Code Set B; literal braces are doubled as required by the command.
 */
export function encodeCode128EscposBytes(
  source: string,
  options: Code128EscposOptions = {}
): number[] | null {
  if (!encodeCode128Values(source)) return null;

  const escapedSource = source.replaceAll('{', '{{');
  const data = `{B${escapedSource}`;
  if (data.length > 255) return null;

  const heightDots = clampInteger(options.heightDots ?? 96, 1, 255);
  const moduleWidth = clampInteger(options.moduleWidth ?? 2, 2, 6);
  if (options.maxWidthDots !== undefined) {
    const symbolWidthModules = code128SymbolWidthModules(source);
    const requiredWidthDots = (symbolWidthModules + CODE128_QUIET_ZONE_MODULES * 2) * moduleWidth;
    if (requiredWidthDots > options.maxWidthDots) return null;
  }
  const dataBytes = Array.from(data, char => char.charCodeAt(0));
  const GS = 0x1d;

  return [
    GS,
    0x68,
    heightDots,
    GS,
    0x77,
    moduleWidth,
    GS,
    0x48,
    0x02,
    GS,
    0x66,
    0x01,
    GS,
    0x6b,
    0x49,
    dataBytes.length,
    ...dataBytes,
    GS,
    0x48,
    0x00,
  ];
}

function code128SymbolWidthModules(source: string): number {
  // Start + data + checksum are 11 modules each; the stop symbol is 13.
  return (source.length + 2) * 11 + 13;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
