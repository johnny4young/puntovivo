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
  <a href="#migration">Migration</a> •
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
| Desktop     | Electron 40 + Forge      | Native desktop app           |
| Frontend    | React 18 + TypeScript    | UI Framework                 |
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
│   └── build.yml               # CI/CD: build & release
├── package.json                # Root workspace config
└── docs/                       # Documentation
```

## Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **Go** >= 1.23 (for backend development only)

### Installation

```bash
# Clone repository
git clone https://github.com/johnny4young/open_yojob.git
cd open_yojob

# Install dependencies
npm install
```

### Development

```bash
# Start Electron app in development mode
npm run dev

# Or from the desktop directory
cd apps/desktop && npm start

# Run server standalone (for debugging)
cd packages/server && npm run dev
```

### Database Location

The SQLite database is stored at:

- **macOS**: `~/Library/Application Support/open-yojob/data/local.db`
- **Windows**: `%APPDATA%\open-yojob\data\local.db`
- **Linux**: `~/.config/open-yojob/data/local.db`

### Default Credentials

⚠️ **SECURITY WARNING**: Default credentials are for development only!

- **Email**: `admin@localhost`
- **Password**: `admin123`

**Important:** 
- These credentials are publicly known and documented
- **Change the password immediately** after first login
- See [Security Documentation](#security) for details
- Do not use default credentials in production

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

### Architecture Guide

See **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** for comprehensive documentation including:

- System architecture diagrams
- Component deep dive
- How to run & debug
- Development workflow
- Considerations & limitations

### Styling Guide

See **[docs/STYLING.md](./docs/STYLING.md)** for styling documentation including:

- Tailwind CSS v4 configuration
- CVA (class-variance-authority) patterns
- Theme customization
- Best practices

### Components Guide

See **[docs/COMPONENTS.md](./docs/COMPONENTS.md)** for UI component documentation including:

- Available UI primitives (Button, Input, Card, etc.)
- Form controls
- Usage examples
- Component conventions

### Migration

#### From Legacy .NET WinForms Application

See [MIGRATION_PLAN.md](./MIGRATION_PLAN.md) for detailed instructions on migrating data from the original Yojob application.

```bash
# Run migration tool
cd scripts/migration
go run . migrate --source /path/to/POSSolutions.db
```

## Environment Variables

| Variable               | Description                 | Default  |
| ---------------------- | --------------------------- | -------- |
| `AUTO_UPDATE`          | Enable/disable auto-updates | `true`   |
| `AUTO_UPDATE_INTERVAL` | Update check interval       | `1 hour` |
| `SERVER_PORT`          | Backend server port         | `8090`   |

## Troubleshooting

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
npx electron-rebuild -m apps/desktop -v 40.1.0

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

### Backend Migration

The backend was migrated from PocketBase (Go) to Node.js/Fastify with Drizzle ORM. Key changes:

- **Stack**: Fastify + Drizzle ORM + better-sqlite3
- **Real-time**: Server-Sent Events (SSE) instead of WebSocket
- **Authentication**: Argon2 password hashing + JWT sessions
- **Database**: SQLite with Drizzle schema and migrations

### Architecture

The application uses a unique architecture where a Fastify server runs as an embedded child process:

1. **Main Process** (`src/main/index.ts`): Manages the Electron lifecycle and spawns the backend server
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

### 🔒 Security Analysis Available

A comprehensive security analysis has been performed on this codebase. Please review the following documents:

- **[SECURITY_README.md](./SECURITY_README.md)** - Start here for overview
- **[SECURITY_SUMMARY.md](./SECURITY_SUMMARY.md)** - Quick reference and stats
- **[SECURITY_ANALYSIS.md](./SECURITY_ANALYSIS.md)** - Detailed vulnerability analysis
- **[SECURITY_ISSUE_TEMPLATE.md](./SECURITY_ISSUE_TEMPLATE.md)** - GitHub issue template

### ⚠️ Known Security Issues

**Critical:**
- Default credentials (`admin@localhost / admin123`) are publicly documented
- **Action Required:** Change password immediately after first login

**High Priority:**
- No rate limiting on authentication endpoints
- React Router XSS vulnerability (CVE)
- node-tar path traversal vulnerabilities

**See:** [SECURITY_SUMMARY.md](./SECURITY_SUMMARY.md) for complete list and remediation steps.

### Security Best Practices

When deploying this application:

1. **Change Default Credentials** immediately
2. **Update Dependencies** regularly (`npm audit`)
3. **Enable Rate Limiting** on authentication
4. **Use Strong Passwords** (12+ characters, mixed case, numbers, symbols)
5. **Keep Electron Updated** for security patches
6. **Review** [SECURITY_ANALYSIS.md](./SECURITY_ANALYSIS.md) for detailed recommendations

### Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Review existing security documentation first
3. Contact the maintainers privately
4. Follow responsible disclosure practices

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

<p align="center">
  Made with ❤️ by the Open Yojob team
</p>
