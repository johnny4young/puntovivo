import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@/test/utils';
import { TablePagination } from '../TablePagination';

// Buttons render in DOM order: [0] previous, [1] next.
const PREVIOUS = 0;
const NEXT = 1;

describe('TablePagination', () => {
  it('renders nothing when there is a single page', () => {
    const { container } = render(
      <TablePagination
        page={0}
        pageCount={1}
        total={5}
        rangeStart={1}
        rangeEnd={5}
        onPageChange={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders previous and next controls when there are multiple pages', () => {
    render(
      <TablePagination
        page={0}
        pageCount={3}
        total={20}
        rangeStart={1}
        rangeEnd={8}
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('disables previous on the first page and enables next', () => {
    render(
      <TablePagination
        page={0}
        pageCount={3}
        total={20}
        rangeStart={1}
        rangeEnd={8}
        onPageChange={vi.fn()}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[PREVIOUS]).toBeDisabled();
    expect(buttons[NEXT]).toBeEnabled();
  });

  it('disables next on the last page and enables previous', () => {
    render(
      <TablePagination
        page={2}
        pageCount={3}
        total={20}
        rangeStart={17}
        rangeEnd={20}
        onPageChange={vi.fn()}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[PREVIOUS]).toBeEnabled();
    expect(buttons[NEXT]).toBeDisabled();
  });

  it('requests the next page index when next is clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <TablePagination
        page={1}
        pageCount={3}
        total={20}
        rangeStart={9}
        rangeEnd={16}
        onPageChange={onPageChange}
      />
    );

    await user.click(screen.getAllByRole('button')[NEXT]!);

    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('requests the previous page index when previous is clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <TablePagination
        page={1}
        pageCount={3}
        total={20}
        rangeStart={9}
        rangeEnd={16}
        onPageChange={onPageChange}
      />
    );

    await user.click(screen.getAllByRole('button')[PREVIOUS]!);

    expect(onPageChange).toHaveBeenCalledWith(0);
  });

  it('gives both controls an accessible name', () => {
    render(
      <TablePagination
        page={1}
        pageCount={3}
        total={20}
        rangeStart={9}
        rangeEnd={16}
        onPageChange={vi.fn()}
      />
    );

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }
  });

  it('labels the pagination navigation landmark', () => {
    render(
      <TablePagination
        page={1}
        pageCount={3}
        total={20}
        rangeStart={9}
        rangeEnd={16}
        onPageChange={vi.fn()}
      />
    );

    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });

  it('clamps requested pages before notifying the parent', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(
      <TablePagination
        page={4}
        pageCount={3}
        total={20}
        rangeStart={17}
        rangeEnd={20}
        onPageChange={onPageChange}
      />
    );

    await user.click(screen.getAllByRole('button')[PREVIOUS]!);

    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
