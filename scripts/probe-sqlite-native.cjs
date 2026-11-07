'use strict';

const { isMainThread, parentPort, Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');

function probeSqlite() {
  const db = new Database(':memory:');
  try {
    db.pragma("cipher='sqlcipher'");
    return {
      sqlite: db.prepare('SELECT 1 AS ok').get().ok,
      cipher: db.pragma('cipher', { simple: true }),
    };
  } finally {
    db.close();
  }
}

if (!isMainThread) {
  // The desktop server runs in a worker: both addons must load there too,
  // while the main thread already holds the SQLite addon.
  const argon2 = require('argon2');
  argon2
    .hash('native-probe', { memoryCost: 4096, timeCost: 1, parallelism: 1 })
    .then(hash => parentPort.postMessage({ ...probeSqlite(), argon2: hash.startsWith('$argon2') }))
    .catch(error => parentPort.postMessage({ error: String(error && error.message) }));
} else {
  const main = probeSqlite();
  const worker = new Worker(__filename);
  worker.once('message', result => {
    process.stdout.write(
      JSON.stringify({
        ...main,
        electron: process.versions.electron ?? null,
        napi: process.versions.napi,
        node: process.versions.node,
        worker: result,
      })
    );
  });
  worker.once('error', error => {
    process.stdout.write(JSON.stringify({ ...main, worker: { error: String(error.message) } }));
  });
}
