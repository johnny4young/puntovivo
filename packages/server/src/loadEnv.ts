/**
 * Load `.env` early — must be imported BEFORE any module that reads
 * `process.env.*` at evaluation time.
 *
 * Why a custom loader instead of `process.loadEnvFile()` directly:
 * Node's built-in loader respects existing `process.env` values, even
 * empty strings, and refuses to overwrite them. Some launchers (npx,
 * certain shells, CI runners) pre-populate `ANTHROPIC_API_KEY=""` and
 * other commonly-known names before the script runs, which causes the
 * built-in loader to silently keep the empty string. We work around
 * that by:
 *
 *   1. Parsing the `.env` file with `util.parseEnv()` (also Node 22+).
 *   2. Applying each key only when `process.env[key]` is undefined OR
 *      empty. Any non-empty pre-existing value still wins so explicit
 *      `EXPORT=value npm run dev` invocations override the file.
 *
 * Tries the most likely locations in order and stops at the first one
 * that exists (workspace .env > repo-root .env > cwd .env). No
 * third-party dependency.
 *
 * @module loadEnv
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));

const candidates = [
  // packages/server/.env — workspace-local override (rare, but
  // wins if both files exist via the early-break below).
  resolve(here, '..', '.env'),
  // <repo-root>/.env — the canonical location alongside .env.example.
  resolve(here, '..', '..', '..', '.env'),
  // process.cwd() fallback — covers manual invocations from
  // arbitrary working directories.
  resolve(process.cwd(), '.env'),
];

for (const file of candidates) {
  if (!existsSync(file)) continue;
  try {
    const parsed = parseEnv(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      const existing = process.env[key];
      // Apply when the key is unset OR pre-set to an empty string
      // (the common npx / shell-init artefact). Non-empty values
      // remain untouched so an explicit `EXPORT=value npm run dev`
      // still wins.
      if (existing === undefined || existing === '') {
        process.env[key] = value;
      }
    }
    break;
  } catch {
    // Move on if the file is unreadable / malformed; the next
    // candidate (or no auto-load at all) keeps the server bootable.
  }
}
