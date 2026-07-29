import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  Compass,
  PackagePlus,
  Settings2,
  Sparkles,
} from 'lucide-react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { assertNoA11yViolations } from '@/test/a11y';
import { render, screen } from '@/test/utils';
import { Button } from '@/components/ui';
import {
  ExpertDetailPanel,
  GuidedEmptyStateCard,
  NextActionCard,
  PrimaryTaskButton,
  PrioritizedBanner,
  ProgressiveTaskNavigation,
  QuickFormSection,
  SetupStepButton,
} from '..';

type Destination = 'guide' | 'business' | 'devices';

function NavigationHarness({ initial = 'guide' }: { initial?: Destination }) {
  const [activeItem, setActiveItem] = useState<Destination>(initial);

  return (
    <ProgressiveTaskNavigation
      ariaLabel="Setup navigation"
      activeItem={activeItem}
      primary={{
        id: 'guide',
        title: 'Guided setup',
        description: 'Complete the essential steps.',
        icon: Compass,
        testId: 'guide',
      }}
      advanced={{
        title: 'Advanced settings',
        description: 'Open only when you need more control.',
        icon: Settings2,
        disclosureId: 'advanced-settings',
        toggleTestId: 'advanced-toggle',
        panelTestId: 'advanced-panel',
        groups: [
          {
            id: 'configuration',
            label: 'Configuration',
            items: [
              { id: 'business', label: 'Business', testId: 'business' },
              { id: 'devices', label: 'Devices', testId: 'devices' },
            ],
          },
        ],
      }}
      onItemChange={setActiveItem}
    />
  );
}

describe('task-oriented experience primitives', () => {
  it('keeps advanced destinations disclosed and provides a predictable return to the guide', async () => {
    const user = userEvent.setup();
    const { container } = render(<NavigationHarness />);

    expect(screen.getByTestId('guide')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('group', { name: 'Configuration' })).toBeInTheDocument();

    await user.click(screen.getByTestId('devices'));
    expect(screen.getByTestId('devices')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('advanced-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('advanced-toggle'));
    expect(screen.getByTestId('guide')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByTestId('advanced-panel')).not.toBeInTheDocument();
    await assertNoA11yViolations(container);
  });

  it('opens a deep-linked advanced destination without an extra interaction', () => {
    render(<NavigationHarness initial="business" />);

    expect(screen.getByTestId('advanced-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('business')).toHaveAttribute('aria-current', 'page');
  });

  it('renders the next action and dominant control as one accessible context', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const { container } = render(
      <NextActionCard
        icon={Check}
        eyebrow="Next action"
        title="Review your details"
        description="Confirm the required information before continuing."
        tone="ready"
        action={
          <PrimaryTaskButton onClick={onContinue}>
            Continue
            <ArrowRight aria-hidden="true" />
          </PrimaryTaskButton>
        }
      />
    );

    const action = screen.getByRole('button', { name: 'Continue' });
    expect(action).toHaveClass('min-h-11');
    await user.click(action);
    expect(onContinue).toHaveBeenCalledOnce();
    await assertNoA11yViolations(container);
  });

  it('combines status text, guided recovery, and secondary detail without relying on color', async () => {
    const { container } = render(
      <div>
        <SetupStepButton
          icon={Building2}
          index="01"
          title="Business details"
          statusLabel="Needs review"
          tone="critical"
          active
          status="blocker"
        />
        <GuidedEmptyStateCard
          icon={Sparkles}
          title="No products yet"
          description="Complete business setup before creating the first product."
          action={<Button variant="outline">Open setup</Button>}
        />
        <ExpertDetailPanel
          icon={Settings2}
          eyebrow="Advanced"
          title="Fiscal preferences"
          description="Use these controls only when the local configuration requires them."
          variant="outline"
          action={<Button variant="ghost">Open details</Button>}
        />
      </div>
    );

    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open setup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open details' })).toBeInTheDocument();
    await assertNoA11yViolations(container);
  });

  it('keeps the highest-priority message, operational facts, and recovery together', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn();
    const { container } = render(
      <PrioritizedBanner
        icon={AlertTriangle}
        eyebrow="Action required"
        title="Review the current sale"
        description="One product needs a stock decision before payment."
        tone="critical"
        density="compact"
        meta={<span>3 items · $42.00</span>}
        action={<PrimaryTaskButton onClick={onRecover}>Review stock</PrimaryTaskButton>}
      />
    );

    expect(screen.getByText('Action required')).toBeInTheDocument();
    expect(screen.getByText('3 items · $42.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review stock' }));
    expect(onRecover).toHaveBeenCalledOnce();
    await assertNoA11yViolations(container);
  });

  it('labels a quick form section and keeps its minimum fields in one region', async () => {
    const { container } = render(
      <QuickFormSection
        icon={PackagePlus}
        eyebrow="Essential information"
        title="Create a sellable product"
        description="Enter only the information needed to add it to the sale."
        headingLevel={4}
      >
        <label htmlFor="quick-name">Product name</label>
        <input id="quick-name" />
      </QuickFormSection>
    );

    expect(
      screen.getByRole('region', { name: 'Create a sellable product' })
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Product name' })).toBeInTheDocument();
    await assertNoA11yViolations(container);
  });
});
