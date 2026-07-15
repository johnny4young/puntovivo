import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRolePerformApprovalActionDirectly,
  managerApprovalActionEnum,
  requiredApprovalRole,
} from './manager-approval.ts';

test('manager approval actions publish the complete stable catalogue', () => {
  assert.deepEqual(managerApprovalActionEnum, [
    'credit_override',
    'sale_void',
    'sale_discount',
    'cash_drawer_open',
    'sale_refund',
    'credit_sale',
  ]);
});

test('direct authority preserves the admin and manager boundary', () => {
  for (const action of managerApprovalActionEnum) {
    assert.equal(canRolePerformApprovalActionDirectly('admin', action), true);
    assert.equal(canRolePerformApprovalActionDirectly('cashier', action), false);
    assert.equal(canRolePerformApprovalActionDirectly('viewer', action), false);
  }
  assert.equal(canRolePerformApprovalActionDirectly('manager', 'sale_void'), false);
  assert.equal(canRolePerformApprovalActionDirectly('manager', 'credit_override'), false);
  assert.equal(canRolePerformApprovalActionDirectly('manager', 'sale_refund'), true);
  assert.equal(canRolePerformApprovalActionDirectly('manager', 'cash_drawer_open'), true);
  assert.equal(requiredApprovalRole('sale_void'), 'admin');
  assert.equal(requiredApprovalRole('sale_refund'), 'manager');
});
