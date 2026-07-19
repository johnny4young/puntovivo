import { describe, expect, it } from 'vitest';
import {
  createSupportSnapshot,
  serializeSupportSnapshot,
  supportSnapshotFilename,
  type SupportSnapshotSource,
} from './supportSnapshot';

describe('supportSnapshot', () => {
  it('projects only explicitly allowed aggregate support fields', () => {
    const devices = [
      {
        id: 'device-secret-id',
        name: 'Caja privada',
        pairedSiteId: 'site-secret-id',
        pairedSiteName: 'Sucursal secreta',
        healthStatus: 'online' as const,
        appVersion: ' 1.5.1 ',
      },
      {
        id: 'device-stale-id',
        name: 'Tablet gerente',
        healthStatus: 'stale' as const,
        appVersion: '1.5.0',
      },
      {
        id: 'device-revoked-id',
        name: 'Caja antigua',
        healthStatus: 'revoked' as const,
        appVersion: '1.5.1',
      },
    ];
    const source: SupportSnapshotSource = {
      runtime: { kind: 'desktop', currentVersion: '1.5.1', updateState: 'idle' },
      modules: { diagnostics: true, fiscal: true, copilot: false },
      devices,
      telemetryEnabled: false,
    };

    const snapshot = createSupportSnapshot(source, new Date('2026-07-13T23:45:12.345Z'));
    const serialized = serializeSupportSnapshot(snapshot);

    expect(snapshot).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-07-13T23:45:12.345Z',
      runtime: { kind: 'desktop', currentVersion: '1.5.1', updateState: 'idle' },
      modules: { active: 2, total: 3 },
      devices: {
        active: 2,
        online: 1,
        stale: 1,
        revoked: 1,
        appVersions: ['1.5.0', '1.5.1'],
      },
      telemetry: { enabled: false },
    });
    expect(serialized).not.toMatch(
      /device-secret-id|Caja privada|site-secret-id|Sucursal secreta|Tablet gerente|diagnostics|fiscal|copilot/
    );
  });

  it('builds a portable UTC filename without punctuation that breaks Windows', () => {
    expect(supportSnapshotFilename('2026-07-13T23:45:12.345Z')).toBe(
      'puntovivo-support-snapshot-20260713T234512Z.json'
    );
  });
});
