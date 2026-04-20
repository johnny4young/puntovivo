import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const sourceDir = resolve(import.meta.dirname, '..', 'src', 'db', 'migrations');
const targetDir = resolve(import.meta.dirname, '..', 'dist', 'db', 'migrations');

if (!existsSync(sourceDir)) {
  throw new Error(`Missing migrations source directory: ${sourceDir}`);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
