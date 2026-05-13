/**
 * ENG-039a — TouchHome mounting smoke.
 * Confirms the page wrapper renders the shared screen with the
 * `touch` variant. The full behavior matrix lives in
 * VoiceOrderingScreen.test.tsx.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../VoiceOrderingScreen', () => ({
  VoiceOrderingScreen: ({ variant }: { variant: string }) => (
    <div data-testid="voice-ordering-stub" data-variant={variant} />
  ),
}));

import TouchHome from '../TouchHome';

describe('TouchHome (ENG-039a)', () => {
  it('mounts VoiceOrderingScreen with variant="touch"', () => {
    render(<TouchHome />);
    const stub = screen.getByTestId('voice-ordering-stub');
    expect(stub.getAttribute('data-variant')).toBe('touch');
  });
});
