/**
 * ENG-087 — TouchHome mounting smoke (V1 POS grid replaces the
 * prior VoiceOrderingScreen default from ENG-039a). Confirms the
 * page wrapper renders the V1 Touch POS surface. The full
 * behavior matrix lives in `PosTouchScreen.test.tsx`. Voice
 * ordering moves to `/touch/voice` and stays reachable via that
 * sibling route registered in `App.tsx`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/pos-touch/PosTouchScreen', () => ({
  PosTouchScreen: () => <div data-testid="pos-touch-screen-stub" />,
}));

import TouchHome from '../TouchHome';

describe('TouchHome (ENG-087)', () => {
  it('mounts the V1 Touch POS surface by default', () => {
    render(<TouchHome />);
    expect(screen.getByTestId('pos-touch-screen-stub')).toBeInTheDocument();
  });
});
