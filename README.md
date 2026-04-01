# Open Yojob

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

## Features

- 🏢 **Multi-Tenant Architecture** - Complete tenant isolation for business management
- 📴 **Offline Support** - Full functionality without internet, with automatic sync
- 🖥️ **Cross-Platform Desktop** - Windows, macOS, Linux via Electron
- 📊 **Advanced Data Tables** - Sorting, filtering, pagination, export (CSV, Excel, PDF)
- 🔐 **Secure Authentication** - JWT-based auth with role-based access control
- 🔄 **Auto-Updates** - Automatic updates from GitHub Releases
- 🚀 **Embedded Backend** - Fastify + SQLite runs in-process (no external server needed)

## Tech Stack

| Layer       | Technology               | Purpose                      |
| ----------- | ------------------------ | ---------------------------- |
| Desktop     | Electron 41 + Forge      | Native desktop app           |
| Frontend    | React 19 + TypeScript    | UI Framework                 |
| Styling     | Tailwind CSS v4 + CVA    | Utility-first CSS + Variants |
| Data Tables | TanStack Table           | Feature-rich tables          |
| State       | TanStack Query + Zustand | Server & client state        |
| Backend     | Fastify (embedded)       | REST API server (in-process) |
| ORM         | Drizzle ORM              | Type-safe database access    |
| Database    | SQLite (better-sqlite3)  | Embedded database            |
| Real-time   | Server-Sent Events (SSE) | Live updates                 |
| Build       | Electron Forge + Vite    | Build & packaging            |
| Updates     | update-electron-app      | Auto-updates from GitHub     |

### Styling Stack

The project uses a modern CSS architecture:

- **Tailwind CSS v4** - Native Vite plugin (no PostCSS)
- **CVA (class-variance-authority)** - Type-safe component variants
- **tailwind-merge v3** - Intelligent class merging
- **CSS Variables** - Light/dark theme support

See [docs/STYLING.md](./docs/STYLING.md) for detailed styling guidelines.

## Project Structure

```
open_yojob/
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
│   └── server/                 # @open-yojob/server package
│       ├── src/
│       │   ├── index.ts        # Server factory (createServer)
│       │   ├── db/             # Drizzle ORM schema & migrations
│       │   ├── routes/         # Fastify routes (auth, collections, sync)
│       │   └── realtime/       # SSE real-time module
│       └── package.json
├── scripts/
│   └── migration/              # Data migration tools
├── .github/workflows/
│   ├── build.yml              # CI: lint & test
│   └── release.yml            # CD: build & release desktop artifacts
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
git clone https://github.com/johnny4young/open_yojob.git
cd open_yojob

# Install dependencies
npm install

# Optional: Verify your setup
./scripts/check-setup.sh
```

### Development

#### Desktop App (Default)

```bash
# Launch desktop app with embedded server
npm run dev

# Note: In development, this expects web dev server on port 3000
# To run web + desktop together:
npm run dev:all
```

The desktop app includes an embedded Fastify server (port 8090) and loads the React UI.

#### Web App + Desktop Together

```bash
# Recommended: Start both web dev server and desktop
npm run dev:all

# What this does:
# 1. Starts web dev server on port 3000
# 2. Waits 3 seconds for server to be ready
# 3. Starts Electron with embedded backend
```

#### Web App (Browser-based)

For web development, you need **both** backend and frontend servers:

```bash
# Option A: Run both servers with one command (recommended)
npm run dev:fullstack

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

- **macOS**: `~/Library/Application Support/open-yojob/data/local.db`
- **Windows**: `%APPDATA%\open-yojob\data\local.db`
- **Linux**: `~/.config/open-yojob/data/local.db`

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
npm run make

# Build for all platforms (from apps/desktop)
cd apps/desktop
npm run make
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
AUTO_UPDATE=false npm run start
```

### Creating a Release

1. Tag the commit: `git tag v1.0.0`
2. Push the tag: `git push origin v1.0.0`
3. GitHub Actions will automatically build and create a release

## Documentation

### Quick References

- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues and fixes
- **[Debugging](./docs/DEBUGGING.md)** - Debugging the Electron app
- **[Environment Configuration](./docs/ENVIRONMENT_CONFIGURATION.md)** - Configure URLs and ports

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
**A:** Use `npm run dev:all`. See [Development](#development) above.

**Q: How do I change the API URL or port?**  
**A:** Configure via environment variables. See [Environment Configuration](./docs/ENVIRONMENT_CONFIGURATION.md).

**Q: `npm run dev:server` fails with "tsx: not found"**  
**A:** Run `npm install` to install dependencies. See [Troubleshooting](./docs/TROUBLESHOOTING.md).

**Q: Desktop app shows blank screen**  
**A:** Ensure web dev server is running. Use `npm run dev:all`. See [Troubleshooting](./docs/TROUBLESHOOTING.md#desktop-app-shows-blank-screen).

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
npm run dev:fullstack

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
3. Start the app: `npm run dev`

**Check logs**: Look for error messages in the console where you ran `npm run dev`.

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
- JWT-based sessions with secure token management
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
  Made with ❤️ by the Open Yojob team
</p>
