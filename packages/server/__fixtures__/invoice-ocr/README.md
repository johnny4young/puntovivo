# OCR benchmark fixtures ()

10 synthetic invoice fixtures used by the `benchmark:invoice-ocr` script in
`packages/server/scripts/benchmark-invoice-ocr.ts`. Each fixture is a triple:

| File             | Role                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NN-<slug>.html` | Source template. The fixture renders a realistic LATAM ticket / invoice.                                               |
| `NN-<slug>.png`  | Rendered image. The benchmark CLI reads this and feeds it to `extractInvoiceFromImage`. **Committed** — do not delete. |
| `NN-<slug>.json` | Hand-labelled ground truth: supplier metadata + the canonical `lines` array.                                           |

## Variety matrix

| #   | Slug          | Country | Lines | Twist                                         |
| --- | ------------- | ------- | ----- | --------------------------------------------- |
| 01  | cafe-mx       | MX      | 3     | small ticket, MXN, IVA 16%                    |
| 02  | super-co      | CO      | 7     | medium invoice, COP, IVA 19%                  |
| 03  | bakery-cl     | CL      | 4     | CLP, decimal thousands separator              |
| 04  | hardware-pe   | PE      | 6     | PEN, mixed kg + unit lines                    |
| 05  | pharmacy-mx   | MX      | 5     | small font, generic + brand columns           |
| 06  | farmacia-co   | CO      | 4     | discount line; truth keeps only product lines |
| 07  | restaurant-mx | MX      | 8     | large ticket with explicit propina line       |
| 08  | minimart-cl   | CL      | 3     | minimal layout, no per-line breakdown         |
| 09  | wholesale-co  | CO      | 9     | wholesale invoice with SKU column             |
| 10  | corner-mx     | MX      | 2     | very small ticket, low contrast (hard)        |

Total truth lines across the 10 fixtures: 51.

## Regenerating the PNGs

If a template changes, re-render the PNG with the workspace script:

```
node packages/server/scripts/generate-invoice-ocr-fixtures.mjs
```

The script uses the workspace-root Playwright install (`playwright` package
already pulled in for E2E). It enumerates every `*.html` file in this directory
and writes the matching `*.png` next to it via Chromium's screenshot API.

## Running the benchmark

```
OPENAI_API_KEY=sk-... npm run benchmark:invoice-ocr --workspace=@puntovivo/server
```

Acceptance: aggregate accuracy ≥ 0.80 (sum-of-matched / sum-of-truth across all
10 fixtures). Exit code `0` on pass, `1` on fail. Real OpenAI vision calls
consume the demo tenant's monthly budget; ~$0.05-0.15 per full run.
