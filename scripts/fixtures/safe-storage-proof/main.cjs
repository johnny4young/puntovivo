'use strict';

// Runs in a real Electron main process so safeStorage reaches the OS key store.
const { createHash, randomBytes } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, safeStorage } = require('electron');

const { PROOF_DATA_DIR, PROOF_KEY_STORE, PROOF_PHASE, PROOF_RESULT, PROOF_SQLITE } = process.env;

const fingerprint = value => createHash('sha256').update(value).digest('hex');
const formatOf = envelopePath => readFileSync(envelopePath).subarray(0, 3).toString('latin1');

function openDatabase(key) {
  const Database = require(PROOF_SQLITE);
  const db = new Database(join(PROOF_DATA_DIR, 'proof.db'));
  db.pragma("cipher = 'sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${key}'"`);
  return db;
}

function createCanary(key) {
  const db = openDatabase(key);
  try {
    const canary = randomBytes(16).toString('hex');
    db.exec('CREATE TABLE proof (canary TEXT NOT NULL)');
    db.prepare('INSERT INTO proof (canary) VALUES (?)').run(canary);
    return canary;
  } finally {
    db.close();
  }
}

function readCanary(key) {
  const db = openDatabase(key);
  try {
    return db.prepare('SELECT canary FROM proof').get().canary;
  } finally {
    db.close();
  }
}

async function runPhase() {
  const store = await import(pathToFileURL(PROOF_KEY_STORE).href);
  const envelopePath = store.getDbKeyEnvelopePath(PROOF_DATA_DIR);
  const hadEnvelope = existsSync(envelopePath);
  const key = await store.getOrCreateDbKey(PROOF_DATA_DIR, safeStorage);
  const envelope = fingerprint(readFileSync(envelopePath));
  const result = {
    phase: PROOF_PHASE,
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    backend: process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : null,
    hadEnvelope,
    keyFingerprint: fingerprint(key),
    envelope,
    prefix: formatOf(envelopePath),
  };

  if (PROOF_PHASE === 'seal') {
    return { ...result, canary: createCanary(key) };
  }
  const canary = readCanary(key);
  if (PROOF_PHASE === 'reopen') {
    await store.writeSealedEnvelope(envelopePath, key, safeStorage);
    if ((await store.readSealedEnvelope(envelopePath, safeStorage)) !== key) {
      throw new Error('envelope resealed under this runtime did not return the same key');
    }
    return {
      ...result,
      canary,
      resealedEnvelope: fingerprint(readFileSync(envelopePath)),
      resealedPrefix: formatOf(envelopePath),
    };
  }
  return { ...result, canary };
}

app.disableHardwareAcceleration();
app
  .whenReady()
  .then(runPhase)
  .then(result => {
    writeFileSync(PROOF_RESULT, JSON.stringify(result));
    app.exit(0);
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
