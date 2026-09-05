import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { render, screen, within } from '@/test/utils';
import type { PayrollRun } from './payrollTypes';

const mocks = vi.hoisted(() => ({
  preparation: {
    runId: 'run-1',
    runVersion: 1,
    kind: 'regular' as const,
    authorityToken: 'a'.repeat(64),
    ready: true,
    blockers: [] as string[],
    employees: [
      {
        userId: 'worker-1',
        userName: 'Ana Worker',
        userActive: true,
        siteId: 'site-1',
        siteName: 'Central',
        siteActive: true,
        payBasis: 'monthly' as 'hourly' | 'monthly',
        derivedWorkedSeconds: null as number | null,
        attendanceBlockers: [] as string[],
        configurationBlockers: [] as string[],
      },
    ],
  },
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    workforce: {
      payroll: {
        runs: {
          preparation: {
            useQuery: () => ({ data: mocks.preparation, isPending: false, error: null }),
          },
        },
      },
    },
  },
}));

import { PayrollRecalculationForm } from './PayrollRecalculationForm';

const run = {
  id: 'run-1',
  periodId: 'period-1',
  kind: 'regular',
  status: 'draft',
  currentRevision: 0,
  version: 1,
} as PayrollRun;

beforeEach(async () => {
  await i18next.changeLanguage('en');
  mocks.preparation.runVersion = 1;
  mocks.preparation.ready = true;
  mocks.preparation.blockers = [];
  mocks.preparation.employees[0]!.payBasis = 'monthly';
  mocks.preparation.employees[0]!.derivedWorkedSeconds = null;
  mocks.preparation.employees[0]!.attendanceBlockers = [];
  mocks.preparation.employees[0]!.configurationBlockers = [];
});

describe('PayrollRecalculationForm', () => {
  it('submits every authoritative regular employee with explicit reviewed facts', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <PayrollRecalculationForm
        run={run}
        saving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: /Ana Worker/ })).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByLabelText('Employee classification'),
      'private_cst'
    );
    await user.selectOptions(
      within(dialog).getByLabelText('Employer contribution exemption'),
      'does_not_apply'
    );
    await user.type(within(dialog).getByLabelText('Reviewed contribution base (COP)'), '2000000');
    await user.selectOptions(
      within(dialog).getByLabelText('Transport assistance'),
      'does_not_apply'
    );
    await user.selectOptions(within(dialog).getByLabelText('Withholding review'), 'complete');
    await user.type(within(dialog).getByLabelText('Withholding amount (COP)'), '0');
    await user.click(within(dialog).getByLabelText('Holiday calendar reviewed'));
    await user.click(within(dialog).getByLabelText('Employee rest day reviewed'));
    await user.click(within(dialog).getByLabelText('Benefits and provisions reviewed'));
    await user.type(
      within(dialog).getByLabelText('Employee review reason'),
      'Reviewed all employee payroll evidence'
    );
    await user.click(
      within(dialog).getByLabelText(
        'I reviewed the effective policy, its sources and documented limitations for this whole period.'
      )
    );
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Calculated reviewed August payroll evidence'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Calculate new revision' }));
    expect(onSubmit).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: 'worker-1',
          payrollDays: 30,
          ordinaryWorkedSeconds: null,
          employeeClassification: 'private_cst',
          contributionExemption: 'does_not_apply',
          contributionBaseAmount: 2_000_000,
          transportAssistance: 'does_not_apply',
          withholding: {
            status: 'complete',
            amount: 0,
            reason: 'Reviewed all employee payroll evidence',
          },
          benefitsReviewed: true,
          manualConcepts: [],
        }),
      ],
      'a'.repeat(64),
      true,
      'Calculated reviewed August payroll evidence'
    );
  });

  it('shows the authoritative hourly total and blocks incomplete attendance evidence', () => {
    mocks.preparation.employees[0]!.payBasis = 'hourly';
    mocks.preparation.employees[0]!.derivedWorkedSeconds = 27_000;
    mocks.preparation.employees[0]!.attendanceBlockers = ['attendance_evidence_incomplete'];
    render(
      <PayrollRecalculationForm
        run={run}
        saving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByText(/Attendance-derived hours: 7.5/)).toBeInTheDocument();
    expect(
      screen.getByText(/Resolve open, overlapping or otherwise incomplete/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calculate new revision' })).toBeDisabled();
  });

  it('submits authoritative hourly attendance as exact seconds without a decimal round trip', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    mocks.preparation.employees[0]!.payBasis = 'hourly';
    mocks.preparation.employees[0]!.derivedWorkedSeconds = 1;
    render(
      <PayrollRecalculationForm
        run={run}
        saving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Reviewed worked hours')).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByLabelText('Employee classification'),
      'private_cst'
    );
    await user.selectOptions(
      within(dialog).getByLabelText('Employer contribution exemption'),
      'does_not_apply'
    );
    await user.type(within(dialog).getByLabelText('Reviewed contribution base (COP)'), '1');
    await user.selectOptions(
      within(dialog).getByLabelText('Transport assistance'),
      'does_not_apply'
    );
    await user.selectOptions(within(dialog).getByLabelText('Withholding review'), 'complete');
    await user.type(within(dialog).getByLabelText('Withholding amount (COP)'), '0');
    await user.click(within(dialog).getByLabelText('Holiday calendar reviewed'));
    await user.click(within(dialog).getByLabelText('Employee rest day reviewed'));
    await user.click(within(dialog).getByLabelText('Benefits and provisions reviewed'));
    await user.type(
      within(dialog).getByLabelText('Employee review reason'),
      'Reviewed exact attendance evidence'
    );
    await user.click(
      within(dialog).getByLabelText(
        'I reviewed the effective policy, its sources and documented limitations for this whole period.'
      )
    );
    await user.type(
      within(dialog).getByLabelText('Private review reason'),
      'Calculated exact hourly payroll evidence'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Calculate new revision' }));
    expect(onSubmit).toHaveBeenCalledWith(
      [expect.objectContaining({ userId: 'worker-1', ordinaryWorkedSeconds: 1 })],
      'a'.repeat(64),
      true,
      'Calculated exact hourly payroll evidence'
    );
  });

  it('does not submit until policy acknowledgement and review evidence are explicit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <PayrollRecalculationForm
        run={run}
        saving={false}
        error={null}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Calculate new revision' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Select at least one employee and complete every displayed value with a private review reason.'
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
