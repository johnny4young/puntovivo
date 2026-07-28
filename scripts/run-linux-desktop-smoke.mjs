#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const portalScript = fileURLToPath(new URL('./linux-smoke-portal.py', import.meta.url));
const smokeScript = fileURLToPath(new URL('./run-desktop-smoke.mjs', import.meta.url));
const READY_LINE = '[linux-smoke-portal] ready';
const START_TIMEOUT_MS = 10_000;
const STOP_TIMEOUT_MS = 5_000;

function parsePackagedPath(argv) {
  if (argv.length !== 2 || argv[0] !== '--against-packaged' || !argv[1]) {
    throw new Error(
      'Usage: node scripts/run-linux-desktop-smoke.mjs --against-packaged <package-directory>'
    );
  }
  return argv[1];
}

async function waitForPortal(portal, stderrOutput) {
  await new Promise((resolve, reject) => {
    let stdout = '';
    const finish = callback => {
      clearTimeout(timer);
      portal.stdout.off('data', onData);
      portal.off('exit', onExit);
      portal.off('error', onError);
      callback();
    };
    const timer = setTimeout(() => {
      finish(() => {
        reject(new Error(`Linux smoke portal did not become ready within ${START_TIMEOUT_MS} ms`));
      });
    }, START_TIMEOUT_MS);
    const onData = chunk => {
      stdout += chunk.toString();
      if (stdout.includes(READY_LINE)) {
        process.stdout.write(`${READY_LINE}\n`);
        portal.stdout.resume();
        finish(resolve);
      }
    };
    const onExit = (code, signal) => {
      finish(() => {
        reject(
          new Error(
            `Linux smoke portal exited before readiness (code=${String(code)}, signal=${String(signal)}): ${stderrOutput()}`
          )
        );
      });
    };
    const onError = error => {
      finish(() => reject(new Error(`Could not start the Linux smoke portal: ${error.message}`)));
    };

    portal.stdout.on('data', onData);
    portal.once('exit', onExit);
    portal.once('error', onError);
  });
}

async function runSmoke(packagedPath, renderer) {
  const args = [smokeScript, '--against-packaged', packagedPath];
  if (renderer) args.push('--renderer');

  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(
      `Packaged ${renderer ? 'renderer' : 'runtime'} smoke failed (code=${String(code)}, signal=${String(signal)})`
    );
  }
}

async function stopPortal(portal) {
  if (portal.pid === undefined || portal.exitCode !== null || portal.signalCode !== null) return;

  portal.kill('SIGTERM');
  const stopped = once(portal, 'exit').then(() => true);
  const timedOut = new Promise(resolve => setTimeout(() => resolve(false), STOP_TIMEOUT_MS));
  if (!(await Promise.race([stopped, timedOut]))) {
    portal.kill('SIGKILL');
    await once(portal, 'exit');
  }
}

async function main() {
  const packagedPath = parsePackagedPath(process.argv.slice(2));
  let portalStderr = '';
  const portal = spawn('python3', [portalScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  portal.stderr.on('data', chunk => {
    const text = chunk.toString();
    portalStderr += text;
    process.stderr.write(text);
  });

  try {
    await waitForPortal(portal, () => portalStderr.trim());
    await runSmoke(packagedPath, false);
    await runSmoke(packagedPath, true);
    if (portalStderr.trim()) {
      throw new Error('Linux smoke portal emitted unexpected stderr output');
    }
  } finally {
    await stopPortal(portal);
  }
}

main().catch(error => {
  console.error(`[linux-desktop-smoke] FAIL: ${error.message}`);
  process.exitCode = 1;
});
