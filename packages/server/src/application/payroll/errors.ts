/** Internal payroll failures; tRPC maps these to stable safe codes and generic copy. */
export class PayrollDomainError extends Error {
  constructor(
    readonly reason:
      | 'not_found'
      | 'country'
      | 'currency'
      | 'policy'
      | 'profile_overlap'
      | 'period_overlap'
      | 'regular_run_exists'
      | 'employee_set'
      | 'authority_changed'
      | 'version'
      | 'state'
      | 'blocked'
      | 'adjustment'
  ) {
    super(`Payroll ${reason}`);
    this.name = 'PayrollDomainError';
  }
}

/** Raise one typed private-domain failure without exposing row values. */
export function denyPayroll(reason: PayrollDomainError['reason']): never {
  throw new PayrollDomainError(reason);
}
