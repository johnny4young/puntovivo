/**
 * Print tokens for thermal-receipt rendering.
 *
 * Mirrors the `--print-*` custom properties published by ENG-080 in
 * `apps/web/src/styles/theme.css` (the `:root` block tagged
 * `ENG-080 + ENG-080b — print tokens`). The web stylesheet is the
 * canonical source for the design-system tokens that the editor
 * preview iframe and screen consumers inherit; this constant is the
 * server-side mirror so the receipt renderer (which generates an
 * isolated HTML document the iframe loads via `srcDoc`) can embed
 * the same values without pulling the web stylesheet at build time.
 *
 * If you change a value here, update `theme.css` in the same diff so
 * the two surfaces stay aligned — the JSDoc cross-link below makes the
 * drift visible at review time.
 *
 * Hard rules from the 2026-05-15 handoff
 * (`preview/25-print-thermal.html`):
 *
 *   - 1-bit only: pure `#000` ink on `#fff` paper. No grays, no
 *     gradients, no opacity-based shading.
 *   - Monospace numerics with `font-variant-numeric: tabular-nums` so
 *     columns line up under poor ESC/POS rasterization.
 *   - Borders ≥ 1 px. Hairlines disappear on the print head.
 *   - Fixed pixel widths at the real DPI — never percentages.
 *   - Text ≥ 10 pt; the driver rounds anything below.
 *   - Wordmark belongs in the header band, not as a watermark.
 *
 * The dot counts (`58mm-dots`, `80mm-dots`) match the `203 dpi`
 * spec: 58 mm × 203 dpi ÷ 25.4 mm/in ≈ 384 dots,
 * 80 mm × 203 dpi ÷ 25.4 mm/in ≈ 576 dots.
 *
 * @module services/print-tokens
 */

export const PRINT_TOKENS = {
  /** Target printer resolution in dots per inch (most ESC/POS units). */
  dpi: 203,
  /** Live printable width for a 58 mm roll, in dots. */
  paper58mmDots: 384,
  /** Live printable width for an 80 mm roll, in dots. */
  paper80mmDots: 576,
  /**
   * Monospace stack used everywhere on the receipt. IBM Plex Mono is
   * the handoff-preferred face; JetBrains Mono / Menlo / Consolas /
   * ui-monospace are the OS-resident fallbacks for hosts that have
   * not installed Plex.
   */
  monoFace:
    "'IBM Plex Mono','JetBrains Mono','Menlo','Consolas',ui-monospace,monospace",
  /**
   * Sans-serif stack used by the `puntovivo·` wordmark only. Inter
   * Tight is the handoff face; if the host has not bundled it the
   * stack falls back to plain Inter and then to the OS sans.
   */
  brandFace:
    "'Inter Tight','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  /** Minimum label text size — the driver rounds anything smaller. */
  minSize: '10pt',
  /** Body text size — items table cells, totals lines, footer. */
  bodySize: '11pt',
  /** Grand-total size — dominates the column for fast scanning. */
  totalSize: '14pt',
  /** Pure black ink. */
  ink: '#000',
  /** Pure white paper. */
  paper: '#fff',
} as const;

export type PrintTokens = typeof PRINT_TOKENS;
