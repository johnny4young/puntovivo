import { fireEvent, render, screen } from '@/test/utils';
import { describe, expect, it, vi } from 'vitest';
import { SupportIncidentPlaybooks } from './SupportIncidentPlaybooks';

describe('SupportIncidentPlaybooks', () => {
  it('gives an administrator real lost-device and desktop restore destinations', () => {
    const onNavigate = vi.fn();
    render(<SupportIncidentPlaybooks isAdmin isDesktop onNavigate={onNavigate} />);

    expect(screen.getByTestId('support-playbook-lostDevice')).toHaveTextContent(
      'A device is lost or stolen'
    );
    expect(screen.getByTestId('support-playbook-damagedStorage')).toHaveTextContent(
      'This workstation cannot open its data'
    );

    fireEvent.click(screen.getByTestId('support-playbook-action-lostDevice'));
    fireEvent.click(screen.getByTestId('support-playbook-action-damagedStorage'));
    expect(onNavigate.mock.calls).toEqual([['/operations?tab=authority'], ['/company?tab=data']]);
  });

  it('keeps damaged-storage recovery on desktop and administrator authority', () => {
    const onNavigate = vi.fn();
    const { rerender } = render(
      <SupportIncidentPlaybooks isAdmin isDesktop={false} onNavigate={onNavigate} />
    );

    expect(screen.getByTestId('support-playbook-action-lostDevice')).toHaveTextContent(
      'Review device access'
    );
    expect(screen.getByTestId('support-playbook-action-damagedStorage')).toHaveTextContent(
      'Desktop required'
    );

    rerender(<SupportIncidentPlaybooks isAdmin={false} isDesktop onNavigate={onNavigate} />);
    expect(screen.getByTestId('support-playbook-action-lostDevice')).toHaveTextContent(
      'Admin required'
    );
    expect(screen.getByTestId('support-playbook-action-damagedStorage')).toHaveTextContent(
      'Admin required'
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
