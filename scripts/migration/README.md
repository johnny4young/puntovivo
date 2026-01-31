# Migration Tool

A CLI tool for migrating data from the legacy .NET WinForms SQLite database to Open Yojob PocketBase.

## Building

```bash
cd scripts/migration
go mod tidy
go build -o migrate-tool .
```

Or build for multiple platforms:

```bash
# Linux
GOOS=linux GOARCH=amd64 go build -o migrate-tool-linux .

# macOS (Intel)
GOOS=darwin GOARCH=amd64 go build -o migrate-tool-mac-intel .

# macOS (Apple Silicon)
GOOS=darwin GOARCH=arm64 go build -o migrate-tool-mac-arm .

# Windows
GOOS=windows GOARCH=amd64 go build -o migrate-tool.exe .
```

## Usage

### Environment Variables

```bash
export PB_ADMIN_EMAIL=admin@example.com
export PB_ADMIN_PASSWORD=your_secure_password
```

### Commands

#### 1. Backup (Before Migration)

Always create a backup before running migration:

```bash
./migrate-tool backup \
  --target http://localhost:8090 \
  --email admin@example.com \
  --password your_password \
  --output backup_20260131.json
```

#### 2. Migrate (Dry Run First)

Test migration without writing data:

```bash
./migrate-tool migrate \
  --source /path/to/POSSolutions.db \
  --target http://localhost:8090 \
  --dry-run
```

#### 3. Run Actual Migration

```bash
./migrate-tool migrate \
  --source /path/to/POSSolutions.db \
  --target http://localhost:8090 \
  --email admin@example.com \
  --password your_password
```

#### 4. Rollback (If Needed)

Restore from backup:

```bash
./migrate-tool rollback \
  --backup backup_20260131.json \
  --target http://localhost:8090 \
  --email admin@example.com \
  --password your_password
```

## Data Mapping

| Legacy Table | New Collection | Notes              |
| ------------ | -------------- | ------------------ |
| Company      | tenants        | Multi-tenant root  |
| Client       | customers      | Customer data      |
| Category     | categories     | Product categories |
| Product      | products       | Product catalog    |
| Sale         | sales          | Sales transactions |
| Stock        | inventory      | Stock levels       |

## Options

### migrate

| Flag         | Description                    | Default                 |
| ------------ | ------------------------------ | ----------------------- |
| `--source`   | Path to source SQLite database | Required                |
| `--target`   | PocketBase server URL          | `http://localhost:8090` |
| `--email`    | Admin email                    | `PB_ADMIN_EMAIL` env    |
| `--password` | Admin password                 | `PB_ADMIN_PASSWORD` env |
| `--dry-run`  | Don't write data               | `false`                 |

### backup

| Flag         | Description           | Default                 |
| ------------ | --------------------- | ----------------------- |
| `--target`   | PocketBase server URL | `http://localhost:8090` |
| `--email`    | Admin email           | `PB_ADMIN_EMAIL` env    |
| `--password` | Admin password        | `PB_ADMIN_PASSWORD` env |
| `--output`   | Output file path      | `backup_TIMESTAMP.json` |

### rollback

| Flag         | Description           | Default                 |
| ------------ | --------------------- | ----------------------- |
| `--backup`   | Backup JSON file      | Required                |
| `--target`   | PocketBase server URL | `http://localhost:8090` |
| `--email`    | Admin email           | `PB_ADMIN_EMAIL` env    |
| `--password` | Admin password        | `PB_ADMIN_PASSWORD` env |
| `--dry-run`  | Don't write data      | `false`                 |
