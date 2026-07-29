import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_ADVANCED_TAB_GROUPS,
  isOperationsTabKey,
} from './operationsNavigationModel';

describe('operationsNavigationModel', () => {
  it('accepts every stable operations tab identifier', () => {
    expect(isOperationsTabKey('attention')).toBe(true);
    for (const group of OPERATIONS_ADVANCED_TAB_GROUPS) {
      for (const tab of group.tabs) {
        expect(isOperationsTabKey(tab)).toBe(true);
      }
    }
  });

  it('rejects absent, empty, retired, and unknown identifiers', () => {
    expect(isOperationsTabKey(null)).toBe(false);
    expect(isOperationsTabKey('')).toBe(false);
    expect(isOperationsTabKey('inventory')).toBe(false);
    expect(isOperationsTabKey('support-tools')).toBe(false);
  });
});
