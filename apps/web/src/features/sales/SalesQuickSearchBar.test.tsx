import { createRef } from 'react';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { SalesQuickSearchBar } from './SalesQuickSearchBar';

function renderSearch(disabled = false) {
  const onSubmit = vi.fn();
  const result = render(
    <SalesQuickSearchBar
      query=""
      onQueryChange={vi.fn()}
      onSubmit={onSubmit}
      inputRef={createRef<HTMLInputElement>()}
      disabled={disabled}
    />
  );
  return { ...result, onSubmit };
}

describe('SalesQuickSearchBar', () => {
  it('advertises the active scanner and product shortcuts while editable', () => {
    renderSearch();

    expect(screen.getByText('Scanner ready')).toBeVisible();
    expect(screen.getByPlaceholderText('Scan barcode or type SKU / name')).toHaveAttribute(
      'aria-keyshortcuts',
      'Alt+P'
    );
    expect(screen.getByRole('button', { name: 'Search' })).toHaveAttribute(
      'aria-keyshortcuts',
      'F5'
    );
    expect(screen.getByText('F5')).toBeVisible();
  });

  it('does not advertise or dispatch product input for a locked ticket', () => {
    const { container, onSubmit } = renderSearch(true);

    expect(screen.getByText('Product editing locked')).toBeVisible();
    expect(
      screen.getByText(
        'Product search and scanner input are disabled for this locked ticket. Continue with the permitted checkout actions.'
      )
    ).toBeVisible();
    const input = screen.getByPlaceholderText('Scan barcode or type SKU / name');
    const submit = screen.getByRole('button', { name: 'Search' });
    expect(input).toBeDisabled();
    expect(input).not.toHaveAttribute('aria-keyshortcuts');
    expect(submit).toBeDisabled();
    expect(submit).not.toHaveAttribute('aria-keyshortcuts');
    expect(screen.queryByText('F5')).not.toBeInTheDocument();

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
