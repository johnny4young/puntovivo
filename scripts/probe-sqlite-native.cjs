'use strict';

const Database = require('better-sqlite3');

const db = new Database(':memory:');
try {
  db.pragma("cipher='sqlcipher'");
  const sqlite = db.prepare('SELECT 1 AS ok').get().ok;
  const cipher = db.pragma('cipher', { simple: true });
  process.stdout.write(
    JSON.stringify({
      cipher,
      electron: process.versions.electron ?? null,
      napi: process.versions.napi,
      node: process.versions.node,
      sqlite,
    })
  );
} finally {
  db.close();
}
