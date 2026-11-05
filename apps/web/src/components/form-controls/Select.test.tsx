import { render, screen } from '@/test/utils';
import { describe, expect, it } from 'vitest';
import { Select } from './Select';

const options = [{ value: 'main', label: 'Main branch' }];

describe('Select trigger name', () => {
  it('includes the selected option after an aria-label', () => {
    render(<Select aria-label="Site" options={options} value="main" />);
    expect(screen.getByRole('button', { name: 'Site: Main branch' })).toBeInTheDocument();
  });

  it('includes the placeholder after an aria-label when nothing is selected', () => {
    render(<Select aria-label="Site" options={options} placeholder="Pick one" />);
    expect(screen.getByRole('button', { name: 'Site: Pick one' })).toBeInTheDocument();
  });

  it('leaves the name to the visible label when one is rendered', () => {
    render(<Select label="Site" aria-label="Ignored" options={options} value="main" />);
    expect(screen.getByRole('button', { name: 'Site' })).not.toHaveAttribute('aria-label');
  });

  it('leaves the name to the visible text without a label', () => {
    render(<Select options={options} value="main" />);
    expect(screen.getByRole('button', { name: 'Main branch' })).not.toHaveAttribute('aria-label');
  });
});
