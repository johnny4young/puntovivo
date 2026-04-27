import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import i18next from '@/i18n';
import { TextBlockEditor } from './TextBlockEditor';

beforeEach(async () => {
  await i18next.changeLanguage('en');
});

interface MountOptions {
  initialValue?: string;
  maxLength?: number;
  ariaLabel?: string;
}

interface MountedEditor {
  view: EditorView;
  getValue: () => string;
}

async function mountEditor(options: MountOptions = {}): Promise<MountedEditor> {
  let captured: EditorView | null = null;
  let currentValue = options.initialValue ?? '';

  function Wrapper() {
    const [value, setValue] = useState(currentValue);
    return (
      <TextBlockEditor
        value={value}
        onChange={next => {
          currentValue = next;
          setValue(next);
        }}
        maxLength={options.maxLength}
        ariaLabel={options.ariaLabel}
        onCreateView={view => {
          captured = view;
        }}
      />
    );
  }

  render(<Wrapper />);
  await waitFor(() => {
    expect(captured).not.toBeNull();
  });
  return {
    view: captured!,
    getValue: () => currentValue,
  };
}

describe('TextBlockEditor — controlled input contract', () => {
  it('renders the initial value into the editor view', async () => {
    const { view } = await mountEditor({ initialValue: 'Hello {{sale.cashier}}' });
    expect(view.state.doc.toString()).toBe('Hello {{sale.cashier}}');
  });

  it('fires onChange and updates value when a transaction is dispatched', async () => {
    const { view, getValue } = await mountEditor({ initialValue: 'abc' });
    view.dispatch({ changes: { from: 3, to: 3, insert: 'def' } });
    await waitFor(() => {
      expect(getValue()).toBe('abcdef');
    });
  });
});

describe('TextBlockEditor — auto-close for double braces', () => {
  it('replaces a typed `{` after another `{` with `}}` and centers the caret', async () => {
    const { view } = await mountEditor({ initialValue: '{' });
    // Drive the inputHandler facet directly the same way CM6 does for a
    // beforeinput event. CM6 calls each handler in priority order until
    // one returns true; the first match short-circuits.
    const handlers = view.state.facet(EditorView.inputHandler);
    let handled = false;
    for (const handler of handlers) {
      if (handler(view, 1, 1, '{', () => view.state.update({ changes: { from: 1, to: 1, insert: '{' } }))) {
        handled = true;
        break;
      }
    }
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe('{{}}');
    expect(view.state.selection.main.head).toBe(2);
  });

  it('does NOT auto-close when the previous char is not `{`', async () => {
    const { view } = await mountEditor({ initialValue: 'abc' });
    const handlers = view.state.facet(EditorView.inputHandler);
    const fired = handlers.some(handler =>
      handler(view, 3, 3, '{', () => view.state.update({ changes: { from: 3, to: 3, insert: '{' } }))
    );
    expect(fired).toBe(false);
    // The doc should be unchanged because no handler claimed the input.
    expect(view.state.doc.toString()).toBe('abc');
  });

  it('does NOT auto-close when the cursor is at offset 0', async () => {
    const { view } = await mountEditor({ initialValue: '' });
    const handlers = view.state.facet(EditorView.inputHandler);
    const fired = handlers.some(handler =>
      handler(view, 0, 0, '{', () => view.state.update({ changes: { from: 0, to: 0, insert: '{' } }))
    );
    expect(fired).toBe(false);
  });

  it('only fires for `{` insertions, not other characters', async () => {
    const { view } = await mountEditor({ initialValue: '{' });
    const handlers = view.state.facet(EditorView.inputHandler);
    const fired = handlers.some(handler =>
      handler(view, 1, 1, 'a', () => view.state.update({ changes: { from: 1, to: 1, insert: 'a' } }))
    );
    expect(fired).toBe(false);
  });
});

describe('TextBlockEditor — maxLength enforcement', () => {
  it('rejects a transaction whose new doc would exceed maxLength', async () => {
    const { view } = await mountEditor({
      initialValue: 'abcde',
      maxLength: 5,
    });
    view.dispatch({ changes: { from: 5, to: 5, insert: 'X' } });
    expect(view.state.doc.toString()).toBe('abcde');
  });

  it('accepts transactions that stay at or under maxLength', async () => {
    const { view } = await mountEditor({
      initialValue: 'abc',
      maxLength: 5,
    });
    view.dispatch({ changes: { from: 3, to: 3, insert: 'XY' } });
    expect(view.state.doc.toString()).toBe('abcXY');
  });
});

describe('TextBlockEditor — i18n surface', () => {
  it('mounts cleanly under English locale', async () => {
    const { view } = await mountEditor({ initialValue: '' });
    expect(view).toBeDefined();
  });

  it('mounts cleanly under Spanish locale (LATAM neutral)', async () => {
    await i18next.changeLanguage('es');
    const { view } = await mountEditor({ initialValue: '' });
    expect(view).toBeDefined();
    await i18next.changeLanguage('en');
  });
});

describe('TextBlockEditor — accessibility', () => {
  it('forwards ariaLabel to the contenteditable element', async () => {
    const { view } = await mountEditor({
      initialValue: '',
      ariaLabel: 'Receipt template text',
    });
    expect(view.contentDOM.getAttribute('aria-label')).toBe(
      'Receipt template text'
    );
  });

  it('omits the aria-label attribute when no label is supplied', async () => {
    const { view } = await mountEditor({ initialValue: '' });
    expect(view.contentDOM.hasAttribute('aria-label')).toBe(false);
  });
});

// Suppress an unused-variable warning in jsdom tests when vi.fn isn't needed
// to demonstrate the test patterns above.
void vi.fn;
