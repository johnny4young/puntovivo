#!/usr/bin/env node
import { loadAndValidateExactOverridePolicy } from './lib/exact-override-policy.mjs';

const root = new URL('../', import.meta.url);

try {
  const result = await loadAndValidateExactOverridePolicy({
    workspacePath: new URL('pnpm-workspace.yaml', root),
    policyPath: new URL('config/exact-overrides-policy.json', root),
  });
  console.log(
    `Exact override policy passed: ${result.exactOverrideCount} pins owned by ${result.owner}; next review by ${result.nextReviewBy}.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
