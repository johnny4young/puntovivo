import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NavigationGuardProvider } from '@/components/navigation/NavigationGuardProvider';
import { createNavigationGuardController } from '@/components/navigation/navigationGuardController';
import { assertNoA11yViolations } from '@/test/a11y';
import { render } from '@/test/utils';
import { CountryFormModal, type CountryFormValues } from './CountryFormModal';
import { DepartmentFormModal } from './DepartmentFormModal';

beforeAll(async () => {
  await i18next.changeLanguage('en');
});

const country = {
  id: 'country-co',
  tenantId: 'tenant-1',
  code: 'CO',
  name: 'Colombia',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function renderCountryModal(
  onClose = vi.fn(),
  onSubmit = vi.fn<(values: CountryFormValues) => Promise<void>>().mockResolvedValue(undefined)
) {
  const controller = createNavigationGuardController();
  const view = render(
    <NavigationGuardProvider controller={controller}>
      <CountryFormModal
        isOpen
        country={null}
        isSaving={false}
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </NavigationGuardProvider>
  );
  return { ...view, controller };
}

describe('geography forms', () => {
  it('keeps the recognizable name primary and official identifiers explicit', async () => {
    const { container } = renderCountryModal();

    expect(screen.getByRole('region', { name: 'Use a recognizable name' })).toBeInTheDocument();
    expect(screen.getByLabelText('Visible name')).toBeVisible();
    expect(screen.getByRole('button', { name: /Official code and availability/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByLabelText('Official country code')).toBeVisible();
    await assertNoA11yViolations(container);
  });

  it('rejects whitespace-only required values and preserves a dirty draft', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onSubmit = vi.fn<(values: CountryFormValues) => Promise<void>>().mockResolvedValue();
    renderCountryModal(onClose, onSubmit);

    const nameInput = screen.getByLabelText('Visible name');
    await user.type(nameInput, '   ');
    await user.type(screen.getByLabelText('Official country code'), '   ');
    await user.click(screen.getByRole('button', { name: 'Add country' }));

    expect(await screen.findByText('The country name is required')).toBeInTheDocument();
    expect(screen.getByText('The country code is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.clear(nameInput);
    await user.type(nameInput, 'Temporary country');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: 'Discard location changes?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(nameInput).toHaveValue('Temporary country');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('inherits the selected parent when adding a child location', () => {
    render(
      <NavigationGuardProvider controller={createNavigationGuardController()}>
        <DepartmentFormModal
          isOpen
          department={null}
          countries={[country]}
          defaultCountryId={country.id}
          isSaving={false}
          error={null}
          onClose={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
        />
      </NavigationGuardProvider>
    );

    expect(screen.getByText('Colombia')).toBeInTheDocument();
    expect(screen.getByLabelText('Parent country')).toHaveValue(country.id);
  });

  it('keeps the collapsed availability summary synchronized with the draft', async () => {
    const user = userEvent.setup();
    render(
      <NavigationGuardProvider controller={createNavigationGuardController()}>
        <CountryFormModal
          isOpen
          country={country}
          isSaving={false}
          error={null}
          onClose={vi.fn()}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
        />
      </NavigationGuardProvider>
    );

    const disclosure = screen.getByRole('button', { name: /Official code and availability/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure).toHaveTextContent('CO · Available');
    await user.click(disclosure);
    await user.click(screen.getByLabelText(/Available for new addresses/));
    await user.click(disclosure);
    expect(disclosure).toHaveTextContent('CO · Unavailable');
  });
});
