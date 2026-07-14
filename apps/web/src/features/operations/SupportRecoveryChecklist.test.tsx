import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/utils';
import { SupportRecoveryChecklist } from './SupportRecoveryChecklist';

describe('SupportRecoveryChecklist', () => {
  it('routes an admin to each concrete recovery surface', () => {
    const onNavigate = vi.fn();
    render(
      <SupportRecoveryChecklist
        isAdmin
        updateState="attention"
        staleDeviceCount={2}
        telemetryEnabled={false}
        hasSignalError={false}
        onNavigate={onNavigate}
      />
    );

    expect(screen.getByRole('heading', { name: 'Recovery checklist' })).toBeInTheDocument();
    expect(screen.getByTestId('support-recovery-updates')).toHaveTextContent('Needs review');
    expect(screen.getByTestId('support-recovery-devices')).toHaveTextContent(
      '2 devices need attention'
    );
    expect(screen.getByTestId('support-recovery-telemetry')).toHaveTextContent('Off by choice');
    expect(screen.getByTestId('support-recovery-evidence')).toHaveTextContent('Ready');

    fireEvent.click(screen.getByTestId('support-recovery-action-updates'));
    fireEvent.click(screen.getByTestId('support-recovery-action-devices'));
    fireEvent.click(screen.getByTestId('support-recovery-action-telemetry'));
    fireEvent.click(screen.getByTestId('support-recovery-action-evidence'));
    expect(onNavigate.mock.calls).toEqual([
      ['/company?tab=device'],
      ['/operations?tab=authority'],
      ['/company?tab=data'],
      ['/operations?tab=diagnostics'],
    ]);
  });

  it('keeps admin-only setup actions non-navigable for managers', () => {
    const onNavigate = vi.fn();
    render(
      <SupportRecoveryChecklist
        isAdmin={false}
        updateState="desktopOnly"
        staleDeviceCount={0}
        telemetryEnabled
        hasSignalError={false}
        onNavigate={onNavigate}
      />
    );

    expect(screen.getByTestId('support-recovery-action-updates')).not.toHaveAttribute('type');
    expect(screen.getByTestId('support-recovery-action-updates')).toHaveTextContent(
      'Admin required'
    );
    expect(screen.getByTestId('support-recovery-action-telemetry')).not.toHaveAttribute('type');
    expect(screen.getByTestId('support-recovery-action-telemetry')).toHaveTextContent(
      'Admin required'
    );
    fireEvent.click(screen.getByTestId('support-recovery-action-devices'));
    fireEvent.click(screen.getByTestId('support-recovery-action-evidence'));
    expect(onNavigate.mock.calls).toEqual([
      ['/operations?tab=authority'],
      ['/operations?tab=diagnostics'],
    ]);
  });

  it('surfaces partial signal reads without raw diagnostics', () => {
    render(
      <SupportRecoveryChecklist
        isAdmin
        updateState="checking"
        staleDeviceCount={0}
        telemetryEnabled
        hasSignalError
        onNavigate={() => undefined}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Some health signals are unavailable. Use the individual panels to continue safely.'
    );
  });

  it('distinguishes a healthy updater from one stale device', () => {
    render(
      <SupportRecoveryChecklist
        isAdmin
        updateState="healthy"
        staleDeviceCount={1}
        telemetryEnabled
        hasSignalError={false}
        onNavigate={() => undefined}
      />
    );

    expect(screen.getByTestId('support-recovery-updates')).toHaveTextContent('Ready');
    expect(screen.getByTestId('support-recovery-devices')).toHaveTextContent(
      '1 device needs attention'
    );
    expect(screen.getByTestId('support-recovery-telemetry')).toHaveTextContent('Enabled');
  });
});
