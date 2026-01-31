# Open Yojob

<p align="center">
  <strong>Modern POS (Point of Sale) Desktop Application</strong><br>
  Built with Electron Forge, React, and PocketBase
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#development">Development</a> •
  <a href="#building">Building</a> •
  <a href="#migration">Migration</a>
</p>

---

## Features

- 🏢 **Multi-Tenant Architecture** - Complete tenant isolation for business management
- 📴 **Offline Support** - Full functionality without internet, with automatic sync
- 🖥️ **Cross-Platform Desktop** - Windows, macOS, Linux via Electron
- 📊 **Advanced Data Tables** - Sorting, filtering, pagination, export (CSV, Excel, PDF)
- 🔐 **Secure Authentication** - JWT-based auth with role-based access control
- 🔄 **Auto-Updates** - Automatic updates from GitHub Releases
- 🚀 **Embedded Backend** - PocketBase runs as a child process (no external server needed)

## Tech Stack

| Layer       | Technology                      | Purpose                         |
| ----------- | ------------------------------- | ------------------------------- |
| Desktop     | Electron 34 + Forge             | Native desktop app              |
| Frontend    | React 18 + TypeScript           | UI Framework                    |
| Styling     | Tailwind CSS v4 + CVA           | Utility-first CSS + Variants    |
| Data Tables | TanStack Table                  | Feature-rich tables             |
| State       | TanStack Query + Zustand        | Server & client state           |
| Backend     | PocketBase (embedded)           | API & database (Go binary)      |
| Database    | SQLite                          | Embedded database               |
| Build       | Electron Forge + Vite           | Build & packaging               |
| Updates     | update-electron-app             | Auto-updates from GitHub        |

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
│   └── desktop/                # Electron Forge desktop app
│       ├── forge.config.ts     # Electron Forge configuration
│       ├── package.json
│       ├── index.html          # Renderer entry HTML
│       ├── vite.*.config.ts    # Vite configs (main, preload, renderer)
│       ├── resources/
│       │   └── pocketbase/     # PocketBase binaries per platform
│       └── src/
│           ├── main/           # Electron main process
│           │   ├── index.ts    # App entry point
│           │   ├── pocketbase.ts  # PocketBase manager
│           │   ├── auto-updater.ts
│           │   ├── database.ts # Local SQLite for offline
│           │   └── sync.ts     # Sync service
│           ├── preload/        # Preload scripts (IPC bridge)
│           └── renderer/       # React UI
│               ├── App.tsx
│               ├── index.tsx
│               └── index.css
├── backend/                    # Go source (for custom PocketBase builds)
│   ├── go.mod
│   ├── cmd/server/
│   └── migrations/
├── scripts/
│   ├── download-pocketbase.sh  # Download PocketBase binaries
│   └── migration/              # Data migration tools
├── .github/workflows/
│   └── build.yml               # CI/CD: build & release
├── package.json                # Root workspace config
└── REFACTORING_PLAN.md
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

# Download PocketBase binaries
./scripts/download-pocketbase.sh
```

### Development

```bash
# Start Electron app in development mode
npm run dev

# Or from the desktop directory
cd apps/desktop && npm start
```

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

| Variable              | Description                          | Default         |
| --------------------- | ------------------------------------ | --------------- |
| `AUTO_UPDATE`         | Enable/disable auto-updates          | `true`          |
| `AUTO_UPDATE_INTERVAL`| Update check interval                | `1 hour`        |
| `POCKETBASE_PORT`     | PocketBase server port               | `8090`          |

## Development Notes

### Architecture

The application uses a unique architecture where PocketBase runs as an embedded child process:

1. **Main Process** (`src/main/index.ts`): Manages the Electron lifecycle and spawns PocketBase
2. **PocketBase Manager** (`src/main/pocketbase.ts`): Handles starting/stopping the Go backend
3. **Preload Script** (`src/preload/index.ts`): Exposes safe IPC bridges to the renderer
4. **Renderer** (`src/renderer/`): React application with full access to the API

### IPC APIs

The preload script exposes three main APIs:

```typescript
window.electron  // App info (version, paths)
window.db        // Database operations (local SQLite)
window.sync      // Sync status and triggers
```

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

<p align="center">
  Made with ❤️ by the Open Yojob team
</p>
