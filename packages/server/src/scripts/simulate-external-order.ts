/** Operator-run sandbox only. Use a private credential file, never a secret in command-line history. */
import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  acknowledgesSandboxEnvelope,
  prepareSandboxEnvelope,
  sendSandboxEnvelope,
} from '../services/external-orders/simulator.js';
try {
  const { values } = parseArgs({
    options: {
      origin: { type: 'string', default: 'http://127.0.0.1:8090' },
      connector: { type: 'string' },
      'secret-file': { type: 'string' },
      'event-file': { type: 'string' },
      repeat: { type: 'string', default: '1' },
      'fresh-retry': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const repeat = Number(values.repeat);
  if (
    !values.connector ||
    !values['secret-file'] ||
    !values['event-file'] ||
    !Number.isInteger(repeat) ||
    repeat < 1 ||
    repeat > 10
  )
    throw new Error('INVALID_OPTIONS');
  const info = await stat(values['secret-file']);
  if (
    !info.isFile() ||
    info.size > 128 ||
    (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
  )
    throw new Error('SIGNING_KEY_FILE_MUST_BE_PRIVATE');
  const eventInfo = await stat(values['event-file']);
  if (!eventInfo.isFile() || eventInfo.size > 64 * 1024) throw new Error('EVENT_FILE_TOO_LARGE');
  const secret = (await readFile(values['secret-file'], 'utf8')).trim();
  const body = await readFile(values['event-file'], 'utf8');
  let envelope = prepareSandboxEnvelope(values.connector, secret, body);
  for (let attempt = 1; attempt <= repeat; attempt++) {
    if (attempt > 1 && values['fresh-retry'])
      envelope = prepareSandboxEnvelope(values.connector, secret, body);
    const response = await sendSandboxEnvelope(values.origin, envelope);
    const accepted =
      response.status === 200 && acknowledgesSandboxEnvelope(envelope, response.body);
    // No arbitrary response body: a misconfigured endpoint must not echo secrets/PII into logs.
    process.stdout.write(JSON.stringify({ attempt, httpStatus: response.status, accepted }) + '\n');
    if (!accepted) process.exitCode = 1;
  }
} catch {
  process.stderr.write(
    'Sandbox request failed. Check origin, connector, private key file and event contract; credentials and response bodies are not logged.\n'
  );
  process.exitCode = 1;
}
