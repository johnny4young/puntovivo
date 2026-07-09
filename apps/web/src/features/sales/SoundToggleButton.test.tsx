/**
 * ENG-193 — device-local sound toggle in the POS header.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import { isSoundEnabled } from '@/lib/sound';
import { SoundToggleButton } from './SoundToggleButton';

describe('SoundToggleButton', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts OFF with the localized enable label', () => {
    render(<SoundToggleButton />);
    const button = screen.getByTestId('sales-sound-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.getAttribute('aria-label')).toMatch(/Activa|Turn on/i);
  });

  it('toggles and persists the device-local preference', () => {
    render(<SoundToggleButton />);
    const button = screen.getByTestId('sales-sound-toggle');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(isSoundEnabled()).toBe(true);

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(isSoundEnabled()).toBe(false);
  });
});
