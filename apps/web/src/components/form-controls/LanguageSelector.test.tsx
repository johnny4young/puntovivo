import i18next from 'i18next';
import { fireEvent, render, screen } from '@/test/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageSelector } from './LanguageSelector';

describe('LanguageSelector', () => {
  beforeEach(async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.localStorage.clear();
    await i18next.changeLanguage('en');
  });

  it.each([
    ['en', 'Language: System', 'System'],
    ['es', 'Idioma: Sistema', 'Sistema'],
  ])('names the compact selector by purpose and visible value in %s', async (locale, name, text) => {
    await i18next.changeLanguage(locale);
    render(<LanguageSelector compact />);
    expect(screen.getByRole('button', { name })).toHaveTextContent(text);
  });

  it('keeps the compact name in step with the selected language', async () => {
    render(<LanguageSelector compact />);
    fireEvent.click(screen.getByRole('button', { name: 'Language: System' }));
    fireEvent.click(screen.getByRole('option', { name: 'Español' }));
    expect(await screen.findByRole('button', { name: 'Idioma: Español' })).toHaveTextContent(
      'Español'
    );
  });

  it('names the labelled selector from its visible label', () => {
    render(<LanguageSelector />);
    expect(screen.getByRole('button', { name: 'Language' })).toHaveTextContent('System');
  });
});
