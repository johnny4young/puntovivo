import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Reservation time-zone transitions', () => {
  it.each(['America/New_York', 'Australia/Lord_Howe'])(
    'rejects repeated and missing local times in %s',
    zone => {
      const module = pathToFileURL(
        resolve(process.cwd(), 'src/features/reservations/reservationTime.ts')
      ).href;
      const input =
        zone === 'America/New_York'
          ? ['2026-03-08T02:30', '2026-11-01T01:30', '2026-11-01T03:30']
          : ['2026-10-04T02:15', '2026-04-05T01:45', '2026-04-05T03:00'];
      const result = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import {fromLocalReservationTime} from ${JSON.stringify(module)};console.log(JSON.stringify(${JSON.stringify(input)}.map(fromLocalReservationTime)));`,
        ],
        { encoding: 'utf8', env: { ...process.env, TZ: zone } }
      );
      const parsed = JSON.parse(result) as Array<string | null>;
      expect(parsed[0]).toBeNull();
      expect(parsed[1]).toBeNull();
      expect(parsed[2]).toMatch(/Z$/);
    }
  );
});
