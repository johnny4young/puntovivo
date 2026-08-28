export const BACKUP_STREAM_PROFILE_PREFIX = 'PUNTOVIVO_BACKUP_STREAM_PROFILE=';

export function resolveBackupStreamingProfileOptions({ argv, budget }) {
  const profileIndex = argv.indexOf('--profile');
  const inlineProfile = argv.find(value => value.startsWith('--profile='));
  const profile =
    inlineProfile?.slice('--profile='.length) ||
    (profileIndex >= 0 ? argv[profileIndex + 1] : undefined) ||
    'ci';
  if (profile !== 'ci' && profile !== 'release') {
    throw new Error(`Unknown backup streaming profile '${profile}'. Expected ci or release.`);
  }
  const contract = budget.operationalProfile.encryptedBackup.streamingProfile;
  return {
    profile,
    fixtureMiB: profile === 'ci' ? contract.ciFixtureMiB : contract.releaseFixtureMiB,
    strict: argv.includes('--strict'),
  };
}

export function compareBackupStreamingProfile(measurement, contract) {
  const regressions = [];
  if (measurement.rssGrowthMiB > contract.maxRssGrowthMiB) {
    regressions.push({
      metric: 'rssGrowthMiB',
      actual: measurement.rssGrowthMiB,
      ceiling: contract.maxRssGrowthMiB,
    });
  }
  if (measurement.peakRssMiB > contract.maxPeakRssMiB) {
    regressions.push({
      metric: 'peakRssMiB',
      actual: measurement.peakRssMiB,
      ceiling: contract.maxPeakRssMiB,
    });
  }
  if (measurement.dbMiB < measurement.fixtureMiB) {
    regressions.push({
      metric: 'dbMiB',
      actual: measurement.dbMiB,
      floor: measurement.fixtureMiB,
    });
  }
  return regressions;
}

export function parseBackupStreamingMeasurement(stdout) {
  const line = stdout
    .split(/\r?\n/u)
    .find(candidate => candidate.startsWith(BACKUP_STREAM_PROFILE_PREFIX));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(BACKUP_STREAM_PROFILE_PREFIX.length));
  } catch {
    return null;
  }
}
