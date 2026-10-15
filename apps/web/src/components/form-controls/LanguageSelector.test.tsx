import { render, screen } from '@/test/utils';
import { expect, it } from 'vitest';
import { LanguageSelector } from './LanguageSelector';

it('names the compact selector by its purpose instead of its current value', () => {
  render(<LanguageSelector compact />);
  expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('System');
});
