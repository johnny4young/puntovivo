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

## [1.14.2](https://github.com/johnny4young/puntovivo/compare/v1.14.1...v1.14.2) (2026-09-12)


### Bug Fixes

* **release:** unblock the signed macOS desktop build ([818d049](https://github.com/johnny4young/puntovivo/commit/818d049cca5919ba39c062c47da03d329a544b9d))

## [1.14.1](https://github.com/johnny4young/puntovivo/compare/v1.14.0...v1.14.1) (2026-09-11)


### Bug Fixes

* **desktop:** sync durable writes through writable handles on Windows ([3c044eb](https://github.com/johnny4young/puntovivo/commit/3c044ebdecb47390a159d61fbf89aee24fb36e82))
* **release:** drive the first-use claim in the packaged desktop smoke ([8733e36](https://github.com/johnny4young/puntovivo/commit/8733e368702c9a4d2bd2163915f5c8d99c38302f))
* **release:** require the backup manifest schema the desktop writes ([3352a91](https://github.com/johnny4young/puntovivo/commit/3352a91a4bfbe174845fe6fddbe0f3cafef33edf))
* **release:** settle the packaged renderer before smoke shutdown ([fe9ab85](https://github.com/johnny4young/puntovivo/commit/fe9ab8544b2ca1ba08ac116d35259af4b9e614dd))
* **release:** unblock the packaged desktop smoke after first-use ownership ([e07c371](https://github.com/johnny4young/puntovivo/commit/e07c371c816645e87ecae841da446e212deab3a9))
* **release:** wait for in-flight renderer requests before smoke shutdown ([3a9c3b3](https://github.com/johnny4young/puntovivo/commit/3a9c3b3c097b53db06c4a15126ceebfbbcf1a03b))
* **sequentials:** reject a site filter owned by another tenant ([258249a](https://github.com/johnny4young/puntovivo/commit/258249ae8a723ab1fb0518c912068ac1a998b10b))
* **tenant:** keep each tab's requests on the site it shows ([154bda7](https://github.com/johnny4young/puntovivo/commit/154bda72cd4c08732a258e51191acace1ad37471))
* **tenant:** keep the active site owned by its tenant and tab ([a5cea5f](https://github.com/johnny4young/puntovivo/commit/a5cea5f5dd21cdf6b7235aae6a676d28b3ea3951))
* **trpc:** leave a request without a site when its site header is invalid ([76982b4](https://github.com/johnny4young/puntovivo/commit/76982b45ef8e7e1ef3a2bfb10ea5560ddbd846f6))


### Performance

* **products:** scope pharmacy search to owning tenants and gate search per tenant shape ([5e3a894](https://github.com/johnny4young/puntovivo/commit/5e3a8946534282c06c95a4f1a74121d891e495c0))
* **products:** skip pharmacy metadata scans for tenants without profiles ([8275c51](https://github.com/johnny4young/puntovivo/commit/8275c51d5a24561e497c19f52d729895a84801f2))

## [1.14.0](https://github.com/johnny4young/puntovivo/compare/v1.13.0...v1.14.0) (2026-09-10)


### Features

* **auth:** create secure first-use business ownership ([a61c24d](https://github.com/johnny4young/puntovivo/commit/a61c24d0c5a0b7f8ac4cf42a9ce35f83770b82ea))
* **finance:** link quotations and supplier payables ([63083a8](https://github.com/johnny4young/puntovivo/commit/63083a814f6227806edd73d11dddb106700ac938))
* **fulfillment:** harden reservations delivery and signed order intake ([ae0bf35](https://github.com/johnny4young/puntovivo/commit/ae0bf35719f4597ba57ce96027dd8e6fd1c5f248))
* **inventory:** reconcile exact lot and serial counts ([62dda90](https://github.com/johnny4young/puntovivo/commit/62dda90460d17fff11bde10adb0b206a7a01cc16))
* **inventory:** reconcile retail counts and replenishment ([5061246](https://github.com/johnny4young/puntovivo/commit/5061246fd1d24024a505c430f832c84841319530))
* **inventory:** trace lot procurement and transformations ([10aa820](https://github.com/johnny4young/puntovivo/commit/10aa82024704333f00d01ce0dfebc9b0f545889a))
* **kds:** persist versioned kitchen preparation and routing ([0915a01](https://github.com/johnny4young/puntovivo/commit/0915a01034ed3b566bfa497084773c17270a9ddd))
* **payroll:** add reviewed Colombia pre-payroll evidence ([3e543a9](https://github.com/johnny4young/puntovivo/commit/3e543a9f7d1883e74283e7658ffae5cb3632114a))
* **pharmacy:** enforce policy and lot custody ([5cf1768](https://github.com/johnny4young/puntovivo/commit/5cf1768d0cb3cd585bd11205d5742d33a2d5d736))
* **promotions:** redeem customer value at checkout ([cd7c7ab](https://github.com/johnny4young/puntovivo/commit/cd7c7ab512d9d2162613b955d2bfd71094896961))
* **restaurants:** edit multiple modifiers per order line ([fefd218](https://github.com/johnny4young/puntovivo/commit/fefd218ac06026458931fde25475fd83a477c107))
* **restaurants:** make table service and recovery transactional ([40e5fa9](https://github.com/johnny4young/puntovivo/commit/40e5fa9fdfee9f10b451a8baccfd48770fc835ee))
* **restaurants:** manage approved site add-on catalogs ([3cf2926](https://github.com/johnny4young/puntovivo/commit/3cf2926c31f681acb0d6adc69305ff5c6910cc30))
* **sales:** normalize returns and store credit ([12e7b4c](https://github.com/johnny4young/puntovivo/commit/12e7b4c1f82cb34bef017f8078fb3c1b4920a935))
* **stack:** integrate the reviewed business-readiness layers ([7958c2a](https://github.com/johnny4young/puntovivo/commit/7958c2aaeca877cda69dca7986a3f2a52fccfc7c))
* **surfaces:** add private customer display and vertical readiness ([35a83c7](https://github.com/johnny4young/puntovivo/commit/35a83c7cc531468521ce3aa094573deb7064f0d2))
* **verticals:** support hardware and butchery operations ([12c32bd](https://github.com/johnny4young/puntovivo/commit/12c32bd0bf0d23e620e376a014b16c8040aa9591))
* **workforce:** complete effective employment and shift management ([11c3014](https://github.com/johnny4young/puntovivo/commit/11c301417d4d9d3b773d2d0768e82b2a29dd8abc))


### Bug Fixes

* **a11y:** respect reduced motion while checkout loads ([be6b08d](https://github.com/johnny4young/puntovivo/commit/be6b08d449426f38d60f2bc48672826c05e9c798))
* **approvals:** serialize fresh PIN decisions ([8c817ec](https://github.com/johnny4young/puntovivo/commit/8c817ecc4f3cfd967a1c273a1fe1083809496cbd))
* **audit:** bound SQLite working set during chain verification ([796ab66](https://github.com/johnny4young/puntovivo/commit/796ab660da1eb1d3d5b6b0f1094f74a2ecc06186))
* **auth:** fence recovery and session handoffs ([57acea0](https://github.com/johnny4young/puntovivo/commit/57acea0cf7d59c510774ec5cc7399f19474474ea))
* **auth:** initialize CSRF before first-paint telemetry ([d31fd20](https://github.com/johnny4young/puntovivo/commit/d31fd207953c299f96dbe5339cd6e0f126b7ae2e))
* **auth:** match the tenant settings projection to the client contract exactly ([12243a8](https://github.com/johnny4young/puntovivo/commit/12243a8a6924f53bd12fb64c338f2e3348bdc533))
* **auth:** stop publishing the tenant settings blob to every authenticated user ([3fce926](https://github.com/johnny4young/puntovivo/commit/3fce92638fbc629abdba24363d4d77050ff9ad01))
* **cash-sessions:** require a role on the drawer writes, not just an envelope ([185d51d](https://github.com/johnny4young/puntovivo/commit/185d51de6b3dc5687b1784a6c51cc480274b850f))
* **ci:** decide the audit-chain RSS gate on a median, not one sample ([c6ba065](https://github.com/johnny4young/puntovivo/commit/c6ba06500af9018e398fb91a3af2826d55ac947a))
* **ci:** judge the Lighthouse score against the real shared-runner spread ([c09814c](https://github.com/johnny4young/puntovivo/commit/c09814c0d90b18f19ffbb9e1bbdce982c3326c65))
* **ci:** run the workspace gates on stacked pull requests ([54ba518](https://github.com/johnny4young/puntovivo/commit/54ba518faec61d68ff3018490166447f4e759a89))
* **ci:** survive a transient advisory-registry outage instead of misreporting it ([b6c4f81](https://github.com/johnny4young/puntovivo/commit/b6c4f81bdfd489531afe3c7300c6f9d1e0c5bd5a))
* **commands:** bind BOTH the site and the actor into command identity ([2517a85](https://github.com/johnny4young/puntovivo/commit/2517a856fbb2f61391b7f0b906b5836d700d8cfe))
* **commands:** close the replay holes in the critical-command envelope ([caa1109](https://github.com/johnny4young/puntovivo/commit/caa1109de7e4ab46c8dc133e62ad95a55ddf550d))
* **commands:** expire a retained envelope before the retry can find it ([2609df7](https://github.com/johnny4young/puntovivo/commit/2609df7ded966cd29332b6aba7736fa0a2423ad0))
* **commands:** translate lock contention on the compatibility completion ([91cbea2](https://github.com/johnny4young/puntovivo/commit/91cbea290961bfa035fe60b13724368bbae2fc03))
* **core:** harden business transaction invariants ([2d949f3](https://github.com/johnny4young/puntovivo/commit/2d949f359baa0f1ac04d1d49d677833708aa26e5))
* **core:** reject impossible expiry dates and close the review gaps ([4378386](https://github.com/johnny4young/puntovivo/commit/4378386a6de4a00d0eb1bb06dad386971e281f3f))
* **customers:** put the ledger writes on the critical-command path ([db0f4ba](https://github.com/johnny4young/puntovivo/commit/db0f4ba7e90cd8985027ba23982698f60854b56a))
* **customers:** reject rounded-zero ledger entries and contain UI errors ([b9655c2](https://github.com/johnny4young/puntovivo/commit/b9655c298a5549f234d57274fe93a464c57cb75f))
* **customers:** round ledger amounts before they reach the balance ([9062726](https://github.com/johnny4young/puntovivo/commit/9062726c1606144c4fe3491ef289d1cf99b657dc))
* **dashboard:** book top products as dated events like every other period ([7cab0cd](https://github.com/johnny4young/puntovivo/commit/7cab0cd1aec4db0db7075c619eb2180fdc319d80))
* **db:** bound read mapping below the write cache ([02c73c7](https://github.com/johnny4young/puntovivo/commit/02c73c7a7f27ca62b3e1ec23dff88c07f8c0574a))
* **db:** carry return_state through the sales table rebuild ([46d3c48](https://github.com/johnny4young/puntovivo/commit/46d3c483a64ae52fb46191f1ad49f1462bc56e9b))
* **db:** file the counts snapshot against its own migration ([939cd90](https://github.com/johnny4young/puntovivo/commit/939cd9057160ea0d5ca57a03f634fb2e7071ce67))
* **db:** file the promotions snapshot against its own migration ([3f28e0d](https://github.com/johnny4young/puntovivo/commit/3f28e0d490ac00c17edf7db4e3177394993567c1))
* **db:** keep the return line snapshots nullable, as 0052 writes them ([1942d4e](https://github.com/johnny4young/puntovivo/commit/1942d4e3688303ebe928d5efcf7fe879c296f151))
* **db:** keep the sale return item snapshots not null in the schema ([2b2354a](https://github.com/johnny4young/puntovivo/commit/2b2354a79d0a86ab77c810ea5ab2e5b020b762f0))
* **db:** make the newest snapshot agree with the SQL about sales.return_state ([08fa497](https://github.com/johnny4young/puntovivo/commit/08fa49792e4792f0178901e50f8d26ba6764214f))
* **db:** number the kitchen migrations off the real stacked base ([869815b](https://github.com/johnny4young/puntovivo/commit/869815b1cd5dfc1635c814d5ede0cbb5e8ffeff5))
* **db:** point the adoption tests at the restacked migration numbers ([97f26a1](https://github.com/johnny4young/puntovivo/commit/97f26a13727c45c2fd51f8552c935d2c87791cf7))
* **deps:** advance the fast-uri and xmldom security floors ([b178994](https://github.com/johnny4young/puntovivo/commit/b1789948fcee37dfda325631bec70ff3c9d5d0a2))
* **deps:** raise the js-yaml floor onto the patched release ([14835f1](https://github.com/johnny4young/puntovivo/commit/14835f1c8795192f6ef61625897770143568872b))
* **desktop:** authorize the data bridge on role, not identity alone ([05d8c65](https://github.com/johnny4young/puntovivo/commit/05d8c6550fc969f166586cd2e40199f9cdec6ce5))
* **desktop:** protect raw outbox access and align bridge contracts ([e72f5cf](https://github.com/johnny4young/puntovivo/commit/e72f5cf70c6e806bcacbe9e53a535be927459b0f))
* **desktop:** ship a curated menu so a packaged build has no developer console ([5285d83](https://github.com/johnny4young/puntovivo/commit/5285d83871f524c95d88c78de7acc16b6a5735ec))
* **external-orders:** pass opaque connector IDs unambiguously ([1e0e248](https://github.com/johnny4young/puntovivo/commit/1e0e2488a2d80703c6c9d274844868cc7dc2fb71))
* **finance:** close the payable and quotation review gaps ([855d323](https://github.com/johnny4young/puntovivo/commit/855d3234f78ccdc1ecd5d9cec43c633b1ea9ee9a))
* **fiscal:** freeze one checkout identity for receipts and fiscal intents ([1e49f6c](https://github.com/johnny4young/puntovivo/commit/1e49f6c028ad807d2979c72648a2e5de7396adb0))
* **fiscal:** make the numbering guards real on every path that advances ([591f9ed](https://github.com/johnny4young/puntovivo/commit/591f9ed45df2be0da640905f62f674f647e08aa0))
* **fiscal:** never put a name on a document the sale did not record ([c6da2af](https://github.com/johnny4young/puntovivo/commit/c6da2af40820fdefe3937943d12cc95e16dbf71f))
* **fulfillment:** read the return axis from return_state, not payment_status ([c63086a](https://github.com/johnny4young/puntovivo/commit/c63086a874e15c864f79e6432765ba1a447af9b3))
* **inventory:** canonicalise sub-epsilon residue at the balance mutation seam ([b652f51](https://github.com/johnny4young/puntovivo/commit/b652f51cb6457397e28a9c84a4e1d3c334864c3e))
* **inventory:** decide tab visibility with one rule, not stacked filters ([49abbbf](https://github.com/johnny4young/puntovivo/commit/49abbbfe710c1bf1ecd95a50522b204aabdf20af))
* **inventory:** finish createMovement inside its own write transaction ([74db50f](https://github.com/johnny4young/puntovivo/commit/74db50fb547d91b55c7d90e409e536793e5a66b0))
* **inventory:** hide the manager-only controls tab from a cashier ([e11afb7](https://github.com/johnny4young/puntovivo/commit/e11afb72d9038bd9e76501134c1dbc948c2e173b))
* **inventory:** keep the strict expiry parser through the module move ([729aac1](https://github.com/johnny4young/puntovivo/commit/729aac142db65b66393021e798aad17d96d6e795))
* **inventory:** open the primary site balance at zero, not the tenant total ([7c9ba89](https://github.com/johnny4young/puntovivo/commit/7c9ba892cfff40b60b2c33fe8790fbc3457ba701))
* **inventory:** preserve exact carrying values across operational workflows ([d8fa75e](https://github.com/johnny4young/puntovivo/commit/d8fa75ea9b79f2e1dadfbefb564a78d836acc952))
* **inventory:** price a replenishment draft from the current cost ([19552df](https://github.com/johnny4young/puntovivo/commit/19552df1e6cb954e084be5da4a6c2f50bf794a6b))
* **inventory:** settle a within-tolerance void debit to zero ([7d9ff82](https://github.com/johnny4young/puntovivo/commit/7d9ff82669045ae7b1286b1d48739150282a6767))
* **inventory:** stop epsilon-tolerated debits persisting negative balances ([c510bb6](https://github.com/johnny4young/puntovivo/commit/c510bb6dc00dfbeb2fb497ab02eb0c72aedc63fb))
* **inventory:** stop leaking the expected quantity of a blind count ([62e7263](https://github.com/johnny4young/puntovivo/commit/62e72631ee72f9e6cfbf59d7a0304598c4ae5cbb))
* **inventory:** validate lot dates with one strict parser on both sides ([7dc2246](https://github.com/johnny4young/puntovivo/commit/7dc2246f122ab8fcf652266866429abd5daba0be))
* **kds:** key the default station on its code and keep tableless labels ([67f0c76](https://github.com/johnny4young/puntovivo/commit/67f0c76c98853b9b9bc64743d78356e64d022b5e))
* **kds:** never label a column with one ticket's frozen station name ([2cfb7cd](https://github.com/johnny4young/puntovivo/commit/2cfb7cded960a6c1d275cdad6817b555936eaa3c))
* **loyalty:** give the form and the API one set of redemption bounds ([84ea6fd](https://github.com/johnny4young/puntovivo/commit/84ea6fd17836f2fc35dd82aa54bf09dafe3009bf))
* **money:** conserve partial refunds and dated margin snapshots ([39038cd](https://github.com/johnny4young/puntovivo/commit/39038cdb12f61234a166f5501322b9f5576b49f8))
* **money:** round money sums inside SQL, where roundMoney cannot reach ([54da0dd](https://github.com/johnny4young/puntovivo/commit/54da0ddf86fe99903b7bd46bf46934dce00ebdce))
* **money:** round the credit projection and the counted drawer ([2e776d5](https://github.com/johnny4young/puntovivo/commit/2e776d586fc61315060ec200227ef797bde8a7ad))
* **payables:** report the real uninvoiced count, not the picker length ([311616a](https://github.com/johnny4young/puntovivo/commit/311616ad919043228692e795e418dff2b10dd9b2))
* **perf:** reduce desktop startup and FTS lookup overhead ([de5f582](https://github.com/johnny4young/puntovivo/commit/de5f5826f7296d7f5a61a79e783324ac54312019))
* **procurement:** make commands atomic by site ([19b0089](https://github.com/johnny4young/puntovivo/commit/19b0089525284d31c9bd3315f075359a04990b80))
* **products:** freeze tracking identity while a transformation can be voided ([6faad19](https://github.com/johnny4young/puntovivo/commit/6faad19a149d413a36b4e2aeb06167cc1d1122f9))
* **products:** require an explicit base unit before converting a scale payload ([4f96adf](https://github.com/johnny4young/puntovivo/commit/4f96adf882cd7fc2a601f37a60305585bb611f4e))
* **products:** resolve the category FK against the caller tenant ([30c74c6](https://github.com/johnny4young/puntovivo/commit/30c74c645a66931d5fbb2cc4299e2cb1cb98d486))
* **promotions:** judge eligibility at writer time and close the targeting gaps ([302e69e](https://github.com/johnny4young/puntovivo/commit/302e69e3a4309fa568972033cdaad9df5878d172))
* **promotions:** stop the FEFO expiry test rotting against the calendar ([92dea86](https://github.com/johnny4young/puntovivo/commit/92dea86f1cd7442f520308842bc3fb31c44f57c6))
* **providers:** decide and delete a provider in one write transaction ([76f5a3d](https://github.com/johnny4young/puntovivo/commit/76f5a3d00925af44789235f03fc16ca056861773))
* **providers:** paginate all invoiceable purchases with retained selection ([306017a](https://github.com/johnny4young/puntovivo/commit/306017a07baa4b0cce6893aa8d1acacb648749dd))
* **purchases:** settle a within-tolerance reversal debit instead of going negative ([8a92cbc](https://github.com/johnny4young/puntovivo/commit/8a92cbc8704fc6821258b8f51db00ca7d25d35e5))
* **quotations:** re-ask the server whether a quotation is still convertible ([e0bf071](https://github.com/johnny4young/puntovivo/commit/e0bf07135795a17b42e90832e8b76e24daefc6ba))
* **quotations:** refuse to snapshot a deactivated base unit ([568baf6](https://github.com/johnny4young/puntovivo/commit/568baf6c273ee244de7634e973bb628fe0399553))
* **receipts:** carry the frozen promotion and point evidence onto the receipt ([c4ef096](https://github.com/johnny4young/puntovivo/commit/c4ef09693efa586085bd650f1a61a75536128a56))
* **receipts:** preserve legacy custom tender labels ([af5946b](https://github.com/johnny4young/puntovivo/commit/af5946bda7e1af4f5e67ac6d41bb73184cf337a6))
* **reports:** book returns as dated events instead of restating closed periods ([f9c8b57](https://github.com/johnny4young/puntovivo/commit/f9c8b57200aa61ddc7b86a6c67611a0c43218c7d))
* **reports:** pass the refund windows their exclusive upper bound ([05c750b](https://github.com/johnny4young/puntovivo/commit/05c750b9dd9d9cfb893492d5840752457a4682c0))
* **reports:** reconcile tax-exclusive profit and ticket discounts ([e898c0d](https://github.com/johnny4young/puntovivo/commit/e898c0d73542606db48bbf969883d0a84a1848a8))
* **repo:** stop the generated changelog from failing the hygiene gate ([accddd0](https://github.com/johnny4young/puntovivo/commit/accddd017dd360e463e465b3c674f401e822891a))
* **restaurants:** check the dine-in entitlement before the command envelope ([7f021c8](https://github.com/johnny4young/puntovivo/commit/7f021c8c164cb4cfd2c6109f9e0d0658ba4c39f1))
* **returns:** correct replication, locale races and return provenance ([c4ade18](https://github.com/johnny4young/puntovivo/commit/c4ade18d1f5fecf94def46648d2cc09ce19e1c37))
* **runtime:** fence outbox settlement and harden responsive shell ([6402ed4](https://github.com/johnny4young/puntovivo/commit/6402ed4f2b2d3be8b6b318423dba5abb8582c6c1))
* **sales:** bound startup work and preserve display identity ([08e9c1f](https://github.com/johnny4young/puntovivo/commit/08e9c1f4aab5d67fd98cf8187ed1f44e166d4bef))
* **sales:** bump the persisted cart version for the return-origin fields ([1226fdf](https://github.com/johnny4young/puntovivo/commit/1226fdf9d0bdf9abfa439e37a3e7aa81f60d3316))
* **sales:** bump the persisted cart version so the new fields backfill ([4aa2b94](https://github.com/johnny4young/puntovivo/commit/4aa2b943d9063ad6c78cbce4732ea8686d7e9a14))
* **sales:** decide the price-override boundary the same way at every price ([a521ebd](https://github.com/johnny4young/puntovivo/commit/a521ebd3c30371acf3c703dd9bb42461618efa25))
* **sales:** split return state off the payment status column ([3fdda80](https://github.com/johnny4young/puntovivo/commit/3fdda808586e6c77567708aee922076f2a7106f5))
* **sales:** stop the return-state migration inventing collection state ([e01486a](https://github.com/johnny4young/puntovivo/commit/e01486a4fd64223004d1c0f4fec4c1b4e1dbeb73))
* **scanner:** refuse a weight label whose mass base unit was deactivated ([752c19e](https://github.com/johnny4young/puntovivo/commit/752c19e5806ceebb159b5230313a0fb3df3804bd))
* **search:** bound FTS content reads without losing matches ([a5c027d](https://github.com/johnny4young/puntovivo/commit/a5c027d895a0f3fb603761e978d7f7739866e57f))
* **server:** trust one proxy hop in site_hub, not every proxy in the chain ([fce2d92](https://github.com/johnny4young/puntovivo/commit/fce2d921b82528ccdc1274af2f30d31b24f5675c))
* **staff:** cancel time-clock reads on menu teardown ([3a49dda](https://github.com/johnny4young/puntovivo/commit/3a49dda6785aab6cd31409ee19977946656ef1bf))
* **sync:** hold a regulated product's lots local, not just its base row ([80b9e62](https://github.com/johnny4young/puntovivo/commit/80b9e62ff6548614eeda7ef33dd79f97a726700e))
* **sync:** hold regulated aggregates local at every outbox writer ([8a10374](https://github.com/johnny4young/puntovivo/commit/8a1037405ef6ef2e46ca4b055ce7a680060d43e5))
* **ui:** cancel operator alert reads on unmount ([263cd28](https://github.com/johnny4young/puntovivo/commit/263cd28433dd5e769cddd1e00b3fd82489fd9f74))
* **web:** prevent shell and POS translation waterfalls ([1a4f535](https://github.com/johnny4young/puntovivo/commit/1a4f53501e9afa41ad8b90a06f7b8cbaa16e9d28))
* **web:** refuse a repeated confirm on every money modal ([c6acb61](https://github.com/johnny4young/puntovivo/commit/c6acb61f69fe4662c6f783b5bf36fe50e7c9d8ff))
* **whats-new:** scope announcements to the publishing tenant ([70cf3ec](https://github.com/johnny4young/puntovivo/commit/70cf3ec4d38dd999bce45f73d6277cdf77173a93))


### Performance

* **import:** avoid discarded product detail hydration ([12e81cb](https://github.com/johnny4young/puntovivo/commit/12e81cbc94a92a3f83ff03d09dc0e5ebf2661689))
* **search:** bound ranking and reuse indexed hydration ([e2d19ef](https://github.com/johnny4young/puntovivo/commit/e2d19ef280424ecdde3bdfdea7c62d1fa1ac6b90))
* **search:** reuse bounded FTS statements ([7ae2166](https://github.com/johnny4young/puntovivo/commit/7ae216663b27f8f08dd2df4791f2dd0b6e2dc887))
* **search:** reuse tenant-safe exact-code statements ([844a64d](https://github.com/johnny4young/puntovivo/commit/844a64dd2fa62967d019869b5f73b3d568477f60))
* **web:** keep lazy vendors out of POS startup ([abc1ddc](https://github.com/johnny4young/puntovivo/commit/abc1ddcf88f19b8659d84ad26dbc37ceede2f8db))


### Refactors

* **inventory:** read the movement stock total back from the rollup ([c9d68bf](https://github.com/johnny4young/puntovivo/commit/c9d68bf35817aec246cf033a9871028ce2799a44))
* **reports:** drop the day-close filter product-revenue now owns ([e275330](https://github.com/johnny4young/puntovivo/commit/e275330d2134fe4d1867566bb4da6aff6c6e69b7))

## [1.13.0](https://github.com/johnny4young/puntovivo/compare/v1.12.0...v1.13.0) (2026-09-04)


### Features

* **approvals:** approve checkout inline ([d0c92bb](https://github.com/johnny4young/puntovivo/commit/d0c92bba8556b9463f615a593cf92c334bfdc0b2))
* **auth:** renew Store Hub sessions ([e258912](https://github.com/johnny4young/puntovivo/commit/e2589126945bcb28a7515042410ad876d054bdc2))
* **categories:** simplify category creation ([14283e4](https://github.com/johnny4young/puntovivo/commit/14283e4cd8d87d5245c72393f89e44529ca1ebb5))
* **company:** add guided business setup ([498ddde](https://github.com/johnny4young/puntovivo/commit/498ddde0f9452063b79b97e702338549aaa49fbe))
* complete post-212 autonomous hardening ([#213](https://github.com/johnny4young/puntovivo/issues/213)) ([df8cb69](https://github.com/johnny4young/puntovivo/commit/df8cb6906acf2c0dcad648a8826e804aeddcc3c3))
* **customer-catalogs:** simplify fiscal setup ([af07d63](https://github.com/johnny4young/puntovivo/commit/af07d636f069983d24e51ebcd0428a7d0e5e8145))
* **customers:** simplify customer creation ([583e159](https://github.com/johnny4young/puntovivo/commit/583e15988ae3873a0a582a3b80023b5b65b9de77))
* deliver the validated operations and recovery wave ([#181](https://github.com/johnny4young/puntovivo/issues/181)) ([b6430f1](https://github.com/johnny4young/puntovivo/commit/b6430f11542802fa90f52a20d115fc771c0bc5cd))
* **design-system:** add task-oriented primitives ([d2ca234](https://github.com/johnny4young/puntovivo/commit/d2ca234c9f697fcb66cd5e4f5656bb05751aca93))
* **design-system:** complete task-oriented surfaces ([cab23e5](https://github.com/johnny4young/puntovivo/commit/cab23e51c7646d6384fca1640e19a6f668fb505b))
* **desktop:** auto-update via electron-updater instead of update-electron-app ([61c9474](https://github.com/johnny4young/puntovivo/commit/61c9474c60aa4a4916ee25a088796b5a7c6100db))
* **desktop:** evaluate Electron 43 runtime on the 43.4.1 line ([#208](https://github.com/johnny4young/puntovivo/issues/208)) ([56f40f7](https://github.com/johnny4young/puntovivo/commit/56f40f7301b80e33044c94f3ae718fcb756cf7d1))
* **fonts:** self-host font families, drop the font CDN, realign types node ([#201](https://github.com/johnny4young/puntovivo/issues/201)) ([7a72fdd](https://github.com/johnny4young/puntovivo/commit/7a72fdd68841b95b427559529c55cc65c8d102f0))
* **geography:** guide location setup ([e348862](https://github.com/johnny4young/puntovivo/commit/e348862495ca41aa549ed064aae9e17e349fa36e))
* **inventory:** actionable expiry radar — audited discount suggestions + POS badge (ENG-199) ([#140](https://github.com/johnny4young/puntovivo/issues/140)) ([a564fdd](https://github.com/johnny4young/puntovivo/commit/a564fddded2f0fe878b83c3b6e4732bf54517bb4))
* **inventory:** audit stock transfers ([c92bed7](https://github.com/johnny4young/puntovivo/commit/c92bed73132f094d2cd769571d10980b0b700b74))
* **inventory:** units/lots/FEFO + margin/COGS reporting core + deep-review hardening & auth rotation ([#132](https://github.com/johnny4young/puntovivo/issues/132)) ([583c9a4](https://github.com/johnny4young/puntovivo/commit/583c9a48e687012a3852a31da36b0afbb10e7c39))
* iteration-2 quick wins — lot sync fix, checkout sounds, live cash semaphore, margin traffic light, property tests (ENG-192..196) ([#134](https://github.com/johnny4young/puntovivo/issues/134)) ([09c020f](https://github.com/johnny4young/puntovivo/commit/09c020fdb03f3b8177263c6b1b6b456e90e2e769))
* **locations:** simplify location creation ([39dea1b](https://github.com/johnny4young/puntovivo/commit/39dea1b9c7c1d6be5e0d6c04f561b68e7e5e9245))
* **loyalty:** admin program card, customer ledger panel, and draft-completion customer attach ([#152](https://github.com/johnny4young/puntovivo/issues/152)) ([1aeecee](https://github.com/johnny4young/puntovivo/commit/1aeecee76a8d6180ebbbabe9e2a95ee2182297bd))
* **navigation:** add task-first experience layer ([0434274](https://github.com/johnny4young/puntovivo/commit/0434274fff947c74e1b69811f0bcb7bb5ce3a6e5))
* **navigation:** simplify advanced tools ([6155304](https://github.com/johnny4young/puntovivo/commit/61553049d34c9dc69ba4a34e12158f63952bc914))
* NIT verification digit, vertical presets, schema-downgrade guard, and website SEO/lead capture ([#157](https://github.com/johnny4young/puntovivo/issues/157)) ([af2dedc](https://github.com/johnny4young/puntovivo/commit/af2dedc6d017c0fd3afbffe9792e849b5bee7d23))
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
* **sales:** day-close ritual with real margin and balanced-streak (ENG-198) ([#139](https://github.com/johnny4young/puntovivo/issues/139)) ([0752509](https://github.com/johnny4young/puntovivo/commit/0752509863833a669b056e05501e0db4a552193e))
* **sales:** iteration-2 band 3 — sell omnibox, cashier pace HUD, shareable day pulse (ENG-203/204/205) ([#150](https://github.com/johnny4young/puntovivo/issues/150)) ([00c4bbb](https://github.com/johnny4young/puntovivo/commit/00c4bbb3874e294080b255a4009742ae62cab3f7))
* **sales:** simplify the first checkout viewport ([abeaa92](https://github.com/johnny4young/puntovivo/commit/abeaa92d70b7320b47b034576d9b6c783200c51d))
* **sales:** tenant-level blind cash close toggle (ENG-194b) ([#137](https://github.com/johnny4young/puntovivo/issues/137)) ([440ac1d](https://github.com/johnny4young/puntovivo/commit/440ac1ddc2dc87dea4c98aa8ef7eb5ba0d803d2b))
* **sales:** tunable expiry discount tiers, radar window selector, and points loyalty ([#151](https://github.com/johnny4young/puntovivo/issues/151)) ([f4ba437](https://github.com/johnny4young/puntovivo/commit/f4ba437f661adb18b1ff19a0489b88d2c48d884f))
* security hardening, tax model, accountant export and the read-only companion ([#209](https://github.com/johnny4young/puntovivo/issues/209)) ([7ec0d8e](https://github.com/johnny4young/puntovivo/commit/7ec0d8efeca6309e8147bf6e027db8b41a51782f))
* **security:** add expiring, machine-verified advisory dispositions ([#204](https://github.com/johnny4young/puntovivo/issues/204)) ([cab906b](https://github.com/johnny4young/puntovivo/commit/cab906b39fbe7c6626014aa4a35dba4346e4af3a))
* **sequentials:** simplify numbering setup ([8107b2e](https://github.com/johnny4young/puntovivo/commit/8107b2e33a4fce84c4725d6de2d089c23091c7fe))
* ship world-class audit wave 2 ([#148](https://github.com/johnny4young/puntovivo/issues/148)) ([3851163](https://github.com/johnny4young/puntovivo/commit/3851163f49956549275fa47bc158919eb8e5a559))
* staff/HR, loss-prevention approvals, serialized inventory, variant matrices, backup, privacy, and onboarding import ([#158](https://github.com/johnny4young/puntovivo/issues/158)) ([b9a4800](https://github.com/johnny4young/puntovivo/commit/b9a480016f3bc114e2b857d94a259cad8d4c1b2b))
* **tables:** migrate DataTable to TanStack Table v9 ([#206](https://github.com/johnny4young/puntovivo/issues/206)) ([dc674b4](https://github.com/johnny4young/puntovivo/commit/dc674b4c9a1201b0151de37e68d820d67ccc65e9))
* **ui:** complete Operator Deck adoption ([4f4a826](https://github.com/johnny4young/puntovivo/commit/4f4a8267bc999b217bb3fbb7494980ac4133cb9f))
* **ui:** establish Operator Deck foundation ([db5bd0e](https://github.com/johnny4young/puntovivo/commit/db5bd0e703d5440b33bf6bccc7e8dad7676dca94))
* **ui:** improve responsive navigation, checkout, and accessibility ([#145](https://github.com/johnny4young/puntovivo/issues/145)) ([6751d8d](https://github.com/johnny4young/puntovivo/commit/6751d8d35f401aaf7d2101472e3d75699b3fc10c))
* **units:** simplify unit creation ([79489f0](https://github.com/johnny4young/puntovivo/commit/79489f04c9f916c7abbfd177b145395cea31da37))
* **vat-rates:** simplify rate creation ([f5dd2d7](https://github.com/johnny4young/puntovivo/commit/f5dd2d77e73d64c4d9f0588627dc1d2efce4098f))
* **website:** add marketing site with i18n, theme and Pages deploy ([7b585cc](https://github.com/johnny4young/puntovivo/commit/7b585cca721b54e6d6cae5fdf92bd5a4a554df94))
* **website:** add secondary pages with client-side routing ([67ba973](https://github.com/johnny4young/puntovivo/commit/67ba9734b729fbee8604635380574b5fc4ef55b3))
* **website:** deep-link the download CTA to the per-OS installer ([d05225b](https://github.com/johnny4young/puntovivo/commit/d05225b895a3dbb48b197bfaf97675447ca26098))
* **website:** pre-render routes to static HTML for SEO ([ebafe37](https://github.com/johnny4young/puntovivo/commit/ebafe378c369dad9f8bec8b2c59c012cf3b6a35d))
* **website:** rewrite content to reflect real project state ([fff7448](https://github.com/johnny4young/puntovivo/commit/fff74486228038985ffe6d187299937d8f63a66f))


### Bug Fixes

* **a11y:** run one axe engine across the unit and browser gates ([#205](https://github.com/johnny4young/puntovivo/issues/205)) ([3c51c50](https://github.com/johnny4young/puntovivo/commit/3c51c50a3bee38541b5162231a252e420099cbd0))
* **auth:** clear rejected refresh cookies ([03028ff](https://github.com/johnny4young/puntovivo/commit/03028ffaebe782f70a10cf128b2ae6c2cc2d06ea))
* **auth:** preserve desktop staff handoff ([b6d50c8](https://github.com/johnny4young/puntovivo/commit/b6d50c8d11177a20ecc45b4ca719b05e6d2f1824))
* **build:** invoke shared compiler portably ([fe36d4e](https://github.com/johnny4young/puntovivo/commit/fe36d4ef65cfaedab4b84ed82ab6663eb046f057))
* **ci:** align pnpm bootstrap version ([b46e1a8](https://github.com/johnny4young/puntovivo/commit/b46e1a8da6b5e9d3c0de1f003a10450ff6e12620))
* **ci:** eliminate hidden validation diagnostics ([e96d3d3](https://github.com/johnny4young/puntovivo/commit/e96d3d333f0e61ec09e60ee27f53f67e91b2949a))
* **ci:** enforce warning-free quality gates ([d32f4a5](https://github.com/johnny4young/puntovivo/commit/d32f4a55d0b80a989495c29a3c008706c0df224e))
* **ci:** fetch path-filter base revision ([78e82db](https://github.com/johnny4young/puntovivo/commit/78e82db2e5c4f616aed31589e5c6058c8929576a))
* **ci:** run standalone pnpm binaries directly ([cb0ba19](https://github.com/johnny4young/puntovivo/commit/cb0ba1977a9e7fa8ac3681eddf4b1e85f5eb05b4))
* **copy:** replace tenant jargon ([65e9ee6](https://github.com/johnny4young/puntovivo/commit/65e9ee68d5744ace86430936874d159bd8d0aba4))
* **customer-catalogs:** localize seeded names ([33c58c1](https://github.com/johnny4young/puntovivo/commit/33c58c1f0a4e6c3089e744b959b52e892280ab10))
* **database:** prove and repair incremental recovery ([#166](https://github.com/johnny4young/puntovivo/issues/166)) ([a95bd48](https://github.com/johnny4young/puntovivo/commit/a95bd48d4fef06f45910894ccfec5fc9de898fc7))
* **database:** reconcile migration tracking drift ([3991f2c](https://github.com/johnny4young/puntovivo/commit/3991f2c1b38bb495d76eb43104d00fae9347e78c))
* **database:** recover materialized migration tracking ([d4a33c1](https://github.com/johnny4young/puntovivo/commit/d4a33c1e6711493d70b9c768afe8565607b10594))
* **db:** publish connections atomically ([e20a6c2](https://github.com/johnny4young/puntovivo/commit/e20a6c25ed34e0178d66fcf2d0b3356d217c0fd7))
* **deps:** hold react-virtual below the flushSync regression, raise the js-yaml floor ([#193](https://github.com/johnny4young/puntovivo/issues/193)) ([266b8a4](https://github.com/johnny4young/puntovivo/commit/266b8a43ba05b48257ff3745319862d6720c3638))
* **deps:** raise transitive security floors ([#186](https://github.com/johnny4young/puntovivo/issues/186)) ([a305e0a](https://github.com/johnny4young/puntovivo/commit/a305e0adcd1896f0dbae815e85e84622c4e47048))
* **desktop:** build a portable zip on every platform via MakerZIP ([a50ac14](https://github.com/johnny4young/puntovivo/commit/a50ac14afa3c1c594bfe167972e5efead123e140))
* **desktop:** build packaged app in CI via electronZipDir ([57910a0](https://github.com/johnny4young/puntovivo/commit/57910a013e24e5d1d4ee75f4db95b9cc09e642e3))
* **desktop:** configure the github publish provider for electron-builder ([03fdf3f](https://github.com/johnny4young/puntovivo/commit/03fdf3f0bf29da7f9816e00cf7fcef34fecce85b))
* **desktop:** copy the native closure flat to stop the CI packaging hang ([3d06554](https://github.com/johnny4young/puntovivo/commit/3d065544207c8e1752ba0f5e17f7a3032c6286b3))
* **desktop:** drop electronZipDir, let @electron/get fetch the packaging electron ([7ac0029](https://github.com/johnny4young/puntovivo/commit/7ac0029e7e6d72c06198d5d45fc16c27bb282eca))
* **desktop:** force exit after make and cap the job runtime ([be93eeb](https://github.com/johnny4young/puntovivo/commit/be93eebb414330efd1377f2bfcf3406b06b90ebd))
* **desktop:** forge cleanup, differential updates, smaller asar, website tests ([#123](https://github.com/johnny4young/puntovivo/issues/123)) ([31292e7](https://github.com/johnny4young/puntovivo/commit/31292e73fba045165b9852e74a90794b4f704197))
* **desktop:** harden cross-platform candidate validation ([1b60a23](https://github.com/johnny4young/puntovivo/commit/1b60a2364b9b39f8bf118421995ded2c70be2d8f))
* **desktop:** honor portal settings variant contract ([b7fa44c](https://github.com/johnny4young/puntovivo/commit/b7fa44c0930e844131a55df17d4d089d3a082589))
* **desktop:** inherit Linux smoke display ([2b300f9](https://github.com/johnny4young/puntovivo/commit/2b300f91ac0c5950925ab84d01c1bcc06e1177ff))
* **desktop:** isolate Linux portal smoke ([b2c941c](https://github.com/johnny4young/puntovivo/commit/b2c941c858b6e94befc3d55e3c1f173f8701c03d))
* **desktop:** keep the event loop alive so CI packaging completes ([d1a1bf0](https://github.com/johnny4young/puntovivo/commit/d1a1bf04b15d9990588886119afa6c268e5d86f3))
* **desktop:** load forge config from plain JS so make resolves makers in CI ([1924842](https://github.com/johnny4young/puntovivo/commit/1924842d8b3dbc8969bb4dddb69302d4be7ceca7))
* **desktop:** make the smoke asar check slash-agnostic on Windows ([98d8e27](https://github.com/johnny4young/puntovivo/commit/98d8e278a3c727425d12c9ca12ae70d8ae1d120b))
* **desktop:** package Electron ABI on every platform ([7929f10](https://github.com/johnny4young/puntovivo/commit/7929f10dc2fcaf98f69fbd6abd448ba59d844748))
* **desktop:** package the native modules vite externalizes ([1d3775f](https://github.com/johnny4young/puntovivo/commit/1d3775fb84fc7d17d2958150ce650e9a72a2748a))
* **desktop:** pin a flat electron-builder artifactName ([29b3025](https://github.com/johnny4young/puntovivo/commit/29b3025ecb118f3324c4287b73eae6cc12171a07))
* **desktop:** rebuild only ABI-sensitive native addon ([9dcf04e](https://github.com/johnny4young/puntovivo/commit/9dcf04e69729ca133c89c508c11737cd3e62e744))
* **desktop:** resolve the smoke repo root with fileURLToPath on Windows ([316d058](https://github.com/johnny4young/puntovivo/commit/316d058488d72b45f81fe6f483ca6cf2765caccb))
* **desktop:** run native rebuild without shell shims ([0681885](https://github.com/johnny4young/puntovivo/commit/0681885a169b1410ee901d03baea3db5025115ad))
* **desktop:** serve the packaged renderer from a secure origin ([fa3e37b](https://github.com/johnny4young/puntovivo/commit/fa3e37bb2a371b2bdafa18e9923248ae256352ad))
* **desktop:** skip @electron/get's hanging SHASUMS download in CI ([705f265](https://github.com/johnny4young/puntovivo/commit/705f265f3e2c8754c979f3d71d0dfbeb34bb2d08))
* **desktop:** stop electron-builder from auto-publishing on CI ([2de712f](https://github.com/johnny4young/puntovivo/commit/2de712f306ed2e5652886373ff4c9d19a3466685))
* **desktop:** upload the desktop zip via gh from bash on every runner ([fe1c5f3](https://github.com/johnny4young/puntovivo/commit/fe1c5f3d7076fc10be36a5f641be9e39b8643f7c))
* **e2e:** stop leaking packaged app processes and racing the login redirect ([84d4570](https://github.com/johnny4young/puntovivo/commit/84d457065ba081b68a7161497564fc7c0dfc32cd))
* **errors:** interpolate server error details instead of showing the template ([161c96b](https://github.com/johnny4young/puntovivo/commit/161c96b235d2bef326fc37e804cd18f6e9e5c198))
* **fiscal:** keep demo proof local ([4675b1d](https://github.com/johnny4young/puntovivo/commit/4675b1d6c9a6d4f37898a2da283620125eb98090))
* harden runtime, search and release tooling ([2618096](https://github.com/johnny4young/puntovivo/commit/261809670eb9d6ac74c1b0fa3cb6417473de5e95))
* **perf:** extend lighthouse sampling only on undecidable score spreads ([#203](https://github.com/johnny4young/puntovivo/issues/203)) ([38bc867](https://github.com/johnny4young/puntovivo/commit/38bc86740cb2e26069e74bbd40cce3a1f4016bba))
* **peripherals:** use plain device language ([26e7383](https://github.com/johnny4young/puntovivo/commit/26e73832c19cb0c5959f0f59a863d3ffae2483c2))
* **products:** protect unsaved product drafts ([4ffed31](https://github.com/johnny4young/puntovivo/commit/4ffed31f92ff7dde4fac5ca2cac42e3c69d699f1))
* **realtime:** authenticate the status endpoint, and lighten the entry chunk ([#212](https://github.com/johnny4young/puntovivo/issues/212)) ([fef4021](https://github.com/johnny4young/puntovivo/commit/fef4021f172db3aec6f5d9ae7282ea29a2450876))
* **realtime:** authorize the SSE channel, and close the day on the companion ([#210](https://github.com/johnny4young/puntovivo/issues/210)) ([e5c3e5f](https://github.com/johnny4young/puntovivo/commit/e5c3e5f6edc32bf770774bcade017c640d5d8641))
* **receipts:** bound receipt image capture ([c390077](https://github.com/johnny4young/puntovivo/commit/c390077a5261e7cd75e3ec368f178e871603dd77))
* **receipts:** fit previews to the viewport ([3a7c930](https://github.com/johnny4young/puntovivo/commit/3a7c93070eaff46e421c33a86751287c6150786a))
* **receipts:** localize customer-facing labels ([8ac54b4](https://github.com/johnny4young/puntovivo/commit/8ac54b49f66f4d6de42e7eca83c8af3b88e9fbde))
* **receipts:** localize template timestamps ([8730916](https://github.com/johnny4young/puntovivo/commit/8730916bf1a1256094f4df89158fb6b2cd1a3c7a))
* **receipts:** protect unsaved template changes ([75ad766](https://github.com/johnny4young/puntovivo/commit/75ad76665c3241ea999746f9c0fe025e612479de))
* **receipts:** use plain template language ([6d9b01e](https://github.com/johnny4young/puntovivo/commit/6d9b01e91c4a0afa12e8225312711e1141b25e06))
* **release:** close phase 1 validation gaps ([eae6d5a](https://github.com/johnny4young/puntovivo/commit/eae6d5ac3f3ce52ce0b8302ffa5caf08adc8b393))
* **release:** correct web-job cache note and harden the desktop upload step ([#125](https://github.com/johnny4young/puntovivo/issues/125)) ([61dfc50](https://github.com/johnny4young/puntovivo/commit/61dfc50f51a5de929cf98ea8f8fffb973215f4e1))
* **release:** make desktop smoke teardown hermetic ([89ed462](https://github.com/johnny4young/puntovivo/commit/89ed462254080d6e09cfae43f5376c46f9bc55e9))
* **release:** map Linux artifact architecture ([0034569](https://github.com/johnny4young/puntovivo/commit/0034569c769d5794f4c8dc8799e82c632664978b))
* **release:** require packaged runtime smoke ([5579f7f](https://github.com/johnny4young/puntovivo/commit/5579f7f248d216bfc22bfc9d0bc7380c45d93459))
* **release:** stabilize cross-platform runtime smoke ([b9d3328](https://github.com/johnny4young/puntovivo/commit/b9d332809bf33c3a88e3a14ceadfc2650fe98b6e))
* **release:** stop pinning the app version in recovery evidence tests ([#189](https://github.com/johnny4young/puntovivo/issues/189)) ([a25e09b](https://github.com/johnny4young/puntovivo/commit/a25e09b8e10daf9adea7bdd802ca47cb17d56cf0))
* **reliability:** stabilize release baseline ([073fb8f](https://github.com/johnny4young/puntovivo/commit/073fb8ff119a28e125ecc6d81e5342bf2f0324a2))
* **sales:** defer closed overlay bundles ([73f03a9](https://github.com/johnny4young/puntovivo/commit/73f03a98eb17e4cd0047c24106897fe039e812da))
* **sales:** harden day-close summary access ([#141](https://github.com/johnny4young/puntovivo/issues/141)) ([3bd6160](https://github.com/johnny4young/puntovivo/commit/3bd6160820de916b3d7d4900b70190e2f74074b0))
* **sales:** isolate secondary query observers ([c60d25a](https://github.com/johnny4young/puntovivo/commit/c60d25a4e9fe55f0a21d78619cda75812a914bea))
* **sales:** remove first-paint query contention ([262f690](https://github.com/johnny4young/puntovivo/commit/262f6905fd318826294393d4bc7983aaa48aa671))
* **sales:** stabilize the performance gate ([076d224](https://github.com/johnny4young/puntovivo/commit/076d2248da8ed4bc2d10222ee54ea6675e1a4d20))
* **server:** clean failed bootstrap resources ([795f0c6](https://github.com/johnny4young/puntovivo/commit/795f0c690d88db9d8d79a58c333e2bf936552a19))
* **server:** drain workers before database close ([7b0b111](https://github.com/johnny4young/puntovivo/commit/7b0b111f85886362041118b8a8ae788b2834b2db))
* **web:** batch virtualizer updates on React 19 ([6a18ac0](https://github.com/johnny4young/puntovivo/commit/6a18ac05b784540ce1cd12b1026dc1547e56715f))
* **web:** harden long-shift renderer lifecycles ([8f60065](https://github.com/johnny4young/puntovivo/commit/8f600655157e3a917b2e1a45c94aacde9ba4819e))
* **web:** move Electron helper into runtime module ([93f5632](https://github.com/johnny4young/puntovivo/commit/93f5632ee2bd465d2f8ebbebc547c336b2c57658))
* **web:** server-side customer search, resilient credit-balance read, sticky virtualised header ([#153](https://github.com/johnny4young/puntovivo/issues/153)) ([c9b4a43](https://github.com/johnny4young/puntovivo/commit/c9b4a43e5826a99dc05650f943340f1a81c64332))
* **website:** add favicon so the browser tab shows the Puntovivo logo ([1002cdc](https://github.com/johnny4young/puntovivo/commit/1002cdc6ae2fe2f7c7e708677d5a56fc5193cce2))
* **website:** patch standalone build dependencies ([0e818fc](https://github.com/johnny4young/puntovivo/commit/0e818fcb277636d5f19194968716a724a7449eef))
* **website:** resolve nav and footer anchor links 404 under the Pages base ([5af4793](https://github.com/johnny4young/puntovivo/commit/5af47932c16076ee5e455abc7bd4f1f28678d909))
* **web:** translate shared components, drop dead locale fields, gate the migrations-bundle guard ([#154](https://github.com/johnny4young/puntovivo/issues/154)) ([6c250fe](https://github.com/johnny4young/puntovivo/commit/6c250fe9df1bf7a40aaff7fed8bfeb61f47dd8b7))


### Performance

* **desktop:** enforce operational continuity ([d51514f](https://github.com/johnny4young/puntovivo/commit/d51514f513a462334f0196a7f0ffd181d6143cc9))
* **inventory:** materialize the per-product stock rollup via 0008 triggers (ENG-197) ([#138](https://github.com/johnny4young/puntovivo/issues/138)) ([53b6438](https://github.com/johnny4young/puntovivo/commit/53b643808b3a2a97d78731332d49765bfd1925db))
* **products:** add tenant-safe FTS search ([0cf95b5](https://github.com/johnny4young/puntovivo/commit/0cf95b53351728b6250712f4daeceb1670b6863b))
* **products:** bound semantic search candidates ([98826f1](https://github.com/johnny4young/puntovivo/commit/98826f19a9dd81f4abf2f23f1a092e52c6dec05c))
* **products:** index exact code search ([6a8b5d4](https://github.com/johnny4young/puntovivo/commit/6a8b5d4bc9719b08ab50067a5d46b37823679e9b))
* **search:** benchmark and compact product vectors ([7f4c360](https://github.com/johnny4young/puntovivo/commit/7f4c360b5986c493d1fe1a38526ee9fe962036b6))
* **server:** enforce store-scale read profile ([6129801](https://github.com/johnny4young/puntovivo/commit/6129801600dd0f07f716e94fef0344b92364d43b))


### Refactors

* **ai:** migrate provider contracts to AI SDK 7 ([#144](https://github.com/johnny4young/puntovivo/issues/144)) ([234b09b](https://github.com/johnny4young/puntovivo/commit/234b09b616d1d581c8d08bfe4415b95ebe1e2d26))
* **repo:** publish clean project baseline ([fc7839e](https://github.com/johnny4young/puntovivo/commit/fc7839ef4851085465b3196c2c166bb28a3cdc9f))
* **website:** rebuild the marketing site on Astro without a client framework ([0413d72](https://github.com/johnny4young/puntovivo/commit/0413d72821f18838ebc93388b0681a1d5c25983e))

## [1.12.0](https://github.com/johnny4young/puntovivo/compare/v1.11.0...v1.12.0) (2026-08-29)


### Features

* complete post-212 autonomous hardening ([#213](https://github.com/johnny4young/puntovivo/issues/213)) ([df8cb69](https://github.com/johnny4young/puntovivo/commit/df8cb6906acf2c0dcad648a8826e804aeddcc3c3))


### Bug Fixes

* **realtime:** authenticate the status endpoint, and lighten the entry chunk ([#212](https://github.com/johnny4young/puntovivo/issues/212)) ([fef4021](https://github.com/johnny4young/puntovivo/commit/fef4021f172db3aec6f5d9ae7282ea29a2450876))
* **realtime:** authorize the SSE channel, and close the day on the companion ([#210](https://github.com/johnny4young/puntovivo/issues/210)) ([e5c3e5f](https://github.com/johnny4young/puntovivo/commit/e5c3e5f6edc32bf770774bcade017c640d5d8641))

## [1.11.0](https://github.com/johnny4young/puntovivo/compare/v1.10.2...v1.11.0) (2026-08-25)


### Features

* **desktop:** evaluate Electron 43 runtime on the 43.4.1 line ([#208](https://github.com/johnny4young/puntovivo/issues/208)) ([56f40f7](https://github.com/johnny4young/puntovivo/commit/56f40f7301b80e33044c94f3ae718fcb756cf7d1))
* **fonts:** self-host font families, drop the font CDN, realign types node ([#201](https://github.com/johnny4young/puntovivo/issues/201)) ([7a72fdd](https://github.com/johnny4young/puntovivo/commit/7a72fdd68841b95b427559529c55cc65c8d102f0))
* security hardening, tax model, accountant export and the read-only companion ([#209](https://github.com/johnny4young/puntovivo/issues/209)) ([7ec0d8e](https://github.com/johnny4young/puntovivo/commit/7ec0d8efeca6309e8147bf6e027db8b41a51782f))
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
