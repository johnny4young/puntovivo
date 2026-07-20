/**
 * SurfacePlaceholder render tests.
 *
 * Pins the contract:
 * - Reads `surfaces.<i18nKey>.label` + `.description` + `.upcomingTicket`.
 * - Renders the dashboard CTA link.
 * - Each per-surface wrapper passes the right i18nKey down.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

vi.mock('react-i18next', async () => {
  const mod = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...mod,
    useTranslation: () => ({
      t: (key: string) => `tx:${key}`,
      i18n: { changeLanguage: vi.fn() },
    }),
  };
});

import { SurfacePlaceholder } from '../SurfacePlaceholder';
import { TouchHomePlaceholder } from '../TouchHomePlaceholder';
// KdsHomePlaceholder no longer routes through SurfacePlaceholder;
// the real KdsBoard now mounts there. The Touch / CustomerDisplay /
// MobileWaiter wrappers stay as placeholder shells and still pin the
// SurfacePlaceholder contract below.
import { CustomerDisplayHomePlaceholder } from '../CustomerDisplayHomePlaceholder';
import { MobileWaiterHomePlaceholder } from '../MobileWaiterHomePlaceholder';

describe('SurfacePlaceholder', () => {
  it('renders the surface label, description, upcoming ticket badge, and CTA', () => {
    render(
      <MemoryRouter>
        <SurfacePlaceholder i18nKey="kds" />
      </MemoryRouter>
    );
    expect(screen.getByTestId('surface-placeholder')).toBeInTheDocument();
    expect(screen.getByText('tx:kds.label')).toBeInTheDocument();
    expect(screen.getByText('tx:kds.description')).toBeInTheDocument();
    expect(screen.getByText('tx:kds.upcomingTicket')).toBeInTheDocument();
    expect(screen.getByText('tx:placeholder.dashboardCta')).toBeInTheDocument();
  });
});

describe('Per-surface placeholder wrappers', () => {
  function renderInRouter(node: ReactElement) {
    return render(<MemoryRouter>{node}</MemoryRouter>);
  }

  it('TouchHomePlaceholder uses i18nKey "posTouch"', () => {
    renderInRouter(<TouchHomePlaceholder />);
    expect(screen.getByText('tx:posTouch.label')).toBeInTheDocument();
  });

  // KdsHomePlaceholder now mounts the real KdsBoard, so the
  // "i18nKey kds" placeholder assertion is no longer applicable. Live
  // smoke + KdsBoard.test.tsx cover the new behavior.

  it('CustomerDisplayHomePlaceholder uses i18nKey "customerDisplay"', () => {
    renderInRouter(<CustomerDisplayHomePlaceholder />);
    expect(screen.getByText('tx:customerDisplay.label')).toBeInTheDocument();
  });

  it('MobileWaiterHomePlaceholder uses i18nKey "mobileWaiter"', () => {
    renderInRouter(<MobileWaiterHomePlaceholder />);
    expect(screen.getByText('tx:mobileWaiter.label')).toBeInTheDocument();
  });
});
