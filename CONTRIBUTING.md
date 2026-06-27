# Contributing to Puntovivo

Thanks for your interest in Puntovivo. This guide covers the essentials for
working on the codebase.

## Development setup

Requirements: Node.js `>=24`, pnpm `11.x` (via Corepack).

```bash
corepack enable
pnpm install
pnpm --filter @puntovivo/desktop run rebuild   # rebuild native modules for Electron
```

After `pnpm install` you must rebuild native modules for Electron, or you will
hit `NODE_MODULE_VERSION` mismatch errors on `better-sqlite3` / `argon2`. See the
[README](./README.md) for the full command list and runtime notes.

## Commit conventions

This repo uses [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `refactor:`, `docs:`, `build:`, `chore:`, `ci:`, `test:`,
`perf:`. Scope with the module name, e.g. `feat(products):`, `fix(auth):`.

Versioning and the changelog are automated from these commit types by
release-please, so accurate types matter.

## Checks before opening a PR

Run the CI gate for the area you touched (these are the same commands CI runs):

| Area                                    | Command               |
| --------------------------------------- | --------------------- |
| `apps/web` (React / TypeScript)         | `pnpm run ci:web`     |
| `packages/server` (backend)             | `pnpm run ci:server`  |
| `apps/desktop/src/main` (Electron main) | `pnpm run ci:desktop` |

Each runs typecheck + lint + test (and build for web/desktop). A change that
touches both frontend and backend should pass both `ci:web` and `ci:server`.

## Pull requests

- Keep one logical change per PR.
- Make sure the relevant CI gate passes locally.
- All user-facing strings must be internationalized (English + Spanish);
  Spanish copy uses neutral Latin American Spanish in the `tú` register.

## Reporting security issues

Please do not open public issues for security vulnerabilities. See
[SECURITY](./docs/SECURITY.md) for how to report responsibly.
