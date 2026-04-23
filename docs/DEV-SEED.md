# Developer Seed — Test Data Command

> Status: **Shipped — April 22, 2026** (ENG-015)
> Spec originally captured April 22, 2026; landed same day.

A single command that populates a fresh Puntovivo install with a rich
but deterministic set of test data so developers, QA, and demo
sessions can exercise the whole app without clicking through every
catalog form. The command is dev-only — production installs never
run it.

## Invocation

From the repo root:

```
# Default dataset (50 products, ~20 sales, 2 sites, 6 users)
npm run seed:dev

# Bigger catalog and history
SEED_PRESET=large npm run seed:dev

# Wipe the demo tenant first and reseed (destructive)
SEED_RESET=true npm run seed:dev

# Combine
SEED_PRESET=large SEED_RESET=true npm run seed:dev

# Print help
npm run seed:dev --workspace=@puntovivo/server -- --help
```

The equivalent `--flag` form works when invoking the workspace
directly (npm's argument forwarding does not cross the root-to-
workspace boundary cleanly, which is why env vars are the default
recipe):

```
npm run seed:dev --workspace=@puntovivo/server -- --preset=large --reset
```

### Which database file does it target?

The seed CLI resolves the DB path in this order:

1. **`DATABASE_URL`** — explicit override, always wins.
2. **`SEED_TARGET=desktop`** — the per-user Electron data directory
   (`app.getPath('userData')`), which is what `npm run dev:desktop`
   reads. Use this when you want `dev:desktop` to see the seed.
3. **Default** — `packages/server/data/local.db`, the same file
   `npm run dev:server` writes to.

Concretely:

| Your next command | Seed against |
|---|---|
| `npm run dev:server` (standalone / web) | `npm run seed:dev` |
| `npm run dev:desktop` (Electron) | `SEED_TARGET=desktop npm run seed:dev` |
| Any custom setup | `DATABASE_URL=/path/to/your.db npm run seed:dev` |

Electron's `app.getPath('userData')` is platform-specific; the
CLI replicates the logic so you don't have to look it up:

- **macOS**: `~/Library/Application Support/@puntovivo/desktop/data/local.db`
- **Linux**: `$XDG_CONFIG_HOME/@puntovivo/desktop/data/local.db` (or `~/.config/...`)
- **Windows**: `%APPDATA%/@puntovivo/desktop/data/local.db`

**Heads-up**: quit the Electron app (or stop `dev:desktop`) before
seeding its DB. SQLite will reject the lock otherwise and the CLI
will exit with a clear error — but the half-finished seed can leave
orphan rows.

## Authentication after running the seed

Two independent tenants share the same DB file after seeding — one is
the baseline `default` tenant the regular server bootstrap creates on
every fresh install, and the other is the `demo-co` tenant the dev
seed adds on top. Every login resolves the user's `tenantId` and the
query builder scopes every subsequent query by that tenant, so the
two datasets never mix.

**All seeded accounts share the dev password `Admin123!Dev`** (hashed
with argon2). Development mode uses this fixed password by default;
set `PUNTOVIVO_DEV_ADMIN_PASSWORD` before the first boot if you want
a different baseline admin password.

### Demo tenant — `demo-co` (Demo Retail Colombia)

Log in with any of these to see the rich seed data (50 products,
30 customers, 20 historical sales, 6 purchases, 5 quotations,
receipt templates, etc.):

| Email | Role | Name |
|---|---|---|
| `admin@demo.co` | `admin` | Administrador Demo |
| `manager.norte@demo.co` | `manager` | María Manager (Norte) |
| `manager.sur@demo.co` | `manager` | Mateo Manager (Sur) |
| `cashier.norte@demo.co` | `cashier` | Carolina Cajera (Norte) |
| `cashier.sur@demo.co` | `cashier` | Camilo Cajero (Sur) |
| `viewer@demo.co` | `viewer` | Visor Demo |

### Default tenant — `default` (Default Business)

