import { describe, expect, it } from 'vitest';
import { qrModulesPath } from './transferQrPath';

describe('qrModulesPath', () => {
  it('merges each row of dark modules into horizontal runs', () => {
    // 3x3: row 0 = ##., row 1 = .#., row 2 = ###
    const data = [1, 1, 0, 0, 1, 0, 1, 1, 1];
    expect(qrModulesPath(3, data)).toBe('M0 0h2v1h-2zM1 1h1v1h-1zM0 2h3v1h-3z');
  });

  it('draws nothing for an empty matrix', () => {
    expect(qrModulesPath(2, [0, 0, 0, 0])).toBe('');
  });
});
