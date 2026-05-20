# Website Capability Audit

Source reviewed on 2026-05-15:

- Handoff ZIP: `/Users/johnny4young/Personal/projects/ideas/puntovivo/Puntovivo Design System-handoff 20260515.zip`
- Extracted files: `website/index.html`, `website/site.jsx`, `website/ai-section.jsx`, `apps/ai-handoff.html`

Purpose: keep the future public website aligned with real product capability. A website claim is safe only when the app already supports it or when the claim is explicitly framed as roadmap / beta / gated.

## Capability Matrix

| Website claim | Current product support | Action |
| --- | --- | --- |
| POS sales with SKU / barcode search, quantities, discounts, split payments and cash sessions | Mostly supported: sales, cart, cash-session guard, split payments and refunds exist. Physical barcode scanner behavior is not validated as a hardware flow. | Keep the software POS claim. Track physical USB scanner in `ENG-096` before claiming plug-and-play scanner support. |
| Blind cash close by denomination, cash movements and difference reporting | Supported by cash-session flows and control views. | Safe to claim. |
| Multi-site / multi-tenant isolation, per-site inventory, transfers and audit logs | Supported by tenant-scoped routers, site selector, inventory balances, transfers and audit logging. | Safe to claim. |
| Purchases, purchase orders, partial receiving, supplier returns and quotations | Supported by purchases/orders/quotations surfaces. OCR-created purchases now enter as `draft` for review. | Safe to claim, but say OCR creates a draft purchase until the operator completes it. |
| Bilingual ES / EN console | Supported by i18n namespaces and locale parity tests. | Safe to claim. |
| Fiscal / DIAN readiness | Partially supported: domain model, mock adapter and reports exist; real PT integration is gated. | Do not imply production DIAN issuance until `ENG-021` is cleared with a Proveedor Tecnologico. |
| Receipt templates and thermal 58 / 80 mm receipts | HTML receipt template support exists. ESC/POS printer transport and cash drawer pulse are not fully shipped. | Qualify as receipt-template support now; claim physical ESC/POS printing only after `ENG-097`. |
| AI Co-pilot with SQL visible, charts and cost footer | Backend/read-only SQL foundations exist, but the website's full two-column visual contract and hard-audit mode are roadmap. | Keep as roadmap/beta until `ENG-095b` ships. |
| AI anomaly detection by cashier | Statistical anomaly foundations exist, but website severity cards/dialog behavior still need the visual slice. | Keep as roadmap/beta until `ENG-095b` ships. |
| Semantic product search by meaning | Foundations exist, and invoice OCR matching can use embeddings best-effort. Product-search UI still needs the final toggle/results treatment. | Keep as roadmap/beta until `ENG-095b` ships. |
| OCR de factura: image/PDF upload -> provider, lines, IVA, totals -> purchase draft | Implemented in this slice for PNG/JPG/PDF up to 10 MB, using Textract as the only wired provider. The operator must review every field before confirming. | Safe to claim as review-first OCR, with provider availability tied to tenant credentials. |
| OCR providers Textract / DocAI / Azure | Textract is wired. DocAI and Azure are selectable only as future providers and should not be presented as working. | Track DocAI/Azure in `ENG-101`. |
| AI feature switches in Configuración > IA | Supported by tenant AI settings and four per-feature toggles. Defaults are off. | Safe to claim toggles. Do not claim all features are on by default. |
| AI costs / quotas: 800 Co-pilot questions and 200 OCR invoices per site | **Enforced by ENG-102 (2026-05-19)**: `services/ai/quotas.ts` runs the cap before each AI call; the `idx_ai_audit_log_tenant_site_created` index counts successful calls per (tenant, site, feature) in the current calendar month; calls past the cap throw `AI_QUOTA_EXCEEDED`. The admin panel surfaces the residual capacity. | Safe to claim now. Tuning the limits is a single-file edit at `services/ai/quotas.ts::AI_QUOTAS` plus a new build. |
| "100% Offline-first" | Overstates current behavior. Core local operation and sync are offline-first, but setup, authentication, provider OCR and some hub/client handshakes need connectivity. | Replace with "offline-first sync" language and back it with the offline capability grid in `ENG-100`. |
| KDS / comanda | Restaurant table/floor foundations exist, but kitchen display queue is not shipped. | Track in `ENG-098`; keep as roadmap until shipped. |
| Voice payment / Cobro por voz | Voice cart entry exists, but payment terminal handoff by voice is not shipped. | Track in `ENG-099`; keep as roadmap until shipped. |