Untouched by the dev seed. Survives every run of `seed:dev` and
every `--reset`:

| Email | Role | Tenant data |
|---|---|---|
| `admin@localhost` | `admin` | Empty — 1 site, 0 products, 0 customers, 0 sales |

Useful when you want to test a fresh-install / first-day flow without
losing the demo data, or to compare "populated vs empty" UI states
side by side.

### Which login to use when

- **Demos, QA of populated-UI flows, screenshots**: `admin@demo.co`.
- **Testing empty-tenant states, first-run wizards, migrations on a
  clean slate**: `admin@localhost`.
- **Role-gating QA** (making sure a cashier cannot open Setup, etc.):
  `cashier.norte@demo.co` / `manager.norte@demo.co` / `viewer@demo.co`
  against the demo tenant.

### Verify the two-tenant split

```bash
sqlite3 packages/server/data/local.db \
  "SELECT tenants.slug, COUNT(products.id) FROM tenants
   LEFT JOIN products ON products.tenant_id = tenants.id
   GROUP BY tenants.slug"
```

Expected output after a fresh `npm run seed:dev`:

```
default|0
demo-co|50
```

### Resetting

- **Just the demo tenant** (keeps `admin@localhost` intact):
  `SEED_RESET=true npm run seed:dev`.
- **Everything — nuclear**: delete the DB file and let the baseline
  regenerate. Works when `DATABASE_URL` is not set (defaults to
  `packages/server/data/local.db`):

  ```bash
  rm -f packages/server/data/local.db
  npm run seed:dev
  ```

  The server's `initDatabase()` recreates the schema and runs the
  baseline seed (creating the `default` tenant + `admin@localhost`)
  before `seedDevData()` adds the demo tenant on top.

## What it creates

All data is deterministic (fixed names, SKUs, prices) so two runs
produce byte-identical output. This keeps snapshot-style tests
stable and makes bug repros reproducible.

### Tenant + users

