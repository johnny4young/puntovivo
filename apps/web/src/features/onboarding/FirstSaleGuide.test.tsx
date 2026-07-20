import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FirstSaleGuide } from './FirstSaleGuide';

const state = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'manager' | 'cashier' | 'viewer',
  siteId: 'site-1' as string | null,
  query: {
    data: {
      completed: false,
      steps: [
        { id: 'product' as const, completed: false },
        { id: 'cashSession' as const, completed: false },
        { id: 'firstSale' as const, completed: false },
      ],
    },
    isLoading: false,
  },
  queryOptions: undefined as { enabled?: boolean; staleTime?: number } | undefined,
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', role: state.role, tenantId: 'tenant-1' },
  }),
}));

vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentSite: state.siteId ? { id: state.siteId, name: 'Main site' } : null,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    setupReadiness: {
      firstSale: {
        useQuery: (_input: unknown, options: { enabled?: boolean; staleTime?: number }) => {
          state.queryOptions = options;
          return state.query;
        },
      },
    },
  },
}));

function guideTree(openRequest = 0) {
  return (
    <StrictMode>
      <MemoryRouter>
        <FirstSaleGuide openRequest={openRequest} />
      </MemoryRouter>
    </StrictMode>
  );
}

function renderGuide(openRequest = 0) {
  return render(guideTree(openRequest));
}

function completedPayload() {
  return {
    data: {
      completed: true,
      steps: [
        { id: 'product' as const, completed: true },
        { id: 'cashSession' as const, completed: true },
        { id: 'firstSale' as const, completed: true },
      ],
    },
    isLoading: false,
  };
}

describe('FirstSaleGuide', () => {
  beforeEach(() => {
    state.role = 'admin';
    state.siteId = 'site-1';
    state.query = {
      data: {
        completed: false,
        steps: [
          { id: 'product', completed: false },
          { id: 'cashSession', completed: false },
          { id: 'firstSale', completed: false },
        ],
      },
      isLoading: false,
    };
    state.queryOptions = undefined;
  });

  it('shows a fresh tenant the ordered, deep-linked checklist', () => {
    renderGuide();

    expect(screen.getByText('Your first sale in 5 minutes')).toBeInTheDocument();
    expect(screen.getByText('0 of 3 steps completed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create product/i })).toHaveAttribute(
      'href',
      '/products'
    );
    expect(screen.getByRole('link', { name: /go to sales/i })).toHaveAttribute('href', '/sales');
    expect(screen.getByRole('link', { name: /make a sale/i })).toHaveAttribute('href', '/sales');
    expect(state.queryOptions).toEqual({ enabled: true, staleTime: 30_000 });
  });

  it('keeps the product milestone visible but hides its restricted CTA from cashiers', () => {
    state.role = 'cashier';
    renderGuide();

    expect(screen.getByText(/create a product/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create product/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to sales/i })).toBeInTheDocument();
  });

  it('dismisses for the current mount and reopens only from a new help request', async () => {
    const user = userEvent.setup();
    const view = renderGuide();

    await user.click(screen.getByRole('button', { name: /dismiss first sale guide/i }));
    expect(screen.queryByTestId('first-sale-guide')).not.toBeInTheDocument();

    view.rerender(guideTree(1));
    expect(screen.getByTestId('first-sale-guide')).toBeInTheDocument();
  });

  it('celebrates the incomplete-to-complete transition and then auto-hides', () => {
    vi.useFakeTimers();
    const view = renderGuide();
    state.query = completedPayload();

    view.rerender(guideTree());
    expect(screen.getByTestId('first-sale-celebration')).toBeInTheDocument();
    expect(screen.getByText('Your first sale is complete!')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByTestId('first-sale-celebration')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('does not celebrate an already-mature tenant but lets Help reopen the checklist', () => {
    state.query = completedPayload();
    const view = renderGuide();
    expect(screen.queryByTestId('first-sale-guide')).not.toBeInTheDocument();
    expect(screen.queryByTestId('first-sale-celebration')).not.toBeInTheDocument();

    view.rerender(guideTree(1));
    expect(screen.getByTestId('first-sale-guide')).toBeInTheDocument();
    expect(screen.getByText('3 of 3 steps completed')).toBeInTheDocument();
  });

  it('does not query or render for viewers or without a selected site', () => {
    state.role = 'viewer';
    const view = renderGuide();
    expect(state.queryOptions?.enabled).toBe(false);
    expect(view.container).toBeEmptyDOMElement();

    state.role = 'admin';
    state.siteId = null;
    view.rerender(guideTree());
    expect(state.queryOptions?.enabled).toBe(false);
    expect(view.container).toBeEmptyDOMElement();
  });
});
