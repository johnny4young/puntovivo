#!/usr/bin/env node
/** Reconstruct the reviewed dependency/product composition in a NEW checkout. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || existsSync(destination) || destination.startsWith(source + sep)) {
  throw new Error('Provide a new destination outside this checkout; existing paths are refused.');
}
const recipe = JSON.parse(
  readFileSync(resolve(source, 'docs/assets/dependency-composition-2026-10-24.json'), 'utf8')
);
const lock = resolve(source, recipe.lockfile);
const bytes = readFileSync(lock);
if (createHash('sha256').update(bytes).digest('hex') !== recipe.lockfileSha256) {
  throw new Error('Composition lockfile checksum mismatch');
}
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
const sourceHead = git(source, ['rev-parse', 'HEAD']);
git(dirname(destination), ['clone', '--no-hardlinks', '--no-checkout', source, destination]);
git(destination, ['remote', 'set-url', 'origin', 'git@github.com:johnny4young/puntovivo.git']);
git(destination, ['checkout', '--detach', sourceHead]);
// A shallow installation may not have the independent product-fix object.
const present = spawnSync('git', ['cat-file', '-e', `${recipe.productFix}^{commit}`], {
  cwd: destination,
});
if (present.status !== 0) git(destination, ['fetch', 'origin', recipe.productFix]);
const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', recipe.productFix, 'HEAD'], {
  cwd: destination,
});
if (ancestor.status !== 0) git(destination, ['cherry-pick', '--no-commit', recipe.productFix]);
for (const [name, changes] of Object.entries(recipe.manifestChanges)) {
  const path = resolve(destination, name);
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const [section, values] of Object.entries(changes)) Object.assign(manifest[section], values);
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
}
copyFileSync(lock, resolve(destination, 'pnpm-lock.yaml'));
console.log(`Composition reconstructed at ${destination}`);
console.log(
  'No install, test, merge, push, or deployment was performed. Use a clean test environment.'
);
console.log('Next: corepack pnpm install --frozen-lockfile --ignore-scripts');
console.log('Then: corepack pnpm run ci:audit and the documented workspace checks.');
