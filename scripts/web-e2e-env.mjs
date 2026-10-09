import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/** Fail before Playwright boot if loadEnv would reintroduce an encryption key. */
export function assertWebE2eEnvCanUsePlaintextFixture(repoRoot) {
  // Mirror the standalone loader's first-readable-file precedence. The Web
  // suite opens local.db directly as plaintext; an .env SQLCipher key would
  // otherwise be loaded by the server after Playwright clears its own copy.
  for (const file of [path.join(repoRoot, 'packages/server/.env'), path.join(repoRoot, '.env')]) {
    if (!existsSync(file)) continue;
    let parsed;
    try {
      parsed = parseEnv(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (Object.hasOwn(parsed, 'PUNTOVIVO_DB_KEY')) {
      throw new Error(
        'Web E2E uses an isolated plaintext fixture, but the selected local .env defines PUNTOVIVO_DB_KEY. Run in a clean worktree without that local .env; no key value was read into test output.'
      );
    }
    return;
  }
}
