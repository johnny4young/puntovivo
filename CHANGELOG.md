# Changelog

All notable product changes to Puntovivo are documented here.

---

## Unreleased

This work follows v1.9.0 and is validated on an isolated candidate branch. It
is usable from source, but it is not a new packaged release yet.

### What changes for store operators

- **Safer catalog migration.** The importer recognizes the tested export
  layouts for Loyverse, Alegra, Siigo, and World Office, selects a versioned
  mapping profile, and still requires the operator to review every mapping and
  preview before saving. Unknown or changed layouts fall back to the generic
  importer instead of guessing.
- **A practical WhatsApp receipt handoff.** From a completed sale, an operator
  can prepare a receipt image locally and open WhatsApp with customer-facing
  receipt text. Puntovivo does not send in the background: the operator reviews,
  attaches the downloaded image when desired, and sends from WhatsApp.
- **More trustworthy Co-pilot answers.** Administrators can choose a
  verified-results-only mode that keeps the executed SQL, row count, table, and
  deterministic chart visible while suppressing generated narrative.
- **Real integration delivery.** A deliberately small business-event contract
  can reach fixed HTTPS webhook destinations with signatures, stable
  idempotency, bounded retries, dead-letter recovery, and operator-visible
  evidence. This is not a general public REST API or a connector marketplace.
- **Actionable external incident delivery.** Sync, fiscal, device, and payment
  incidents can be delivered to a provisioned signed-HTTPS receiver, retried,
  acknowledged, and audited without hiding the in-product incident when the
  receiver fails.
- **Complete local AI usage accounting.** Language, OCR, voice, catalog,
  invoice-match, and semantic-query provider attempts now share the tenant
  budget and audit path. Costs are labelled as estimates, local zero, unknown,
  or not incurred; provider invoices and quotas remain authoritative.

### Reliability work behind the scenes

