import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('better-sqlite3/package.json');
const packageDir = path.dirname(packageJsonPath);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

execFileSync(npmCommand, ['run', 'build-release'], {
  cwd: packageDir,
  stdio: 'inherit',
});
