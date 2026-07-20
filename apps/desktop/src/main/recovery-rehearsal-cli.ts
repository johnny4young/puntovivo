import { resolve } from 'node:path';
import { runRecoveryRehearsal } from './recovery-rehearsal/run.ts';

function readOutputDirectory(args: string[]): string {
  const index = args.indexOf('--output');
  if (index === -1) {
    const suffix = `${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}-${process.pid}`;
    return resolve(process.cwd(), '.artifacts', 'recovery-rehearsal', suffix);
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--output requires a directory');
  }
  return resolve(process.cwd(), value);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    process.stdout.write('Usage: pnpm run rehearse:upgrade-recovery -- [--output <directory>]\n');
    return;
  }
  const outputDirectory = readOutputDirectory(process.argv.slice(2));
  const result = await runRecoveryRehearsal({
    repositoryRoot: process.cwd(),
    outputDirectory,
  });
  process.stdout.write(
    `${JSON.stringify({ outcome: result.report.outcome, reportPath: result.reportPath })}\n`
  );
  if (result.report.outcome !== 'passed') process.exitCode = 1;
}

await main().catch(error => {
  process.stderr.write(
    `${JSON.stringify({ outcome: 'failed', error: error instanceof Error ? error.name : 'Error' })}\n`
  );
  process.exitCode = 1;
});