- Packaged encrypted recovery now has an automated rehearsal and evidence gate.
  Candidate `fc0439d5` passed the real packaged runtime, first-login renderer,
  and all nine recovery checks on Linux, macOS, and Windows in
  [run 30764351491](https://github.com/johnny4young/puntovivo/actions/runs/30764351491).
  These are manual candidate packages, not a newly signed release or a
  production recovery-time guarantee.
- The packaged renderer smoke now uses the shutdown path proven clean for each
  operating system while still failing on every unexpected Electron warning or
  error; no teardown diagnostic was hidden or allowlisted.
- The public website and project status distinguish implemented software paths
  from external proof. DIAN certification, representative hardware validation,
  a real alert receiver with ownership, and an observed retail pilot remain
  open gates.

## [1.11.0](https://github.com/johnny4young/puntovivo/compare/v1.10.2...v1.11.0) (2026-08-20)


### Features

* **desktop:** evaluate Electron 43 runtime on the 43.4.1 line ([#208](https://github.com/johnny4young/puntovivo/issues/208)) ([56f40f7](https://github.com/johnny4young/puntovivo/commit/56f40f7301b80e33044c94f3ae718fcb756cf7d1))
* **fonts:** self-host font families, drop the font CDN, realign types node ([#201](https://github.com/johnny4young/puntovivo/issues/201)) ([7a72fdd](https://github.com/johnny4young/puntovivo/commit/7a72fdd68841b95b427559529c55cc65c8d102f0))
* **security:** add expiring, machine-verified advisory dispositions ([#204](https://github.com/johnny4young/puntovivo/issues/204)) ([cab906b](https://github.com/johnny4young/puntovivo/commit/cab906b39fbe7c6626014aa4a35dba4346e4af3a))
* **tables:** migrate DataTable to TanStack Table v9 ([#206](https://github.com/johnny4young/puntovivo/issues/206)) ([dc674b4](https://github.com/johnny4young/puntovivo/commit/dc674b4c9a1201b0151de37e68d820d67ccc65e9))


### Bug Fixes

* **a11y:** run one axe engine across the unit and browser gates ([#205](https://github.com/johnny4young/puntovivo/issues/205)) ([3c51c50](https://github.com/johnny4young/puntovivo/commit/3c51c50a3bee38541b5162231a252e420099cbd0))
* **perf:** extend lighthouse sampling only on undecidable score spreads ([#203](https://github.com/johnny4young/puntovivo/issues/203)) ([38bc867](https://github.com/johnny4young/puntovivo/commit/38bc86740cb2e26069e74bbd40cce3a1f4016bba))

## [1.10.2](https://github.com/johnny4young/puntovivo/compare/v1.10.1...v1.10.2) (2026-08-13)


### Bug Fixes

* **ci:** run standalone pnpm binaries directly ([cb0ba19](https://github.com/johnny4young/puntovivo/commit/cb0ba1977a9e7fa8ac3681eddf4b1e85f5eb05b4))
* **db:** publish connections atomically ([e20a6c2](https://github.com/johnny4young/puntovivo/commit/e20a6c25ed34e0178d66fcf2d0b3356d217c0fd7))
* harden runtime, search and release tooling ([2618096](https://github.com/johnny4young/puntovivo/commit/261809670eb9d6ac74c1b0fa3cb6417473de5e95))
* **receipts:** bound receipt image capture ([c390077](https://github.com/johnny4young/puntovivo/commit/c390077a5261e7cd75e3ec368f178e871603dd77))
* **server:** clean failed bootstrap resources ([795f0c6](https://github.com/johnny4young/puntovivo/commit/795f0c690d88db9d8d79a58c333e2bf936552a19))
* **server:** drain workers before database close ([7b0b111](https://github.com/johnny4young/puntovivo/commit/7b0b111f85886362041118b8a8ae788b2834b2db))
* **web:** batch virtualizer updates on React 19 ([6a18ac0](https://github.com/johnny4young/puntovivo/commit/6a18ac05b784540ce1cd12b1026dc1547e56715f))
* **web:** harden long-shift renderer lifecycles ([8f60065](https://github.com/johnny4young/puntovivo/commit/8f600655157e3a917b2e1a45c94aacde9ba4819e))
* **web:** move Electron helper into runtime module ([93f5632](https://github.com/johnny4young/puntovivo/commit/93f5632ee2bd465d2f8ebbebc547c336b2c57658))
* **website:** patch standalone build dependencies ([0e818fc](https://github.com/johnny4young/puntovivo/commit/0e818fcb277636d5f19194968716a724a7449eef))


### Performance

* **products:** add tenant-safe FTS search ([0cf95b5](https://github.com/johnny4young/puntovivo/commit/0cf95b53351728b6250712f4daeceb1670b6863b))
* **products:** bound semantic search candidates ([98826f1](https://github.com/johnny4young/puntovivo/commit/98826f19a9dd81f4abf2f23f1a092e52c6dec05c))
* **products:** index exact code search ([6a8b5d4](https://github.com/johnny4young/puntovivo/commit/6a8b5d4bc9719b08ab50067a5d46b37823679e9b))
* **search:** benchmark and compact product vectors ([7f4c360](https://github.com/johnny4young/puntovivo/commit/7f4c360b5986c493d1fe1a38526ee9fe962036b6))

## [1.10.1](https://github.com/johnny4young/puntovivo/compare/v1.10.0...v1.10.1) (2026-08-08)


### Bug Fixes

* **deps:** hold react-virtual below the flushSync regression, raise the js-yaml floor ([#193](https://github.com/johnny4young/puntovivo/issues/193)) ([266b8a4](https://github.com/johnny4young/puntovivo/commit/266b8a43ba05b48257ff3745319862d6720c3638))

## [1.10.0](https://github.com/johnny4young/puntovivo/compare/v1.9.0...v1.10.0) (2026-08-05)


### Features

* deliver the validated operations and recovery wave ([#181](https://github.com/johnny4young/puntovivo/issues/181)) ([b6430f1](https://github.com/johnny4young/puntovivo/commit/b6430f11542802fa90f52a20d115fc771c0bc5cd))


### Bug Fixes

* **deps:** raise transitive security floors ([#186](https://github.com/johnny4young/puntovivo/issues/186)) ([a305e0a](https://github.com/johnny4young/puntovivo/commit/a305e0adcd1896f0dbae815e85e84622c4e47048))
* **release:** stop pinning the app version in recovery evidence tests ([#189](https://github.com/johnny4young/puntovivo/issues/189)) ([a25e09b](https://github.com/johnny4young/puntovivo/commit/a25e09b8e10daf9adea7bdd802ca47cb17d56cf0))

## [1.9.0](https://github.com/johnny4young/puntovivo/compare/v1.8.1...v1.9.0) (2026-08-01)


### Features

* **approvals:** approve checkout inline ([d0c92bb](https://github.com/johnny4young/puntovivo/commit/d0c92bba8556b9463f615a593cf92c334bfdc0b2))
* **auth:** renew Store Hub sessions ([e258912](https://github.com/johnny4young/puntovivo/commit/e2589126945bcb28a7515042410ad876d054bdc2))
* **categories:** simplify category creation ([14283e4](https://github.com/johnny4young/puntovivo/commit/14283e4cd8d87d5245c72393f89e44529ca1ebb5))
* **company:** add guided business setup ([498ddde](https://github.com/johnny4young/puntovivo/commit/498ddde0f9452063b79b97e702338549aaa49fbe))
* **customer-catalogs:** simplify fiscal setup ([af07d63](https://github.com/johnny4young/puntovivo/commit/af07d636f069983d24e51ebcd0428a7d0e5e8145))
* **customers:** simplify customer creation ([583e159](https://github.com/johnny4young/puntovivo/commit/583e15988ae3873a0a582a3b80023b5b65b9de77))
* **design-system:** add task-oriented primitives ([d2ca234](https://github.com/johnny4young/puntovivo/commit/d2ca234c9f697fcb66cd5e4f5656bb05751aca93))
* **design-system:** complete task-oriented surfaces ([cab23e5](https://github.com/johnny4young/puntovivo/commit/cab23e51c7646d6384fca1640e19a6f668fb505b))
* **geography:** guide location setup ([e348862](https://github.com/johnny4young/puntovivo/commit/e348862495ca41aa549ed064aae9e17e349fa36e))
* **inventory:** audit stock transfers ([c92bed7](https://github.com/johnny4young/puntovivo/commit/c92bed73132f094d2cd769571d10980b0b700b74))
* **locations:** simplify location creation ([39dea1b](https://github.com/johnny4young/puntovivo/commit/39dea1b9c7c1d6be5e0d6c04f561b68e7e5e9245))
* **navigation:** add task-first experience layer ([0434274](https://github.com/johnny4young/puntovivo/commit/0434274fff947c74e1b69811f0bcb7bb5ce3a6e5))
* **navigation:** simplify advanced tools ([6155304](https://github.com/johnny4young/puntovivo/commit/61553049d34c9dc69ba4a34e12158f63952bc914))
* **observability:** add privacy-safe task measurement ([af49675](https://github.com/johnny4young/puntovivo/commit/af496750e99f6ae549c5ec31168d61fc14b82462))
* **observability:** measure real payment recovery ([fc88826](https://github.com/johnny4young/puntovivo/commit/fc888268e086582adfdbc905b2e63c51d3e4f169))
* **operations:** add emergency recovery playbooks ([9b3beff](https://github.com/johnny4young/puntovivo/commit/9b3beff42a660618e34fec079b38192cb23331a6))
* **operations:** establish recovery ownership ([78f2f3f](https://github.com/johnny4young/puntovivo/commit/78f2f3f9ceb06180f8f3b78c908242bd8fa0f4fc))
* **operations:** focus recovery handoffs ([75467b8](https://github.com/johnny4young/puntovivo/commit/75467b8d7a9d4c940072fcb2bac0103435bee5d6))
* **operations:** simplify recovery guidance ([f2c2bbd](https://github.com/johnny4young/puntovivo/commit/f2c2bbd674d19daa989888ed932f99ca26447afc))
* **products:** add progressive quick creation ([98fa1b8](https://github.com/johnny4young/puntovivo/commit/98fa1b800bada7b481a854adde7d951fcab112a9))
* **providers:** simplify provider creation ([6051f8a](https://github.com/johnny4young/puntovivo/commit/6051f8aa81d1e5e7f097255faacca6404a6a3bcd))
* **purchases:** audit inventory receipts ([5b58a22](https://github.com/johnny4young/puntovivo/commit/5b58a22bdba21a6fac8cd3b6354b692661b4f5c5))
* **realtime:** authenticate Store Hub streams ([3bd7ae1](https://github.com/johnny4young/puntovivo/commit/3bd7ae1ca31dfea1c54c1859ebe50480d747b85a))
* **receipts:** preserve sale-time display labels ([db2fdf8](https://github.com/johnny4young/puntovivo/commit/db2fdf8f9adec09cc45b8d8cf58723901b923d35))
* **receipts:** preserve sale-time identity ([cebe78a](https://github.com/johnny4young/puntovivo/commit/cebe78ac3a79dc61d30be289bed508ae80705ecc))
* **receipts:** preserve sale-time presentation ([d4dcb7a](https://github.com/johnny4young/puntovivo/commit/d4dcb7afe83477156fc9c2acc26dbc9396125135))
* **receipts:** render Code 128 barcodes ([c928a12](https://github.com/johnny4young/puntovivo/commit/c928a12b891fa5d61a66fd6c516a4b6756195e6d))
* **receipts:** simplify template editing ([7e61bad](https://github.com/johnny4young/puntovivo/commit/7e61bada6d1e95d19fd9e361283036f0f44b8963))
* **receipts:** use templates for runtime printing ([b9e5f06](https://github.com/johnny4young/puntovivo/commit/b9e5f069660d767ccec389e1dc28af43693a86f9))
* **release:** bind desktop candidates to immutable evidence ([456b955](https://github.com/johnny4young/puntovivo/commit/456b955221ce2581011fc9cf2dca281ee03285a2))
* **release:** measure desktop distribution trust instead of declaring it ([259f0b9](https://github.com/johnny4young/puntovivo/commit/259f0b9b388ac1a53fbb5a095e2629d5b9b99813))
* **sales:** simplify the first checkout viewport ([abeaa92](https://github.com/johnny4young/puntovivo/commit/abeaa92d70b7320b47b034576d9b6c783200c51d))
* **sequentials:** simplify numbering setup ([8107b2e](https://github.com/johnny4young/puntovivo/commit/8107b2e33a4fce84c4725d6de2d089c23091c7fe))
* **ui:** complete Operator Deck adoption ([4f4a826](https://github.com/johnny4young/puntovivo/commit/4f4a8267bc999b217bb3fbb7494980ac4133cb9f))
* **ui:** establish Operator Deck foundation ([db5bd0e](https://github.com/johnny4young/puntovivo/commit/db5bd0e703d5440b33bf6bccc7e8dad7676dca94))
* **units:** simplify unit creation ([79489f0](https://github.com/johnny4young/puntovivo/commit/79489f04c9f916c7abbfd177b145395cea31da37))
* **vat-rates:** simplify rate creation ([f5dd2d7](https://github.com/johnny4young/puntovivo/commit/f5dd2d77e73d64c4d9f0588627dc1d2efce4098f))


### Bug Fixes

* **auth:** clear rejected refresh cookies ([03028ff](https://github.com/johnny4young/puntovivo/commit/03028ffaebe782f70a10cf128b2ae6c2cc2d06ea))
* **auth:** preserve desktop staff handoff ([b6d50c8](https://github.com/johnny4young/puntovivo/commit/b6d50c8d11177a20ecc45b4ca719b05e6d2f1824))
* **ci:** align pnpm bootstrap version ([b46e1a8](https://github.com/johnny4young/puntovivo/commit/b46e1a8da6b5e9d3c0de1f003a10450ff6e12620))
* **ci:** eliminate hidden validation diagnostics ([e96d3d3](https://github.com/johnny4young/puntovivo/commit/e96d3d333f0e61ec09e60ee27f53f67e91b2949a))
* **ci:** enforce warning-free quality gates ([d32f4a5](https://github.com/johnny4young/puntovivo/commit/d32f4a55d0b80a989495c29a3c008706c0df224e))
* **ci:** fetch path-filter base revision ([78e82db](https://github.com/johnny4young/puntovivo/commit/78e82db2e5c4f616aed31589e5c6058c8929576a))
* **copy:** replace tenant jargon ([65e9ee6](https://github.com/johnny4young/puntovivo/commit/65e9ee68d5744ace86430936874d159bd8d0aba4))
* **customer-catalogs:** localize seeded names ([33c58c1](https://github.com/johnny4young/puntovivo/commit/33c58c1f0a4e6c3089e744b959b52e892280ab10))
* **database:** prove and repair incremental recovery ([#166](https://github.com/johnny4young/puntovivo/issues/166)) ([a95bd48](https://github.com/johnny4young/puntovivo/commit/a95bd48d4fef06f45910894ccfec5fc9de898fc7))
* **database:** reconcile migration tracking drift ([3991f2c](https://github.com/johnny4young/puntovivo/commit/3991f2c1b38bb495d76eb43104d00fae9347e78c))
* **database:** recover materialized migration tracking ([d4a33c1](https://github.com/johnny4young/puntovivo/commit/d4a33c1e6711493d70b9c768afe8565607b10594))
* **desktop:** harden cross-platform candidate validation ([1b60a23](https://github.com/johnny4young/puntovivo/commit/1b60a2364b9b39f8bf118421995ded2c70be2d8f))
* **desktop:** honor portal settings variant contract ([b7fa44c](https://github.com/johnny4young/puntovivo/commit/b7fa44c0930e844131a55df17d4d089d3a082589))
* **desktop:** inherit Linux smoke display ([2b300f9](https://github.com/johnny4young/puntovivo/commit/2b300f91ac0c5950925ab84d01c1bcc06e1177ff))
* **desktop:** isolate Linux portal smoke ([b2c941c](https://github.com/johnny4young/puntovivo/commit/b2c941c858b6e94befc3d55e3c1f173f8701c03d))
* **desktop:** package Electron ABI on every platform ([7929f10](https://github.com/johnny4young/puntovivo/commit/7929f10dc2fcaf98f69fbd6abd448ba59d844748))
* **desktop:** rebuild only ABI-sensitive native addon ([9dcf04e](https://github.com/johnny4young/puntovivo/commit/9dcf04e69729ca133c89c508c11737cd3e62e744))
* **desktop:** run native rebuild without shell shims ([0681885](https://github.com/johnny4young/puntovivo/commit/0681885a169b1410ee901d03baea3db5025115ad))
* **desktop:** serve the packaged renderer from a secure origin ([fa3e37b](https://github.com/johnny4young/puntovivo/commit/fa3e37bb2a371b2bdafa18e9923248ae256352ad))
* **e2e:** stop leaking packaged app processes and racing the login redirect ([84d4570](https://github.com/johnny4young/puntovivo/commit/84d457065ba081b68a7161497564fc7c0dfc32cd))
* **errors:** interpolate server error details instead of showing the template ([161c96b](https://github.com/johnny4young/puntovivo/commit/161c96b235d2bef326fc37e804cd18f6e9e5c198))
* **fiscal:** keep demo proof local ([4675b1d](https://github.com/johnny4young/puntovivo/commit/4675b1d6c9a6d4f37898a2da283620125eb98090))
* **peripherals:** use plain device language ([26e7383](https://github.com/johnny4young/puntovivo/commit/26e73832c19cb0c5959f0f59a863d3ffae2483c2))
* **products:** protect unsaved product drafts ([4ffed31](https://github.com/johnny4young/puntovivo/commit/4ffed31f92ff7dde4fac5ca2cac42e3c69d699f1))
* **receipts:** fit previews to the viewport ([3a7c930](https://github.com/johnny4young/puntovivo/commit/3a7c93070eaff46e421c33a86751287c6150786a))
* **receipts:** localize customer-facing labels ([8ac54b4](https://github.com/johnny4young/puntovivo/commit/8ac54b49f66f4d6de42e7eca83c8af3b88e9fbde))
* **receipts:** localize template timestamps ([8730916](https://github.com/johnny4young/puntovivo/commit/8730916bf1a1256094f4df89158fb6b2cd1a3c7a))
* **receipts:** protect unsaved template changes ([75ad766](https://github.com/johnny4young/puntovivo/commit/75ad76665c3241ea999746f9c0fe025e612479de))
* **receipts:** use plain template language ([6d9b01e](https://github.com/johnny4young/puntovivo/commit/6d9b01e91c4a0afa12e8225312711e1141b25e06))
* **release:** close phase 1 validation gaps ([eae6d5a](https://github.com/johnny4young/puntovivo/commit/eae6d5ac3f3ce52ce0b8302ffa5caf08adc8b393))
* **release:** make desktop smoke teardown hermetic ([89ed462](https://github.com/johnny4young/puntovivo/commit/89ed462254080d6e09cfae43f5376c46f9bc55e9))
* **release:** map Linux artifact architecture ([0034569](https://github.com/johnny4young/puntovivo/commit/0034569c769d5794f4c8dc8799e82c632664978b))
* **release:** require packaged runtime smoke ([5579f7f](https://github.com/johnny4young/puntovivo/commit/5579f7f248d216bfc22bfc9d0bc7380c45d93459))
* **release:** stabilize cross-platform runtime smoke ([b9d3328](https://github.com/johnny4young/puntovivo/commit/b9d332809bf33c3a88e3a14ceadfc2650fe98b6e))
* **reliability:** stabilize release baseline ([073fb8f](https://github.com/johnny4young/puntovivo/commit/073fb8ff119a28e125ecc6d81e5342bf2f0324a2))
* **sales:** defer closed overlay bundles ([73f03a9](https://github.com/johnny4young/puntovivo/commit/73f03a98eb17e4cd0047c24106897fe039e812da))
* **sales:** isolate secondary query observers ([c60d25a](https://github.com/johnny4young/puntovivo/commit/c60d25a4e9fe55f0a21d78619cda75812a914bea))
* **sales:** remove first-paint query contention ([262f690](https://github.com/johnny4young/puntovivo/commit/262f6905fd318826294393d4bc7983aaa48aa671))
* **sales:** stabilize the performance gate ([076d224](https://github.com/johnny4young/puntovivo/commit/076d2248da8ed4bc2d10222ee54ea6675e1a4d20))


### Performance

* **desktop:** enforce operational continuity ([d51514f](https://github.com/johnny4young/puntovivo/commit/d51514f513a462334f0196a7f0ffd181d6143cc9))
* **server:** enforce store-scale read profile ([6129801](https://github.com/johnny4young/puntovivo/commit/6129801600dd0f07f716e94fef0344b92364d43b))


### Refactors

* **website:** rebuild the marketing site on Astro without a client framework ([0413d72](https://github.com/johnny4young/puntovivo/commit/0413d72821f18838ebc93388b0681a1d5c25983e))

## [1.8.1](https://github.com/johnny4young/puntovivo/compare/v1.8.0...v1.8.1) (2026-07-20)


### Bug Fixes

* **build:** invoke shared compiler portably ([fe36d4e](https://github.com/johnny4young/puntovivo/commit/fe36d4ef65cfaedab4b84ed82ab6663eb046f057))

## [1.8.0](https://github.com/johnny4young/puntovivo/compare/v1.7.0...v1.8.0) (2026-07-19)

### Features

- Staff attendance, breaks, overtime classification, and payroll/accounting
  evidence exports.
- Loss-prevention approvals and operator-facing review workflows.
- Serialized inventory, warranty lookup, and product variant matrices.
- Encrypted backup protection, restore drills, scheduled snapshots, and
  S3-compatible cloud-vault upload.
- Launch imports, customer privacy disposition, and retention controls.

These capabilities were merged in
[#158](https://github.com/johnny4young/puntovivo/pull/158).

## [1.7.0](https://github.com/johnny4young/puntovivo/compare/v1.6.0...v1.7.0) (2026-07-19)

### Features

- **loyalty:** admin program card, customer ledger panel, and draft-completion customer attach ([#152](https://github.com/johnny4young/puntovivo/issues/152)) ([1aeecee](https://github.com/johnny4young/puntovivo/commit/1aeecee76a8d6180ebbbabe9e2a95ee2182297bd))
- NIT verification digit, vertical presets, schema-downgrade guard, and website SEO/lead capture ([#157](https://github.com/johnny4young/puntovivo/issues/157)) ([af2dedc](https://github.com/johnny4young/puntovivo/commit/af2dedc6d017c0fd3afbffe9792e849b5bee7d23))
- **sales:** sell omnibox, cashier pace HUD, and shareable day pulse ([#150](https://github.com/johnny4young/puntovivo/issues/150)) ([00c4bbb](https://github.com/johnny4young/puntovivo/commit/00c4bbb3874e294080b255a4009742ae62cab3f7))
- **sales:** tunable expiry discount tiers, radar window selector, and points loyalty ([#151](https://github.com/johnny4young/puntovivo/issues/151)) ([f4ba437](https://github.com/johnny4young/puntovivo/commit/f4ba437f661adb18b1ff19a0489b88d2c48d884f))

### Bug Fixes

- **web:** server-side customer search, resilient credit-balance read, sticky virtualised header ([#153](https://github.com/johnny4young/puntovivo/issues/153)) ([c9b4a43](https://github.com/johnny4young/puntovivo/commit/c9b4a43e5826a99dc05650f943340f1a81c64332))
- **web:** translate shared components, drop dead locale fields, gate the migrations-bundle guard ([#154](https://github.com/johnny4young/puntovivo/issues/154)) ([6c250fe](https://github.com/johnny4young/puntovivo/commit/6c250fe9df1bf7a40aaff7fed8bfeb61f47dd8b7))

## [1.6.0](https://github.com/johnny4young/puntovivo/compare/v1.5.1...v1.6.0) (2026-07-12)

### Features

- ship world-class audit wave 2 ([#148](https://github.com/johnny4young/puntovivo/issues/148)) ([3851163](https://github.com/johnny4young/puntovivo/commit/3851163f49956549275fa47bc158919eb8e5a559))

## [1.5.1](https://github.com/johnny4young/puntovivo/compare/v1.5.0...v1.5.1) (2026-07-11)

### Refactors

- **ai:** migrate provider contracts to AI SDK 7 ([#144](https://github.com/johnny4young/puntovivo/issues/144)) ([234b09b](https://github.com/johnny4young/puntovivo/commit/234b09b616d1d581c8d08bfe4415b95ebe1e2d26))

## [1.5.0](https://github.com/johnny4young/puntovivo/compare/v1.4.0...v1.5.0) (2026-07-11)

### Features

- **ui:** improve responsive navigation, checkout, and accessibility ([#145](https://github.com/johnny4young/puntovivo/issues/145)) ([6751d8d](https://github.com/johnny4young/puntovivo/commit/6751d8d35f401aaf7d2101472e3d75699b3fc10c))

## [1.4.0](https://github.com/johnny4young/puntovivo/compare/v1.3.0...v1.4.0) (2026-07-10)

### Features

- **inventory:** actionable expiry radar with audited discount suggestions and POS badge ([#140](https://github.com/johnny4young/puntovivo/issues/140)) ([a564fdd](https://github.com/johnny4young/puntovivo/commit/a564fddded2f0fe878b83c3b6e4732bf54517bb4))
- lot sync fix, checkout sounds, live cash semaphore, margin traffic light, and property tests ([#134](https://github.com/johnny4young/puntovivo/issues/134)) ([09c020f](https://github.com/johnny4young/puntovivo/commit/09c020fdb03f3b8177263c6b1b6b456e90e2e769))
- **sales:** day-close ritual with real margin and balanced streak ([#139](https://github.com/johnny4young/puntovivo/issues/139)) ([0752509](https://github.com/johnny4young/puntovivo/commit/0752509863833a669b056e05501e0db4a552193e))
- **sales:** tenant-level blind cash close toggle ([#137](https://github.com/johnny4young/puntovivo/issues/137)) ([440ac1d](https://github.com/johnny4young/puntovivo/commit/440ac1ddc2dc87dea4c98aa8ef7eb5ba0d803d2b))

### Bug Fixes

- **sales:** harden day-close summary access ([#141](https://github.com/johnny4young/puntovivo/issues/141)) ([3bd6160](https://github.com/johnny4young/puntovivo/commit/3bd6160820de916b3d7d4900b70190e2f74074b0))

### Performance

- **inventory:** materialize the per-product stock rollup via database triggers ([#138](https://github.com/johnny4young/puntovivo/issues/138)) ([53b6438](https://github.com/johnny4young/puntovivo/commit/53b643808b3a2a97d78731332d49765bfd1925db))

## [1.3.0](https://github.com/johnny4young/puntovivo/compare/v1.2.2...v1.3.0) (2026-07-07)

### Features

- **inventory:** units/lots/FEFO + margin/COGS reporting core + deep-review hardening & auth rotation ([#132](https://github.com/johnny4young/puntovivo/issues/132)) ([583c9a4](https://github.com/johnny4young/puntovivo/commit/583c9a48e687012a3852a31da36b0afbb10e7c39))

## [1.2.2](https://github.com/johnny4young/puntovivo/compare/v1.2.1...v1.2.2) (2026-06-29)

### Bug Fixes

- **release:** correct web-job cache note and harden the desktop upload step ([#125](https://github.com/johnny4young/puntovivo/issues/125)) ([61dfc50](https://github.com/johnny4young/puntovivo/commit/61dfc50f51a5de929cf98ea8f8fffb973215f4e1))

## [1.2.1](https://github.com/johnny4young/puntovivo/compare/v1.2.0...v1.2.1) (2026-06-29)

### Bug Fixes

- **desktop:** forge cleanup, differential updates, smaller asar, website tests ([#123](https://github.com/johnny4young/puntovivo/issues/123)) ([31292e7](https://github.com/johnny4young/puntovivo/commit/31292e73fba045165b9852e74a90794b4f704197))

## [1.2.0](https://github.com/johnny4young/puntovivo/compare/v1.1.13...v1.2.0) (2026-06-28)

### Features

- **desktop:** auto-update via electron-updater instead of update-electron-app ([61c9474](https://github.com/johnny4young/puntovivo/commit/61c9474c60aa4a4916ee25a088796b5a7c6100db))

## [1.1.13](https://github.com/johnny4young/puntovivo/compare/v1.1.12...v1.1.13) (2026-06-28)

### Bug Fixes

- **desktop:** upload the desktop zip via gh from bash on every runner ([fe1c5f3](https://github.com/johnny4young/puntovivo/commit/fe1c5f3d7076fc10be36a5f641be9e39b8643f7c))

## [1.1.12](https://github.com/johnny4young/puntovivo/compare/v1.1.11...v1.1.12) (2026-06-28)

### Bug Fixes

- **desktop:** make the smoke asar check slash-agnostic on Windows ([98d8e27](https://github.com/johnny4young/puntovivo/commit/98d8e278a3c727425d12c9ca12ae70d8ae1d120b))

## [1.1.11](https://github.com/johnny4young/puntovivo/compare/v1.1.10...v1.1.11) (2026-06-28)

### Bug Fixes

- **desktop:** resolve the smoke repo root with fileURLToPath on Windows ([316d058](https://github.com/johnny4young/puntovivo/commit/316d058488d72b45f81fe6f483ca6cf2765caccb))

## [1.1.10](https://github.com/johnny4young/puntovivo/compare/v1.1.9...v1.1.10) (2026-06-28)

### Bug Fixes

- **desktop:** configure the github publish provider for electron-builder ([03fdf3f](https://github.com/johnny4young/puntovivo/commit/03fdf3f0bf29da7f9816e00cf7fcef34fecce85b))
- **desktop:** pin a flat electron-builder artifactName ([29b3025](https://github.com/johnny4young/puntovivo/commit/29b3025ecb118f3324c4287b73eae6cc12171a07))
- **desktop:** stop electron-builder from auto-publishing on CI ([2de712f](https://github.com/johnny4young/puntovivo/commit/2de712f306ed2e5652886373ff4c9d19a3466685))

## [1.1.9](https://github.com/johnny4young/puntovivo/compare/v1.1.8...v1.1.9) (2026-06-28)

### Bug Fixes

- **desktop:** skip @electron/get's hanging SHASUMS download in CI ([705f265](https://github.com/johnny4young/puntovivo/commit/705f265f3e2c8754c979f3d71d0dfbeb34bb2d08))

## [1.1.8](https://github.com/johnny4young/puntovivo/compare/v1.1.7...v1.1.8) (2026-06-28)

### Bug Fixes

- **desktop:** copy the native closure flat to stop the CI packaging hang ([3d06554](https://github.com/johnny4young/puntovivo/commit/3d065544207c8e1752ba0f5e17f7a3032c6286b3))

## [1.1.7](https://github.com/johnny4young/puntovivo/compare/v1.1.6...v1.1.7) (2026-06-28)

### Bug Fixes

- **desktop:** drop electronZipDir, let @electron/get fetch the packaging electron ([7ac0029](https://github.com/johnny4young/puntovivo/commit/7ac0029e7e6d72c06198d5d45fc16c27bb282eca))

## [1.1.6](https://github.com/johnny4young/puntovivo/compare/v1.1.5...v1.1.6) (2026-06-28)

### Bug Fixes

- **desktop:** package the native modules vite externalizes ([1d3775f](https://github.com/johnny4young/puntovivo/commit/1d3775fb84fc7d17d2958150ce650e9a72a2748a))

## [1.1.5](https://github.com/johnny4young/puntovivo/compare/v1.1.4...v1.1.5) (2026-06-28)

### Bug Fixes

- **desktop:** force exit after make and cap the job runtime ([be93eeb](https://github.com/johnny4young/puntovivo/commit/be93eebb414330efd1377f2bfcf3406b06b90ebd))

## [1.1.4](https://github.com/johnny4young/puntovivo/compare/v1.1.3...v1.1.4) (2026-06-28)

### Bug Fixes

- **desktop:** keep the event loop alive so CI packaging completes ([d1a1bf0](https://github.com/johnny4young/puntovivo/commit/d1a1bf04b15d9990588886119afa6c268e5d86f3))

## [1.1.3](https://github.com/johnny4young/puntovivo/compare/v1.1.2...v1.1.3) (2026-06-28)

### Bug Fixes

- **desktop:** build packaged app in CI via electronZipDir ([57910a0](https://github.com/johnny4young/puntovivo/commit/57910a013e24e5d1d4ee75f4db95b9cc09e642e3))

## [1.1.2](https://github.com/johnny4young/puntovivo/compare/v1.1.1...v1.1.2) (2026-06-28)

### Bug Fixes

- **desktop:** build a portable zip on every platform via MakerZIP ([a50ac14](https://github.com/johnny4young/puntovivo/commit/a50ac14afa3c1c594bfe167972e5efead123e140))

## [1.1.1](https://github.com/johnny4young/puntovivo/compare/v1.1.0...v1.1.1) (2026-06-28)

### Bug Fixes

- **desktop:** load forge config from plain JS so make resolves makers in CI ([1924842](https://github.com/johnny4young/puntovivo/commit/1924842d8b3dbc8969bb4dddb69302d4be7ceca7))

## [1.1.0](https://github.com/johnny4young/puntovivo/compare/v1.0.0...v1.1.0) (2026-06-27)

### Features

- **website:** add marketing site with i18n, theme and Pages deploy ([7b585cc](https://github.com/johnny4young/puntovivo/commit/7b585cca721b54e6d6cae5fdf92bd5a4a554df94))
- **website:** add secondary pages with client-side routing ([67ba973](https://github.com/johnny4young/puntovivo/commit/67ba9734b729fbee8604635380574b5fc4ef55b3))
- **website:** pre-render routes to static HTML for SEO ([ebafe37](https://github.com/johnny4young/puntovivo/commit/ebafe378c369dad9f8bec8b2c59c012cf3b6a35d))
- **website:** rewrite content to reflect real project state ([fff7448](https://github.com/johnny4young/puntovivo/commit/fff74486228038985ffe6d187299937d8f63a66f))

### Bug Fixes

- **website:** add favicon so the browser tab shows the Puntovivo logo ([1002cdc](https://github.com/johnny4young/puntovivo/commit/1002cdc6ae2fe2f7c7e708677d5a56fc5193cce2))
- **website:** resolve nav and footer anchor links 404 under the Pages base ([5af4793](https://github.com/johnny4young/puntovivo/commit/5af47932c16076ee5e455abc7bd4f1f28678d909))

## [2026-04-22]

### Added

- Administrators can now create, edit, duplicate, activate, and set default receipt templates for sales receipts, quotations, and fiscal DEE documents.
- Receipt templates now support configurable sections such as logos, free text, item lists, totals, payment summaries, separators, QR codes, and barcodes.
- The receipt template editor now includes a live preview so layout changes can be reviewed before saving.

### Changed

- Receipt template previews and starter layouts now follow the active application language, keeping English and Spanish output consistent.
- The login and main navigation experience now have broader bilingual coverage in English and Spanish.

---

## [0.13.0] - 2026-04-11

### Added

- Purchase history now shows the latest return activity more clearly.
- Orders now show staged receiving progress and provide faster receiving actions.
- The sync center now gives clearer visibility into retries and failures.

### Changed

- Purchase activity views now make return accountability easier to track.

### Performance

- Export-heavy screens load more efficiently.
- Route loading was optimized to reduce the initial wait when opening the app.

---

## [0.12.0] - 2026-04-09

### Added

- Users can now change their own password from the application menu.
- Sessions now recover more smoothly when temporary access expires.
- Sensitive account actions now have stronger request protection.

### Changed

- Session handling is now more secure and more resilient across normal use.
- Password changes and administrative resets now invalidate older sessions.
- Account access reacts more safely to role or tenant status changes.
- Stronger password requirements now apply to user creation, resets, and self-service password changes.

---

## [0.11.0] - 2026-04-05

### Added

- The sales interface was redesigned for a cleaner and more structured day-to-day workflow.
- Purchases now support returns with stock restoration.
- Sales now support refunds with stock restoration and reporting-safe handling.
- Companies can manage and choose logos from a dedicated logo library.
- Sales and purchases now support void workflows with stock reversal.
- The POS now includes keyboard shortcuts and faster product search.
- The checkout flow now works better on tablet-sized screens.
- Orders now support partial receiving with per-line progress tracking.
- Purchase orders can now be received directly into stock purchases.
- Teams can manage purchase orders from the application.
- The desktop app now shows update status and install controls.
- The desktop experience now includes safer offline database and sync controls.
- The sync center now supports queue processing, pull snapshots, conflict review, and resolution flows.
- Backup and restore flows now include clearer confirmations.
- Company settings now include backup and receipt-print related controls.
- The app now shows offline sync status more clearly.
- Workstation theme preferences are now preserved.
- Shared notifications, loading states, retry states, and keyboard-friendly tables were expanded across the interface.

---

## [0.10.0] - 2026-03-25

### Added

- Sites can now manage their own assigned storage locations.
- Warehouses now support a location catalog tied to product lookup.
- Customers now support commercial activity classification data.
- Customer catalogs now include stronger classification handling.
- Providers can now be assigned to categories more directly.
- Country, department, and city management is now available.

---

## [0.9.0] - 2026-03-15

### Added

- Initial purchase order and purchase management.
- Inventory management with stock views, movements, and initial inventory.
- A cashier-focused sales terminal.
- Role-based access for administrators, managers, cashiers, and viewers.
- Multi-tenant and multi-site support.
- Cross-platform desktop operation with local-first behavior.
- More reliable local data handling for everyday operation.
