# Open Yojob

<p align="center">
  <strong>Modern POS (Point of Sale) Solutions System</strong><br>
  Built with React, Golang/PocketBase, and Electron
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#tech-stack">Tech Stack</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#development">Development</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#migration">Migration</a>
</p>

---

## Features

- 🏢 **Multi-Tenant Architecture** - Complete tenant isolation for SaaS deployment
- 📴 **Offline Support** - Full functionality without internet, with automatic sync
- 🖥️ **Cross-Platform** - Web app + Desktop (Windows, macOS, Linux via Electron)
- 📊 **Advanced Data Tables** - Sorting, filtering, pagination, export (CSV, Excel, PDF)
- 🔐 **Secure Authentication** - JWT-based auth with role-based access control
- 🔄 **Real-time Updates** - Live data synchronization via WebSockets
- 📱 **Responsive Design** - Works on desktop and tablet devices

## Tech Stack

| Layer       | Technology               | Purpose               |
| ----------- | ------------------------ | --------------------- |
| Frontend    | React 18 + TypeScript    | UI Framework          |
| Styling     | Tailwind CSS             | Utility-first CSS     |
| Data Tables | TanStack Table           | Feature-rich tables   |
| State       | TanStack Query + Zustand | Server & client state |
| Backend     | Golang + PocketBase      | API & database        |
| Database    | SQLite                   | Embedded database     |
| Desktop     | Electron                 | Native desktop app    |
| Build       | Turborepo + pnpm         | Monorepo tooling      |

## Project Structure

```
open_yojob/
├── apps/
│   ├── web/                    # React web application
│   │   ├── src/
│   │   │   ├── components/     # Reusable UI components
│   │   │   ├── features/       # Feature modules
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   ├── services/       # API & storage services
│   │   │   └── pages/          # Route pages
│   │   └── package.json
│   └── desktop/                # Electron desktop app
│       ├── src/
│       │   ├── main/           # Electron main process
│       │   ├── preload/        # Preload scripts
│       │   └── renderer/       # Renderer (uses web app)
│       └── package.json
├── backend/                    # Golang + PocketBase backend
│   ├── cmd/server/             # Server entry point
│   └── migrations/             # Database schema
├── scripts/
│   └── migration/              # Data migration tools
├── docker/                     # Docker configs
├── .github/workflows/          # CI/CD pipelines
├── docker-compose.yml
├── turbo.json
└── package.json
```

## Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **Go** >= 1.21 (for backend development)

### Installation

```bash
# Clone repository
git clone https://github.com/johnny4young/open_yojob.git
cd open_yojob

# Install dependencies
pnpm install
```

### Development

```bash
# Start web app (http://localhost:3000)
pnpm dev:web

# Start backend (http://localhost:8090)
pnpm dev:backend

# Start desktop app
pnpm dev:desktop

# Run all together
pnpm dev
```

### Testing

```bash
# Run all tests
pnpm test

# Run web tests with coverage
pnpm --filter @open-yojob/web test:coverage
```

### Building

```bash
# Build all packages
pnpm build

# Build web app only
pnpm build:web

# Build desktop for current platform
pnpm --filter @open-yojob/desktop package
```

## Development

### Environment Variables

Create `.env` files in respective directories:

**apps/web/.env**

```env
VITE_API_URL=http://localhost:8090
```

**Root .env** (for Docker)

```env
APP_PORT=8090
VITE_API_URL=http://localhost:8090
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=your-password
```

### Available Scripts

| Command            | Description                        |
| ------------------ | ---------------------------------- |
| `pnpm dev`         | Start all apps in development mode |
| `pnpm dev:web`     | Start web app only                 |
| `pnpm dev:desktop` | Start desktop app only             |
| `pnpm dev:backend` | Start backend server               |
| `pnpm build`       | Build all packages                 |
| `pnpm test`        | Run all tests                      |
| `pnpm lint`        | Lint all packages                  |
| `pnpm clean`       | Clean all build outputs            |

### Code Quality

```bash
# Lint
pnpm lint

# Format
pnpm format

# Type check
pnpm --filter @open-yojob/web exec tsc --noEmit
```

## Deployment

### Docker (Recommended)

```bash
# Production build and run
docker-compose up -d

# With SSL (requires domain)
docker-compose --profile production up -d

# Development with hot reload
docker-compose --profile development up
```

### Manual Deployment

1. **Build the web app:**

   ```bash
   pnpm build:web
   ```

2. **Build the backend:**

   ```bash
   cd backend
   go build -o server ./cmd/server
   ```

3. **Run:**
   ```bash
   ./server serve --http=0.0.0.0:8090 --publicDir=../apps/web/dist
   ```

### Desktop Distribution

```bash
# Build for all platforms
pnpm --filter @open-yojob/desktop dist

# Platform-specific
pnpm --filter @open-yojob/desktop dist:mac
pnpm --filter @open-yojob/desktop dist:win
pnpm --filter @open-yojob/desktop dist:linux
```

## Migration

### From Legacy .NET Application

Migration scripts are provided to transfer data from the legacy .NET WinForms SQLite database:

```bash
cd scripts/migration
pip install -r requirements.txt

# Dry run first
python migrate.py --source /path/to/POSSolutions.db --dry-run

# Run migration
python migrate.py --source /path/to/POSSolutions.db --target http://localhost:8090
```

See [scripts/migration/README.md](scripts/migration/README.md) for detailed instructions.

## Architecture

### Multi-Tenant Design

```
┌─────────────────────────────────────────────────────┐
│                    Application                       │
├──────────────┬───────────────────┬──────────────────┤
│   Tenant A   │     Tenant B      │    Tenant C      │
├──────────────┴───────────────────┴──────────────────┤
│              Tenant Isolation Layer                  │
├─────────────────────────────────────────────────────┤
│              PocketBase + SQLite                     │
└─────────────────────────────────────────────────────┘
```

### Offline Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │     │  IndexedDB  │     │  Sync Queue │
│   / Electron│────▶│   Storage   │────▶│  (pending)  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                                │
                    ┌───────────────────────────┘
                    ▼
              ┌─────────────┐
              │   Server    │
              │ (PocketBase)│
              └─────────────┘
```

## API Documentation

Once the server is running, access PocketBase Admin UI:

- **URL:** http://localhost:8090/\_/
- Create admin account on first run

### Key Endpoints

| Endpoint                             | Description                 |
| ------------------------------------ | --------------------------- |
| `/api/collections/products/records`  | Products CRUD               |
| `/api/collections/customers/records` | Customers CRUD              |
| `/api/collections/sales/records`     | Sales CRUD                  |
| `/api/collections/inventory/records` | Inventory CRUD              |
| `/api/realtime`                      | WebSocket real-time updates |

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Original .NET WinForms application (Yojob)
- [PocketBase](https://pocketbase.io/) - Backend framework
- [TanStack](https://tanstack.com/) - React Table & Query
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Electron](https://www.electronjs.org/) - Desktop framework
