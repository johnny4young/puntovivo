/**
 * ENG-040 — EmbeddingDriftBanner unit tests.
 *
 * Drives the banner standalone with synthetic `embeddingHealth`
 * payloads so each render path is independent of ProductsPage layout.
 * Mocks the AuthProvider role, the regenerate mutation, and tRPC
 * utils — same pattern as `ProductsPage.moduleGate.test.tsx`.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useAuthMock,
  regenerateMutateMock,
  regenerateIsPendingRef,
  embeddingHealthInvalidateMock,
  semanticSearchInvalidateMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  regenerateMutateMock: vi.fn(),
  regenerateIsPendingRef: { current: false },
  embeddingHealthInvalidateMock: vi.fn(),
  semanticSearchInvalidateMock: vi.fn(),
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      products: {
        embeddingHealth: { invalidate: embeddingHealthInvalidateMock },
        semanticSearch: { invalidate: semanticSearchInvalidateMock },
      },
    }),
    products: {
      regenerateEmbeddings: {
        useMutation: () => ({
          mutate: regenerateMutateMock,
          isPending: regenerateIsPendingRef.current,
        }),
      },
    },
  },
}));

import { EmbeddingDriftBanner } from './EmbeddingDriftBanner';

type Health = Parameters<typeof EmbeddingDriftBanner>[0]['data'];

function buildHealth(overrides: Partial<NonNullable<Health>> = {}): NonNullable<Health> {
  return {
    mode: 'available',
    activeModelId: 'text-embedding-3-small',
    totalProducts: 10,
    embeddedCount: 8,
    unembeddedCount: 2,
    staleCount: 0,
    staleSampleModelIds: [],
    lastEmbeddedAt: '2026-05-12T12:00:00.000Z',
    ...overrides,
  } as NonNullable<Health>;
}

describe('EmbeddingDriftBanner (ENG-040)', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    regenerateMutateMock.mockReset();
    regenerateIsPendingRef.current = false;
    embeddingHealthInvalidateMock.mockReset();
    semanticSearchInvalidateMock.mockReset();
    useAuthMock.mockReturnValue({ user: { id: 'u-1', role: 'admin' } });
  });

  it('renders nothing when data is null (parent still loading)', () => {
    const { container } = render(<EmbeddingDriftBanner data={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hides the banner card when mode is unavailable', () => {
    // The live-region wrapper stays mounted so screen readers can
    // track drift announcements when the state flips later; only the
    // visible card is conditional.
    render(
      <EmbeddingDriftBanner
        data={buildHealth({ mode: 'unavailable', activeModelId: null, staleCount: 0 })}
      />
    );
    expect(screen.queryByTestId('embedding-drift-banner')).not.toBeInTheDocument();
  });

  it('hides the banner card when staleCount is zero (catalog aligned)', () => {
    render(<EmbeddingDriftBanner data={buildHealth({ staleCount: 0 })} />);
    expect(screen.queryByTestId('embedding-drift-banner')).not.toBeInTheDocument();
  });

  it('renders banner + regenerate CTA when drift is present for admin', () => {
    render(
      <EmbeddingDriftBanner
        data={buildHealth({
          staleCount: 3,
          staleSampleModelIds: ['nomic-embed-text'],
        })}
      />
    );

    expect(screen.getByTestId('embedding-drift-banner')).toBeInTheDocument();
    const button = screen.getByTestId('embedding-drift-regenerate');
    expect(button).toBeEnabled();
    // The sample id surfaces inline so the operator knows what
    // model the stale rows currently carry.
    expect(screen.getByText(/nomic-embed-text/)).toBeInTheDocument();

    fireEvent.click(button);
    expect(regenerateMutateMock).toHaveBeenCalledTimes(1);
  });

  it('hides the regenerate CTA for managers (read-only nudge)', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u-2', role: 'manager' } });
    render(
      <EmbeddingDriftBanner
        data={buildHealth({
          staleCount: 2,
          staleSampleModelIds: ['nomic-embed-text'],
        })}
      />
    );

    expect(screen.getByTestId('embedding-drift-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('embedding-drift-regenerate')).not.toBeInTheDocument();
  });
});
