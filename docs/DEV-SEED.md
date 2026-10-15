# Developer seed — disposable test data

**Language:** English · [Español](./es/DEV-SEED.md)

The explicit seed command creates demonstration data for development, tests and
QA. Interactive desktop and standalone entrypoints use `seedData: false`; a
normal new installation creates its first owner through the login screen.
Fixture accounts are not a production recovery mechanism.

## Invocation

Run from the repository root against a database you own for disposable testing:

```bash
# Default dataset
pnpm run seed:dev

# Larger catalog
SEED_PRESET=large pnpm run seed:dev

# Large catalog plus 90+ days of operational history
SEED_PRESET=mega pnpm run seed:dev

# Replace the demo tenant in the selected disposable database (destructive)
SEED_RESET=true pnpm run seed:dev

# Combine options
SEED_PRESET=large SEED_RESET=true pnpm run seed:dev
SEED_PRESET=mega SEED_RESET=true pnpm run seed:dev

# Country fixtures (default CO)
SEED_COUNTRY=MX pnpm run seed:dev
SEED_COUNTRY=CL pnpm run seed:dev

# Help and equivalent direct-workspace flags
pnpm --filter @puntovivo/server run seed:dev -- --help
pnpm --filter @puntovivo/server run seed:dev -- --preset=large --reset
```

The accepted presets are `default`, `large` and `mega`; country values are `CO`,
`MX` and `CL`. Explicit CLI flags override the environment. Reset deletes the
`demo-co` tenant and its dependent fixture records before reseeding. The target
path is not an ownership check: never aim this command at a real business or
another task's database.

## Database target and encryption

The CLI resolves its file in this order:

1. `DATABASE_URL`: an explicit override always wins.
2. `SEED_TARGET=desktop`: the CLI computes its legacy per-user path for
   `@puntovivo/desktop`; it does not query a running Electron application.
3. Default: `packages/server/data/local.db`.

The legacy computed paths are:

| Platform | CLI path                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/@puntovivo/desktop/data/local.db`                                    |
| Linux    | `$XDG_CONFIG_HOME/@puntovivo/desktop/data/local.db` or `~/.config/@puntovivo/desktop/data/local.db` |
| Windows  | `%APPDATA%/@puntovivo/desktop/data/local.db`                                                        |

These paths do not establish the location of a packaged installation or a
launcher-managed development database. Prefer an explicit disposable path.

The integrated `dev:desktop`, `dev:desktop-shell` and `dev:web-stack` launchers
normally inject `DATABASE_URL=packages/server/data/shared.db` and a private
`PUNTOVIVO_DB_KEY`. Their generated key is held in the ignored
`packages/server/data/shared-db-key.local`. The seed CLI does not automatically
inherit environment changes made inside a separate launcher process.
`SEED_TARGET=desktop` therefore does not automatically seed the shared file.

For the same encrypted fixture to be read by seed and development runtime,
provide both processes with the same explicit database path and the same private
64-hex-character key through their environment. The CLI honors the key and
configures the matching audit anchor. Do not print or commit it. Seeding a
plaintext file and later opening it with a different encryption configuration
can fail with `SQLITE_NOTADB`; it does not convert the file.

After configuring that private key in both environments, the explicit-path form
is:

```bash
DATABASE_URL=/absolute/path/to/owned-disposable.db pnpm run seed:dev
DATABASE_URL=/absolute/path/to/owned-disposable.db pnpm run dev:desktop
```

Stop your own app/server using that fixture before seeding or resetting it.
For bare standalone development, the same path can be selected explicitly:

```bash
DATABASE_URL=/absolute/path/to/owned-disposable.db pnpm run dev:server
```

## Fixture accounts and tenant isolation

The CLI explicitly initializes the baseline fixture tenant `default`, then adds
`demo-co`. Business reads resolve the authenticated user's tenant; the two
datasets do not become one business.

### Demo tenant

The demo accounts use `Admin123!Dev`, hashed with Argon2. This fixed fixture
password is defined by `DEV_USER_PASSWORD`; it is not a production credential.

| Email                   | Role      | Fixture name            |
| ----------------------- | --------- | ----------------------- |
| `admin@demo.co`         | `admin`   | Administrador Demo      |
| `manager.norte@demo.co` | `manager` | María Manager (Norte)   |
| `manager.sur@demo.co`   | `manager` | Mateo Manager (Sur)     |
| `cashier.norte@demo.co` | `cashier` | Carolina Cajera (Norte) |
| `cashier.sur@demo.co`   | `cashier` | Camilo Cajero (Sur)     |
| `viewer@demo.co`        | `viewer`  | Visor Demo              |

Use the admin for populated screenshots and configuration, and the other roles
for permission checks. The baseline `admin@localhost` belongs to the separate
fixture tenant. Its initial password defaults to `Admin123!Dev` and accepts
`PUNTOVIVO_DEV_ADMIN_PASSWORD` only when at least one of `NODE_ENV` and
`PUNTOVIVO_RUNTIME_ENV` is declared and every declared marker is `development`
or `test`. With unset or incompatible markers it generates a password instead;
the CLI does not set a development marker automatically. This does not change
the demo constant. Existing baseline accounts and operational
data are not reset when the demo tenant is replaced.

A first-owner installation test must instead start with an unowned, isolated
installation. An empty-looking baseline fixture already has an owner and is
not equivalent to that flow. See [LOGIN_GUIDE.md](./LOGIN_GUIDE.md).

## Dataset coverage

The ordinary catalog uses stable fixture names, SKUs and prices. Generated ids,
password hashes and execution-relative dates mean two database files are not
promised to be byte-identical.

| Preset    | Coverage                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `default` | 50 products, two sites, six demo users, customers, providers, categories, unit assignments, stock, receipt templates and operational examples. |
| `large`   | 500 products with the larger catalog/history paths for search and list testing.                                                                |
| `mega`    | The large foundation plus 90+ days of historical operations and a small recent-sales pass through tRPC.                                        |

The fixtures include company, geography, tax/identification catalogs, two-site
numbering prefixes, customers, stock, purchases, quotations, cash sessions and
receipt templates. Prefixes such as `VTA-N-` and `VTA-S-` avoid collisions between
site sequences under tenant-wide uniqueness constraints. Actual counts of
completed sales can vary when a fixture hits stock guards.

The mega path adds historical sales, returns, voids, drafts, cash movements,
inventory movements, purchases and supplier returns, transfers, quotations,
purchase orders, audit evidence, sync queue/conflicts, AI audit, login attempts
and a placeholder logo. Its dates are relative to execution, not a frozen
calendar window. Development country profiles and fiscal fixtures are software
test data; they do not demonstrate authority transmission or certification.

The canonical builders are
[seed-dev.ts](../packages/server/src/db/seed-dev.ts) and
[seed-mega/](../packages/server/src/db/seed-mega/).

## Repeating and resetting

Without `SEED_RESET=true`, an existing demo tenant makes the data builder a
no-op; the CLI can still print its fixture credentials. With reset, the demo
and its dependent records are removed before rebuilding. Do not interpret
idempotency as permission to run against an unknown database.

For a clean full fixture, choose a new owned disposable file and seed it.
Do not delete an existing installation database to obtain a fresh state or to
recover an account. This guide provides no production data-erasure procedure.

## Production boundary

Do not run this CLI on production data. Its current production guard checks
`PUNTOVIVO_RUNTIME_ENV` when non-empty, otherwise `NODE_ENV`, and refuses the
literal value `production`. This is not an independent proof that a selected
file is a development database. Do not change production markers to bypass a
refusal. The underlying `seedDevData()` is also used directly by isolated tests;
its caller must provide the correct data boundary.

## Troubleshooting

### Exit 137

Exit 137 indicates SIGKILL (128 + signal 9). It does not establish why the
process was killed and is not proof of SQLite contention. Check the owning
supervisor/test timeout, operating-system memory pressure and available logs.
A SQLite busy error is a separate diagnostic.

Inspect only the processes that use your chosen fixture:

```bash
lsof /absolute/path/to/owned-disposable.db
```

Stop only processes you own through their normal shutdown. Do not sweep other
worktrees' servers with a broad kill command. If another app owns the selected
file, use a different disposable target.

### Numbering collisions

The fixtures create per-site prefixes. If manually inserted sequences collide,
inspect the selected database and the failing constraint. Do not reset a real
business to bypass a numbering error.

### Unexpected data under the baseline account

The baseline tenant retains prior development activity. Demo reset does not
clear it. Choose a new disposable file to compare a clean baseline with the
populated demo, rather than deleting the old file.

## Implementation and tests

- [CLI](../packages/server/src/scripts/seed-dev.ts): options, target selection and guard.
- [Audit-key setup](../packages/server/src/scripts/seed-dev-security.ts): matching encrypted audit anchors.
- [Builder tests](../packages/server/src/__tests__/seed-dev.test.ts): fixture rows, idempotency, monetary/stock invariants and tenant isolation.
- [Server scripts](../packages/server/package.json) and [root scripts](../package.json).

```bash
pnpm --filter @puntovivo/server run test -- seed-dev
```

The test suite uses isolated data. No production seed, reset or physical-device
acceptance is implied by those tests.