## Tile Catalog (source of truth)

Closed by **ENG-100** on 2026-05-19. `apps/web/src/features/offline/OfflineCapabilityCatalog.ts` exports `OFFLINE_CAPABILITY_CATALOG` as the canonical set of six tiles the cashier sees when the device drops off the hub. The future public website must consume this table as authoritative copy — no marketing claim is allowed to exceed the `status` declared in the matching tile.

| id | status | Spanish (es) | English (en) | Backing feature |
| --- | --- | --- | --- | --- |
| `sell` | `available` | Vender — Catálogo local | Sell — Local catalog | ENG-088 local product cache |
| `cash` | `available` | Cobrar efectivo — Sin restricciones | Take cash — No restrictions | ENG-090 + ENG-014 offline sale completion (cash and split cash + credit) |
| `card` | `limited` | Cobrar tarjeta — Pendiente de autorización | Take card — Pending authorization | Payment terminal requires online connection |
| `receipt` | `limited` | Recibo digital — Se envía al reconectar | Digital receipt — Sent on reconnect | Sync queue + receipt template — delivery deferred |
| `loyalty` | `pending` | Sumar puntos — Se acreditan al sincronizar | Earn points — Credited on sync | Loyalty queue pending — points reconcile on reconnect |
| `inventory` | `blocked` | Ajustar inventario — Requiere hub conectado | Adjust inventory — Hub required | Hub coordination needed for stock writes |

Rules enforced by the audit test `apps/web/src/features/offline/__tests__/OfflineCapabilityGrid.audit.test.ts`:

1. Cardinality is fixed at six tiles — adding a seventh requires updating this table in the same commit.
2. Tile ids belong to the closed set listed above.
3. `status` is one of `available | limited | pending | blocked` and must reflect the real runtime behavior of the backing feature.
4. Every `available` tile must point at a documented shipped feature (referenced in `AVAILABLE_TILE_BACKING_FEATURE` inside the test).
5. `limited` / `pending` / `blocked` tile copy never uses absolute language (`100%`, `siempre`, `always`, `totalmente`, `totally`, `completamente`, `fully`) in either locale.

Drift between this table and the exported catalog is a review-time block. The audit test pins the runtime catalog shape; the reviewer must keep this table synchronized before commit.

## Copy Corrections Before Publishing

- Replace absolute "100% Offline-first" with: "Caja local y sincronización offline-first; los cambios pendientes se suben cuando vuelve la conexión."
- Replace "Las cuatro están en ON por defecto" with: "Cada capacidad se activa desde Configuración > IA; por defecto quedan apagadas hasta que el negocio las habilite."
- Remove token/usage quotas from pricing until billing and enforcement exist.
- Qualify hardware claims: "compatible con flujos de recibo térmico" is safe; "imprime en Epson / abre cajón" waits for `ENG-097`.
- Qualify AI provider claims: "Textract disponible con credenciales del tenant" is safe; DocAI/Azure wait for `ENG-101`.
- Keep the OCR FAQ microcopy aligned with product copy: "La IA leyó la factura. Revisa cada campo antes de registrar la compra."

## Handoff Assets

All PNG screenshots present in the ZIP were extracted under `/private/tmp/puntovivo-handoff-20260515-codex/uploads/` and `/private/tmp/puntovivo-handoff-20260515-codex/_debug/`. They must be treated as local handoff artifacts, not durable public links. Any PR / release note that needs screenshots should capture fresh images into a repo-owned `docs/qa/` path or attach them directly to the PR, instead of linking back to the temporary extraction directory.
