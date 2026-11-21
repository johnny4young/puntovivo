import { describe, expect, it } from 'vitest';
import type { UserRole } from '@/types';
import { PRIMARY_TASKS, taskOwnsPath, visiblePrimaryTasksForRole } from '../taskRegistry';

const roles: readonly UserRole[] = ['admin', 'manager', 'cashier', 'viewer'];

describe('primary task registry', () => {
  it('keeps every role at five primary decisions or fewer', () => {
    for (const role of roles) {
      expect(visiblePrimaryTasksForRole(role, {}).length).toBeLessThanOrEqual(5);
    }
  });

  it.each([
    ['admin', ['today', 'sell', 'products', 'inventory', 'businessSetup']],
    ['manager', ['today', 'sell', 'products', 'inventory', 'dayClose']],
    ['cashier', ['sell']],
    ['viewer', ['today']],
  ] as const)('projects the intended tasks for %s', (role, expected) => {
    expect(visiblePrimaryTasksForRole(role, {}).map(task => task.id)).toEqual(expected);
  });

  it('does not project tasks without an authenticated role', () => {
    expect(visiblePrimaryTasksForRole(undefined, {})).toEqual([]);
  });

  it('points only the sell task at the register the business profile uses', () => {
    const tasks = visiblePrimaryTasksForRole('admin', {}, true, '/touch');
    expect(tasks.find(task => task.id === 'sell')?.href).toBe('/touch');
    expect(tasks.find(task => task.id === 'today')?.href).toBe('/dashboard');
    expect(visiblePrimaryTasksForRole('cashier', {})[0]?.href).toBe('/sales');
    expect(PRIMARY_TASKS.find(task => task.id === 'sell')?.href).toBe('/sales');
  });

  it('keeps Vender owned by a sell task pointed at POS táctil', () => {
    const sell = visiblePrimaryTasksForRole('cashier', {}, true, '/touch')[0]!;
    expect(taskOwnsPath(sell, '/sales')).toBe(true);
    expect(taskOwnsPath(sell, '/touch')).toBe(true);
    expect(taskOwnsPath(sell, '/dashboard')).toBe(false);
  });

  it('keeps command action ids unique', () => {
    const ids = PRIMARY_TASKS.map(task => task.commandActionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps day close searchable for admins without adding a sixth primary task', () => {
    const dayClose = PRIMARY_TASKS.find(task => task.id === 'dayClose');

    expect(dayClose?.allowedRoles).toEqual(['manager']);
    expect(dayClose?.commandRoles).toEqual(['admin', 'manager']);
    expect(visiblePrimaryTasksForRole('admin', {}).map(task => task.id)).not.toContain('dayClose');
  });

  it('owns exact and nested paths without swallowing sibling routes', () => {
    const sales = PRIMARY_TASKS.find(task => task.id === 'sell');
    expect(sales).toBeDefined();
    expect(taskOwnsPath(sales!, '/sales')).toBe(true);
    expect(taskOwnsPath(sales!, '/sales/history')).toBe(true);
    expect(taskOwnsPath(sales!, '/sales-report')).toBe(false);
  });
});
