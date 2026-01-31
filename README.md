# Open Yojob

A modern POS (Point of Sale) Solutions System built with React, Golang/PocketBase, and Electron.

## Tech Stack

| Layer       | Technology                |
| ----------- | ------------------------- |
| Frontend    | React + TypeScript + Vite |
| Styling     | Tailwind CSS              |
| Data Tables | TanStack Table            |
| Backend     | Golang + PocketBase       |
| Database    | SQLite                    |
| Desktop     | Electron                  |

## Project Structure

```
open_yojob/
├── apps/
│   ├── web/          # React web application
│   └── desktop/      # Electron desktop application
├── backend/          # Golang + PocketBase backend
│   ├── cmd/server/   # Server entry point
│   └── migrations/   # Database migrations
├── packages/         # Shared packages (future)
└── package.json      # Monorepo root config
```

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Go >= 1.21

### Installation

1. Clone the repository:

```bash
git clone https://github.com/johnny4young/open_yojob.git
cd open_yojob
```

2. Install dependencies:

```bash
pnpm install
```

3. Start the backend:

```bash
cd backend
go mod tidy
go run ./cmd/server
```

4. Start the web application:

```bash
pnpm dev:web
```

5. (Optional) Start the desktop application:

```bash
pnpm dev:desktop
```

## Development

### Web Application

The web application is built with React, TypeScript, and Vite. It features:

- **Authentication**: Login/logout with JWT tokens
- **Multi-tenant**: Support for multiple organizations
- **Offline Support**: Works offline with local storage
- **Data Tables**: TanStack Table for feature-rich grids
- **Responsive Design**: Tailwind CSS for styling

### Desktop Application

The desktop application uses Electron and includes:

- **Local Database**: SQLite for offline data storage
- **Background Sync**: Automatic sync when online
- **Native Features**: System tray, notifications, etc.

### Backend

The backend is built with Golang and PocketBase:

- **RESTful API**: Standard CRUD operations
- **Real-time**: WebSocket subscriptions
- **Multi-tenant Isolation**: Data separation by tenant
- **Sync Endpoints**: Push/pull for offline sync

## Scripts

```bash
# Development
pnpm dev           # Run all apps in development
pnpm dev:web       # Run web app only
pnpm dev:desktop   # Run desktop app only
pnpm dev:backend   # Run backend server

# Build
pnpm build         # Build all apps
pnpm build:web     # Build web app
pnpm build:desktop # Build desktop app

# Other
pnpm lint          # Lint all packages
pnpm format        # Format code with Prettier
pnpm clean         # Clean all build artifacts
```

## Features

- ✅ Multi-tenant architecture
- ✅ Offline support with background sync
- ✅ Products management
- ✅ Customers management
- ✅ Sales/invoicing
- ✅ Inventory tracking
- ✅ User authentication
- ✅ Role-based access control

## License

MIT License - see [LICENSE](LICENSE) for details.
