import path from 'node:path';

const NODE_SCRIPT_EXTENSIONS = new Set(['.cjs', '.js', '.mjs']);
const WINDOWS_SHELL_EXTENSIONS = new Set(['.bat', '.cmd']);

export function resolvePnpmInvocation(
  pnpmEntry,
  { execPath = process.execPath, platform = process.platform } = {}
) {
  if (typeof pnpmEntry !== 'string' || pnpmEntry.trim() === '') {
    throw new Error('A pnpm executable entry is required');
  }

  const extension = path.extname(pnpmEntry).toLowerCase();
  if (NODE_SCRIPT_EXTENSIONS.has(extension)) {
    return { command: execPath, argsPrefix: [pnpmEntry], shell: false };
  }

  return {
    command: pnpmEntry,
    argsPrefix: [],
    shell: platform === 'win32' && WINDOWS_SHELL_EXTENSIONS.has(extension),
  };
}
