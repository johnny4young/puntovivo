#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedRoot = path.join(repoRoot, 'packages', 'shared');
const SHARED_ENTRYPOINTS = ['index', 'money', 'unit-math', 'units'];

export function resolveTypescriptCompiler(resolve = import.meta.resolve) {
  const publicEntry = fileURLToPath(resolve('typescript'));
  const compiler = path.join(path.dirname(publicEntry), 'tsc.js');
  if (!existsSync(compiler)) {
    throw new Error(`TypeScript compiler is absent beside its public entry: ${compiler}`);
  }
  return compiler;
}

export function runtimeSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
      ? [entryPath]
      : [];
  });
}

export function buildIsFresh(packageRoot = sharedRoot) {
  const sourceRoot = path.join(packageRoot, 'src');
  const requiredOutputs = SHARED_ENTRYPOINTS.flatMap(name => [
    path.join(packageRoot, 'dist', `${name}.js`),
    path.join(packageRoot, 'dist', `${name}.d.ts`),
  ]);
  if (requiredOutputs.some(output => !existsSync(output))) return false;

  const inputs = [
    path.join(packageRoot, 'package.json'),
    path.join(packageRoot, 'tsconfig.json'),
    ...runtimeSourceFiles(sourceRoot),
  ];
  const latestInput = Math.max(...inputs.map(input => statSync(input).mtimeMs));
  const oldestOutput = Math.min(...requiredOutputs.map(output => statSync(output).mtimeMs));
  return oldestOutput >= latestInput;
}

export function sharedBuildInvocation(
  packageRoot = sharedRoot,
  compiler = resolveTypescriptCompiler()
) {
  return {
    command: process.execPath,
    args: [compiler, '-p', path.join(packageRoot, 'tsconfig.json')],
  };
}

export function ensureSharedBuild(packageRoot = sharedRoot, spawn = spawnSync) {
  if (buildIsFresh(packageRoot)) {
    console.log('[shared-build] up to date');
    return 0;
  }

  console.log('[shared-build] rebuilding @puntovivo/shared');
  const invocation = sharedBuildInvocation(packageRoot);
  const result = spawn(invocation.command, invocation.args, {
    cwd: packageRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exit(ensureSharedBuild());
}
