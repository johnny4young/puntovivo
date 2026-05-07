/**
 * ENG-068 — CompanyModulesCard regression tests.
 *
 * Coverage:
 *   - Renders the manifest descriptors with translated labels +
 *     descriptions.
 *   - Toggling a module fires `modules.setActive` with the right
 *     payload and shows the success toast.
 *   - Failure path surfaces the translated error toast.
 *   - Default-vs-explicit indicator reflects the server flag.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toastSuccess = vi.fn();
const toastError = vi.fn();
const setActiveMutate = vi.fn();
const invalidateList = vi.fn(async () => undefined);
const invalidateEffective = vi.fn(async () => undefined);
let listResponse: {
  modules: Array<{
    id: string;
    i18nKey: string;
    adminVisibilityRole: string;
    defaultEnabled: boolean;
    enabled: boolean;
    isExplicit: boolean;
  }>;
} = {
  modules: [
    {
      id: 'copilot',
      i18nKey: 'copilot',
      adminVisibilityRole: 'admin',
      defaultEnabled: true,
      enabled: true,
      isExplicit: false,
    },
    {
      id: 'quotations',
      i18nKey: 'quotations',
      adminVisibilityRole: 'admin',
      defaultEnabled: true,
      enabled: false,
      isExplicit: true,
    },
  ],
};
let listLoading = false;

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      modules: {
        list: { invalidate: invalidateList },
        getEffective: { invalidate: invalidateEffective },
      },
    }),
    modules: {
      list: {
        useQuery: () => ({
          data: listResponse,
          isLoading: listLoading,
          error: null,
        }),
      },
    },
  },
}));

vi.mock('@/lib/useCriticalMutation', () => ({
  useCriticalMutation: (
    _path: string,
    options: { onSuccess?: () => Promise<void>; onSettled?: () => void }
  ) => ({
    mutateAsync: async (input: unknown) => {
      const result = await setActiveMutate(input);
      await options.onSuccess?.();
      options.onSettled?.();
      return result;
    },
    isPending: false,
  }),
}));

import { CompanyModulesCard } from './CompanyModulesCard';

describe('CompanyModulesCard (ENG-068)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    listLoading = false;
    listResponse = {
      modules: [
        {
          id: 'copilot',
          i18nKey: 'copilot',
          adminVisibilityRole: 'admin',
          defaultEnabled: true,
          enabled: true,
          isExplicit: false,
        },
        {
          id: 'quotations',
          i18nKey: 'quotations',
          adminVisibilityRole: 'admin',
          defaultEnabled: true,
          enabled: false,
          isExplicit: true,
        },
      ],
    };
    setActiveMutate.mockResolvedValue({
      moduleId: 'copilot',
      enabled: false,
      changed: true,
    });
    await i18n.changeLanguage('es');
  });

  it('renders translated label + description for each module', () => {
    render(<CompanyModulesCard />);
    expect(screen.getByText('Co-piloto')).toBeInTheDocument();
    expect(screen.getByText('Cotizaciones')).toBeInTheDocument();
    // Descriptions land in es-CO neutral LATAM (no voseo).
    expect(
      screen.getByText(/Analíticas conversacionales/i)
    ).toBeInTheDocument();
  });

  it('shows the default vs explicit indicator per row', () => {
    render(<CompanyModulesCard />);
    // copilot row → default; quotations row → explicit.
    const copilotRow = screen.getByTestId('modules-row-copilot');
    const quotationsRow = screen.getByTestId('modules-row-quotations');
    expect(copilotRow).toHaveTextContent(/por defecto/i);
    expect(quotationsRow).toHaveTextContent(/personalizado/i);
  });

  it('fires modules.setActive with the right payload and surfaces a success toast', async () => {
    render(<CompanyModulesCard />);
    const copilotToggle = screen.getByTestId('modules-toggle-copilot') as HTMLInputElement;
    expect(copilotToggle.checked).toBe(true);

    fireEvent.click(copilotToggle);

    await waitFor(() => {
      expect(setActiveMutate).toHaveBeenCalledWith({
        moduleId: 'copilot',
        enabled: false,
      });
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/desactivado/i) })
      );
    });
    await waitFor(() => {
      expect(invalidateList).toHaveBeenCalled();
      expect(invalidateEffective).toHaveBeenCalled();
    });
  });

  it('surfaces a translated error toast when the mutation fails', async () => {
    setActiveMutate.mockRejectedValueOnce(new Error('boom'));
    render(<CompanyModulesCard />);

    const quotationsToggle = screen.getByTestId(
      'modules-toggle-quotations'
    ) as HTMLInputElement;
    fireEvent.click(quotationsToggle);

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
  });

  it('shows a loading hint while the list is in-flight', () => {
    listLoading = true;
    listResponse = { modules: [] };
    render(<CompanyModulesCard />);
    expect(screen.getByText(/Cargando el estado actual/i)).toBeInTheDocument();
  });
});
