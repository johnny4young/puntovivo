# Puntovivo

<p align="center">
  <strong>Modern POS (Point of Sale) Desktop Application</strong><br>
  Built with Electron Forge, React, and Node.js (Fastify + SQLite)
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#development">Development</a> •
  <a href="#building">Building</a> •
  <a href="#security">Security</a>
</p>

---

## Status

**Generic retail MVP for Colombia: ~71% complete (April 2026).**
Missing for a sellable Colombian retail POS: DIAN electronic invoicing
(P0 legal blocker) and hardware integration (ESC/POS printer + cash
drawer + barcode scanner). Restaurant vertical (composition + KDS +
tables) and service verticals (salons, workshops, vets) are designed
as activatable modules in [docs/MARKET-SEGMENTS.md](./docs/MARKET-SEGMENTS.md).

![Puntovivo architecture](./docs/architecture.svg)

Detailed status and path to GA: [docs/ROADMAP.md §0 "MVP Colombia —
Definition of Done"](./docs/ROADMAP.md).

## Features

- 🏢 **Multi-Tenant Architecture** - Complete tenant isolation for business management
- 📴 **Offline Support** - Full functionality without internet, with automatic sync
- 🖥️ **Cross-Platform Desktop** - Windows, macOS, Linux via Electron
- 📊 **Advanced Data Tables** - Sorting, filtering, pagination, export (CSV, Excel, PDF)
- 🔐 **Secure Authentication** - Hybrid auth with short-lived JWT access tokens, rotated refresh cookies, CSRF protection, and role-based access control
- 🔄 **Auto-Updates** - Automatic updates from GitHub Releases
- 🚀 **Embedded Backend** - Fastify + SQLite runs in-process (no external server needed)

## Tech Stack

| Layer       | Technology                | Purpose                      |
| ----------- | ------------------------- | ---------------------------- |
| Desktop     | Electron 41 + Forge       | Native desktop app           |
| Frontend    | React 19 + TypeScript     | UI Framework                 |
| Styling     | Tailwind CSS v4 + CVA     | Utility-first CSS + Variants |
| Data Tables | TanStack Table            | Feature-rich tables          |
| State       | TanStack Query + Zustand  | Server & client state        |
| Backend     | Fastify + tRPC (embedded) | App API server (in-process)  |
| ORM         | Drizzle ORM               | Type-safe database access    |
| Database    | SQLite (better-sqlite3)   | Embedded database            |
| Real-time   | Server-Sent Events (SSE)  | Live updates                 |
| Build       | Electron Forge + Vite     | Build & packaging            |
| Updates     | update-electron-app       | Auto-updates from GitHub     |

### Styling Stack

The project uses a modern CSS architecture:

- **Tailwind CSS v4** - Native Vite plugin (no PostCSS)
- **CVA (class-variance-authority)** - Type-safe component variants
- **tailwind-merge v3** - Intelligent class merging
- **CSS Variables** - Light/dark theme support

See [docs/STYLING.md](./docs/STYLING.md) for detailed styling guidelines.

## Project Structure

```
puntovivo/
├── apps/
│   ├── desktop/                # Electron Forge desktop app
│   │   ├── forge.config.ts     # Electron Forge configuration
│   │   ├── package.json
│   │   ├── index.html          # Renderer entry HTML
│   │   ├── vite.*.config.ts    # Vite configs (main, preload, renderer)
│   │   └── src/
│   │       ├── main/           # Electron main process
│   │       │   ├── index.ts    # App entry point + embedded server
│   │       │   └── auto-updater.ts
│   │       ├── preload/        # Preload scripts (IPC bridge)
│   │       └── renderer/       # React UI
│   │           ├── App.tsx
│   │           ├── index.tsx
│   │           └── index.css
│   └── web/                    # Standalone web app (shares components)
├── packages/
│   └── server/                 # @puntovivo/server package
│       ├── src/
│       │   ├── index.ts        # Server factory (createServer)
│       │   ├── db/             # Drizzle ORM schema & migrations
│       │   ├── routes/         # Fastify routes (auth, collections, sync)
│       │   └── realtime/       # SSE real-time module
│       └── package.json
├── scripts/
│   └── migration/              # Data migration tools
├── .github/workflows/
│   ├── ci.yml                 # CI: test, lint, and build validation on main / PRs
│   └── release.yml            # Manual release workflow that normalizes the version, creates the tag, and publishes artifacts
├── package.json                # Root workspace config
└── docs/                       # Documentation
```

## Quick Start

### Prerequisites

- **Node.js** >= 22.0.0
- **npm** >= 10.0.0

### Installation

```bash
# Clone repository
git clone https://github.com/johnny4young/puntovivo.git
cd puntovivo

# Install dependencies
npm install

# Recommended: verify the install actually populated native + runtime artefacts
./scripts/check-setup.sh
```

> **Heads-up for hardened npm setups.** If your **global** `~/.npmrc`
> contains `ignore-scripts=true` (a common supply-chain hardening), the
> canonical `npm install` above still pulls packages but **skips every
> `postinstall`** — so `node_modules/electron/` never gets the platform
> runtime, `better-sqlite3` never compiles its native binding, and
> `argon2` ships without its bindings. The project's own `.npmrc` sets
> `ignore-scripts=false` to override that, but some npm setups need the
> override explicit:
>
> ```bash
> npm install --ignore-scripts=false
> ```
>
> `./scripts/check-setup.sh` detects this mismatch and prints a hint.
> If you later see `Error: Electron failed to install correctly` or
> `NODE_MODULE_VERSION mismatch`, rerun the command above.

#### Onboarding checklist (first time on this machine)

1. `node -v` → must be ≥ 22.0.0 (the root `package.json` enforces this)
2. `npm -v` → must be ≥ 10
3. `npm install` → must complete **without skipping postinstalls** (see
   the heads-up above if your global npm is hardened)
4. `./scripts/check-setup.sh` → should show Electron runtime installed
   ✓ and better-sqlite3 native binding compiled ✓
5. `npm run dev:desktop` → boots the Electron window at the login screen

If step 4 shows any ✗, fix that first — step 5 cannot succeed without
the native artefacts. `scripts/ensure-electron-binary.mjs` runs as part
of `npm run dev:desktop` to auto-heal a missing Electron runtime, but it cannot
recover from a missing `better-sqlite3.node` on its own (run
`npm rebuild better-sqlite3` for that).

### Development

Command naming convention:

- `desktop` = Electron UI workflows
- `web` = browser UI workflows
- `server` = standalone backend workflows

Use the explicit `desktop` / `web` / `server` variants in docs and day-to-day work.

#### Desktop App (Default)

```bash
# Launch web dev server + desktop app
npm run dev:desktop
```

This starts the full desktop development stack:

- Web dev server on port 3000
- Electron desktop shell
- Embedded Fastify server on port 8090 inside Electron

If you already have the web dev server running and only want the Electron shell:

```bash
npm run dev:desktop-shell
```

#### Web App (Browser-based)

For web development, you need **both** backend and frontend servers:

```bash
# Option A: Run both servers with one command (recommended)
npm run dev:web-stack

# Option B: Run servers separately in different terminals

# Terminal 1 - Backend Server (port 8090)
npm run dev:server

# Terminal 2 - Frontend Server (port 3000)
npm run dev:web
```

Then open http://localhost:3000 in your browser.

**Important**: The web app requires the backend server on port 8090 to be running.

#### Standalone Server (for debugging)

```bash
# Run server standalone
cd packages/server && npm run dev
```

### Database Location

The SQLite database is stored at:

- **macOS**: `~/Library/Application Support/puntovivo/data/local.db`
- **Windows**: `%APPDATA%\puntovivo\data\local.db`
- **Linux**: `~/.config/puntovivo/data/local.db`

### Default Credentials

- **Email**: `admin@localhost`
- **Password**: A cryptographically random password is generated on first run and displayed **once** in the server console output.

**Important:**

- Copy the generated password immediately — it is only shown once
- If you miss it, delete the database file and restart to re-seed
- See [docs/LOGIN_GUIDE.md](./docs/LOGIN_GUIDE.md) for details

## Building

### Create Distributable Packages

```bash
# Build for current platform
npm run make:desktop

# Build for all platforms (from apps/desktop)
cd apps/desktop
npm run make:desktop
```

### Output

Packages are created in `apps/desktop/out/make/`:

- **Windows**: `.exe` installer (Squirrel)
- **macOS**: `.dmg` and `.zip`
- **Linux**: `.deb` and `.rpm`

## Auto-Updates

The app automatically checks for updates from GitHub Releases using `update-electron-app`.

### Configuration

Auto-updates can be disabled via environment variable:

```bash
# Disable auto-updates
AUTO_UPDATE=false npm run dev:desktop
```

### Creating a Release

1. Open GitHub Actions and run the manual `Release` workflow.
2. Enter a version such as `1.0.0` or `v1.0.0`.
3. The workflow normalizes the input to a git tag, creates or reuses the tag on `main`, and publishes the release artifacts.
4. The workflow creates or reuses the draft GitHub release before any asset upload starts.
5. The web archive plus desktop installers and archives are uploaded directly to the GitHub release from the build jobs.
6. If the workflow is re-run and the tag or release already points to the current `main` commit, the release safely reuses that state instead of failing.
7. The normalization, release reuse, asset discovery, and rerun logic are covered by automated CI via `npm run test:release-script`.

## Documentation

### Quick References

- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues and fixes
- **[Debugging](./docs/DEBUGGING.md)** - Debugging the Electron app
- **[Environment Configuration](./docs/ENVIRONMENT_CONFIGURATION.md)** - Configure URLs and ports
- **[Roadmap](./docs/ROADMAP.md)** - Project status, priorities, and actionable work plan
- **[Strategic Plan](./docs/PLAN.md)** - Competitive analysis, academic frameworks, and technical design decisions

### Colombia MVP readiness

- **[Market Segments](./docs/MARKET-SEGMENTS.md)** - Three-ring strategy (retail, restaurant/pharmacy, services)
- **[Fiscal Integration (DIAN)](./docs/FISCAL-INTEGRATION.md)** - Electronic invoicing design
- **[POS Hardware](./docs/HARDWARE-POS.md)** - Printer, cash drawer, scanner, payment terminal
- **[Module Activation](./docs/MODULE-ACTIVATION.md)** - How verticals plug in without forking

### Vertical modules (planned)

- **[Product Composition (BOM)](./docs/PRODUCT-COMPOSITION.md)** - Recipes, modifiers, combos
- **[Restaurant Lifecycle](./docs/RESTAURANT-LIFECYCLE.md)** - Tables, KDS, preparation tickets
- **[UI Surfaces](./docs/UI-SURFACES.md)** - Desktop, touch, KDS TV, customer display, mobile
- **[Receipt Templates](./docs/RECEIPT-TEMPLATES.md)** - Visual editor for receipt/invoice layouts

### Horizon

- **[Future Verticals](./docs/FUTURE-VERTICALS.md)** - CO + LatAm Ring-4+ verticals
- **[LatAm Expansion](./docs/LATAM-EXPANSION.md)** - Fiscal adapters per country
- **[Long-Term Vision](./docs/LONG-TERM-VISION.md)** - BI, franchises, API, mobile, AI
- **[Stack Evolution](./docs/STACK-EVOLUTION.md)** - Technical evolution plan for Ring 4+

### Feature Documentation

- **[Login & Authentication](./docs/LOGIN_GUIDE.md)** - Login system, credentials, security
- **[Architecture](./docs/ARCHITECTURE.md)** - System design, components, workflow
- **[Styling](./docs/STYLING.md)** - Tailwind CSS v4, CVA patterns, theming
- **[Components](./docs/COMPONENTS.md)** - UI components, forms, usage examples

### Security

- **[Security](./docs/SECURITY.md)** - Vulnerability analysis, fixes applied, and best practices

### tRPC Integration (In Progress)

- **[tRPC Architecture](./docs/TRPC_ARCHITECTURE.md)** - Analysis and architecture overview
- **[tRPC Implementation Plan](./docs/TRPC_IMPLEMENTATION_PLAN.md)** - Migration roadmap
- **[tRPC Testing Guide](./docs/TRPC_TESTING_GUIDE.md)** - Test tRPC endpoints

### Common Questions

**Q: How do I run web + desktop together?**  
**A:** Use `npm run dev:desktop`. See [Development](#development) above.

**Q: How do I change the API URL or port?**  
**A:** Configure via environment variables. See [Environment Configuration](./docs/ENVIRONMENT_CONFIGURATION.md).

**Q: `npm run dev:server` fails with "tsx: not found"**  
**A:** Run `npm install` to install dependencies. See [Troubleshooting](./docs/TROUBLESHOOTING.md).

**Q: Desktop app shows blank screen**  
**A:** Ensure web dev server is running. Use `npm run dev:desktop`. See [Troubleshooting](./docs/TROUBLESHOOTING.md#desktop-app-shows-blank-screen).

## Environment Variables

| Variable               | Description                 | Default  |
| ---------------------- | --------------------------- | -------- |
| `AUTO_UPDATE`          | Enable/disable auto-updates | `true`   |
| `AUTO_UPDATE_INTERVAL` | Update check interval       | `1 hour` |
| `SERVER_PORT`          | Backend server port         | `8090`   |

## Troubleshooting

### Login System Issues

If you're experiencing login problems, follow these steps:

#### For Web App Users

**Problem**: Login button doesn't work or shows connection errors

**Solution**: Ensure both servers are running:

```bash
# Run both servers together (recommended)
npm run dev:web-stack

# OR run them separately in two terminals:
# Terminal 1:
npm run dev:server

# Terminal 2:
npm run dev:web
```

**Verify servers are running**:

- Backend API: http://localhost:8090/api/health (should return `{"status":"ok"}`)
- Frontend: http://localhost:3000 (should show login page)

**Default Credentials**:

- Email: `admin@localhost`
- Password: check the server console output on first run (randomly generated)

#### For Desktop App Users

**Problem**: Desktop app won't start or crashes

**Solution**: The desktop app includes an embedded server. Make sure you:

1. Run `npm install` first
2. Rebuild native modules: `npx electron-rebuild -m apps/desktop`
3. Start the app: `npm run dev:desktop`

**Check logs**: Look for error messages in the console where you ran `npm run dev:desktop`.

### Native Module Errors (electron-rebuild)

If you encounter errors like:

```
Error: The module '.../better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 127. This version of Node.js requires
NODE_MODULE_VERSION 143.
```

This happens because native modules (like `better-sqlite3`) were compiled for your system's Node.js version, not Electron's embedded Node.js version. **Run `electron-rebuild` to fix this:**

```bash
# Rebuild native modules for Electron (from project root)
npx electron-rebuild -m apps/desktop
```

#### When to Run electron-rebuild

| Scenario                                               | Command                                  |
| ------------------------------------------------------ | ---------------------------------------- |
| After `npm install`                                    | `npx electron-rebuild -m apps/desktop`   |
| After upgrading Electron                               | `npx electron-rebuild -m apps/desktop`   |
| After upgrading native packages (better-sqlite3, etc.) | `npx electron-rebuild -m apps/desktop`   |
| After switching Node.js versions (nvm, fnm, etc.)      | `npx electron-rebuild -m apps/desktop`   |
| CI/CD builds                                           | Include in build script before packaging |

#### Common Options

```bash
# Rebuild for specific module only
npx electron-rebuild -m apps/desktop -o better-sqlite3

# Force rebuild all modules
npx electron-rebuild -m apps/desktop -f

# Specify Electron version explicitly
npx electron-rebuild -m apps/desktop -v 41.1.0

# Show verbose output for debugging
npx electron-rebuild -m apps/desktop --debug
```

#### Automated Rebuild (Recommended)

Add a `postinstall` script to automatically rebuild after `npm install`:

```json
// apps/desktop/package.json
{
  "scripts": {
    "postinstall": "electron-rebuild"
  }
}
```

> **Note**: The `-m apps/desktop` flag specifies the module directory. When running from inside `apps/desktop`, you can omit it.

## Development Notes

### Architecture

The application uses a unique architecture where the Fastify server runs **in-process** inside the Electron main process (not as a separate child process):

1. **Main Process** (`src/main/index.ts`): Manages the Electron lifecycle and starts the embedded Fastify server
2. **Server Package** (`packages/server`): Node.js/Fastify backend with SQLite (Drizzle ORM) and SSE support
3. **Preload Script** (`src/preload/index.ts`): Exposes safe IPC bridges to the renderer
4. **Renderer** (`src/renderer/`): React application with full access to the API

### IPC APIs

The preload script exposes three main APIs:

```typescript
window.electron; // App info (version, paths)
window.db; // Database operations (local SQLite)
window.sync; // Sync status and triggers
```

## Security

For a comprehensive security analysis, fixes applied, and best practices, see **[docs/SECURITY.md](./docs/SECURITY.md)**.

### Key Points

- Admin password is randomly generated on first run — never hardcoded
- Rate limiting is enabled on authentication endpoints
- Argon2 password hashing with strong password policy enforced
- Hybrid sessions with in-memory bearer access tokens, `httpOnly` refresh cookies, and CSRF protection for cookie-backed auth flows
- Multi-tenant data isolation

### Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Use the [security issue template](./.github/ISSUE_TEMPLATE/security.md) for guidance
3. Contact the maintainers privately
4. Follow responsible disclosure practices

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

<p align="center">
  Made with ❤️ by the Puntovivo team
</p>