See [Authentication after running the seed](#authentication-after-running-the-seed)
above — that section is the canonical list of tenants, users, roles,
passwords, and which login to use for what. Everything below ("Company
+ sites", catalogs, historical data) lives inside the `demo-co`
tenant; the `default` tenant the baseline seed creates stays empty
and untouched.

### Company + sites + locations

- 1 company: `Demo Retail Colombia S.A.S.`, NIT `900.123.456-7`,
  Bogotá address + phone.
- 2 active sites: `Sede Norte` (Calle 100 #10-23) and `Sede Sur`
  (Cra 13 #38-45).
- 4 locations (tenant-wide): `Principal`, `Bodega`, `Exhibición`,
  `Dañados`, each with a unique `LOC-NN` code.

### Geography

- 1 country (Colombia), 1 department (Cundinamarca), 1 city
  (Bogotá D.C.) so customer addresses resolve cleanly.

### Catalog masters

- **3 VAT rates**: IVA 0%, 5%, 19%.
- **5 units**: Unidad (UND), Kilogramo (KG), Litro (LT), Gramo (GR),
  Paquete (PQTE).
- **5 identification types**: CC, NIT, CE, PA, TI.
- **2 person types**: Persona natural, Persona jurídica.
- **2 regime types**: Responsable de IVA, No responsable de IVA.
- **2 client types**: Minorista, Mayorista.
- **2 commercial activities**: comercio retail (CIIU 4711 y 4723).
- **8 document-sequential rows per site**: sale / purchase / order
  / quotation, each with a site-specific prefix so the tenant-scoped
  `(tenant_id, sale_number)` / `(tenant_id, purchase_number)` unique
  constraints never collide across sites. Sede Norte gets `VTA-N-`,
  Sede Sur gets `VTA-S-`, etc.

### Categories + providers

- **8 categories** covering a Colombian tienda: Abarrotes, Bebidas,
  Lácteos, Panadería, Carnicería, Limpieza, Papelería, Licores.
- **5 providers** (one per category group-ish) with Colombian NITs
  and realistic contacts.

### Customers

30 customers mixing natural persons, juridical entities, and
passport-holders:

- 20 `CC` (natural) — realistic Colombian names (`Juan Pérez`,
  `María López`, ...).
- 7 `NIT` (juridical) — store / service companies (`Ferretería La
  13 S.A.S.`, `Restaurante Doña Lucha`, ...).
- 2 `PA` (passport) — foreign visitors.
- 1 `Consumidor final` placeholder (NIT `222222222222`) for
  anonymous sales.

### Products

Default preset: **50 products** across the 8 categories, with unit
assignments, barcodes (half of them EAN-13), provider references, and
initial stock split 60/40 between Sede Norte and Sede Sur.

Stock is deterministically distributed so every category has:

- One SKU with **0 stock** (exercises the stock-out banner and the
  sales-time insufficient-stock error).
- A few SKUs with moderate stock (10–50 units).
- A few SKUs with high stock (100–200 units).

VAT rates are assigned by category (abarrotes: 0% / 5%; bebidas:
mostly 19%; lácteos + panadería + carnicería: 0%; limpieza +
papelería + licores: 19%) so a typical sale has a mix of rates.

`--preset=large` bumps the catalog to **500 products** (same category
distribution, with synthetic `v2`, `v3`, ... name suffixes) for stress
tests of list views and search.

### Receipt templates

- 1 template per kind (sale / quotation / fiscal_dee), built from
  the default layouts in
  `apps/web/src/features/receipt-templates/defaultLayouts.ts` so the
  editor never opens blank.

### Historical operational data

Populated via the tRPC caller so every row lands through the same
service transaction path the UI uses — this guarantees
`products.stock = Σ(inventory_balances.on_hand)` and every other
invariant the production code enforces.

- **Historical purchases**: `preset * 3` per site (6 default, 12
  large), spread across providers with 2–4 items each.
- **Historical sales**: 10 per cashier in the closed historical
  session + 10 per cashier in the currently-open session (20 per
  cashier, 40 large). About a third are split tenders (cash + card
  with a fake auth code); about a fifth are `consumidor final`
  (no customer linked).
- **Cash sessions**: each cashier has one closed session and one
  open session, so the dashboard renders both active and
  historical balances.
- **Quotations**: 5 (default) / 10 (large) distributed across the
  `draft` / `sent` / `accepted` / `rejected` / `expired` states so
  every filter chip in the quotations page has results.
- **Inventory transfers**: 3 (default) / 5 (large) between the two
  sites with random origin/destination.
- **Stock adjustments**: 4 (default) / 6 (large) hitting
  `inventory.adjustStock` so the `inventory.adjust_stock` audit
  row gets populated.

## Production guard

The CLI refuses to run when `NODE_ENV=production` or
`PUNTOVIVO_RUNTIME_ENV=production`:

```
$ NODE_ENV=production npm run seed:dev
[seed-dev] refusing to run: NODE_ENV / PUNTOVIVO_RUNTIME_ENV is production.
[seed-dev] If you really want demo data in production (you do not), unset the env var first.
```

The underlying `seedDevData()` function has no such guard — it is
safe to call from tests that run against `:memory:`. The guard lives
on the CLI entry only.

## Idempotency

- Without `SEED_RESET=true`, a second invocation on a DB that already
  contains the demo tenant is a **no-op**. The CLI still prints the
  credentials so the operator can copy them.
- With `SEED_RESET=true`, the CLI wipes the demo tenant + all FK
  children in safe order and then reseeds. Cascades on `products`,
  `sale_items`, `sale_payments`, `quotation_items`, `purchase_items`,
  `transfer_order_items`, and `unit_x_product` / `product_x_provider`
  do most of the deletion; the CLI deletes the remaining parent
  tables scoped by `tenant_id`.

## Troubleshooting

### `npm run seed:dev` exits with code 137 (SIGKILL)

Exit 137 = 128 + 9 (SIGKILL). The seed itself is small (~2 MB of data
in total) so it never runs out of memory on its own; when the CLI
dies with 137 the usual culprit is **file-lock contention against the
DB**. SQLite in WAL mode allows concurrent readers, but the seed takes
an exclusive write lock at migration / transaction time and will be
killed by the OS if it cannot acquire it within the SQLite busy timeout.

Check for zombie `dev:server` processes first — `tsx watch` keeps
them alive across terminal sessions and they hold the DB file open:

```bash
ps aux | grep -E "tsx watch|standalone" | grep -v grep
lsof packages/server/data/local.db  # shows PIDs holding the file
```

If anything is listed, kill it before running the seed:

```bash
pkill -f "tsx watch src/standalone.ts"
pkill -f "dev-launcher.mjs server"
```

Other rare causes:

- **Another Electron instance** (`npm run dev` or a packaged build)
  pointing at the same DB path. Either close it or point the seed at
  a different `DATABASE_URL`.
- **Actual macOS memory pressure** killing node processes during a
  heavy test run. Usually clears after 30s; re-try.

### `"UNIQUE constraint failed: purchases.tenant_id, purchases.purchase_number"`

The seed per-site prefixes (`VTA-N-`, `VTA-S-`) prevent this inside a
single run, but if you already ran the seed once and then called it
again **without** `SEED_RESET=true` while the demo tenant exists, it
short-circuits cleanly. The error only shows up if you manually
insert sequentials with colliding prefixes outside the seed.

### The default tenant is not empty on my machine

The baseline seed only creates `admin@localhost`, but
`packages/server/data/local.db` also accumulates data from every
prior `npm run dev:server` session, E2E test run, and manual QA click.
`seed:dev` never touches the default tenant, so any demo data you
created under `admin@localhost` in earlier runs survives.

If you want a truly empty `default` tenant alongside the populated
`demo-co`:

```bash
rm -f packages/server/data/local.db
npm run seed:dev
```

The nuclear reset recreates both from scratch.

## Implementation files

```
packages/server/src/db/seed-dev.ts              # seedDevData() — the data builder
packages/server/src/scripts/seed-dev.ts         # CLI entry (production guard, args, banner)
packages/server/src/__tests__/seed-dev.test.ts  # vitest suite (row counts, invariants, isolation)
packages/server/package.json                    # "seed:dev" npm script
package.json                                    # root "seed:dev" shortcut
```

## Tests

Run with `npm run test --workspace=@puntovivo/server -- --run seed-dev`:

- Demo tenant created with slug `demo-co`.
- 6 users tagged to the demo tenant, argon2 hash verifies
  `Admin123!Dev`.
- 50 products + 30 customers + 5 providers + 2 sites + 8 categories +
  3 receipt templates.
- Invariant `products.stock = Σ(inventory_balances.on_hand)` per
  product.
- At least 10 historical sales (allowing stockout skips).
- Second `seedDevData()` call on the same DB returns
  `{ seeded: false }`.
- Default tenant sees zero of the demo data (cross-tenant isolation).

## Out of scope

- **Multi-tenant seed** (2+ tenants in one run). The seed intentionally
  creates one tenant (`demo-co`) so it mirrors the Electron
  single-install reality. Future `--multi-tenant` flag could add a
  second tenant for tests that exercise isolation.
- **Generating real logo images** — the seed leaves `logos` empty; the
  receipt preview renders an empty placeholder where the logo block
  would sit.
- **Seeding fiscal documents** (Iter 3 Fase A). Waits for
  `fiscal_documents` / `fiscal_document_items` to land.
- **Backdating history** — all seeded rows currently have the same
  `created_at` timestamp (`now`). The dashboard's time filters will
  show everything under "Today". Adding a backdating pass is a
  follow-up: after seeding, issue one `UPDATE sales SET created_at = ?
  WHERE id = ?` per sale with a deterministic distribution across the
  last 14 days.
