/**
 * Receipt template text-block editor (ENG-016 pass 4).
 *
 * Drop-in replacement for the plain `<textarea>` previously used in
 * `ReceiptTemplateEditor.tsx` for the `text` block branch. Built on
 * CodeMirror 6 with a custom StreamLanguage tokenizer
 * (`templateLanguage`), an autocomplete CompletionSource
 * (`templateAutocompleteSource`), and an inline linter
 * (`buildTemplateLinter`) wired to i18n.
 *
 * Keeps the same surface as a controlled textarea: `value` /
 * `onChange` / `maxLength`. The `maxLength` cap is enforced via a
 * Prec.high transactionFilter so insertions that would exceed the cap
 * are silently rejected — same UX as `<textarea maxLength>`.
 *
 * @module features/receipt-templates/TextBlockEditor
 */

import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { autocompletion } from '@codemirror/autocomplete';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { receiptTemplateExtension } from './templateLanguage';
import { templateAutocompleteSource } from './templateAutocomplete';
import { buildTemplateLinter } from './templateLinter';

export interface TextBlockEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Maximum allowed characters in the buffer. Default: 500. */
  maxLength?: number;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  /**
   * Test hook: invoked once after the underlying CodeMirror EditorView
   * mounts. Tests use it to capture the view and dispatch transactions
   * directly. Production callers should not need this.
   */
  onCreateView?: (view: EditorView) => void;
}

const BASE_THEME = EditorView.theme({
  '&': {
    fontSize: '0.85rem',
    minHeight: '5rem',
    border: '1px solid #cbd5e1',
    borderRadius: '0.375rem',
    backgroundColor: '#ffffff',
  },
  '.cm-content': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    padding: '0.5rem 0.5rem',
  },
  '&.cm-focused': {
    outline: 'none',
    borderColor: '#0ea5e9',
    boxShadow: '0 0 0 1px #0ea5e9',
  },
});

export function TextBlockEditor({
  value,
  onChange,
  maxLength = 500,
  placeholder,
  className,
  ariaLabel,
  onCreateView,
}: TextBlockEditorProps) {
  const { t } = useTranslation('receiptTemplates');
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const extensions = useMemo<Extension[]>(() => {
    const lengthFilter = EditorState.transactionFilter.of(tr => {
      if (!tr.docChanged) return tr;
      if (tr.newDoc.length <= maxLength) return tr;
      return [];
    });

    /**
     * Custom auto-close for the multi-char `{{ }}` pair. CodeMirror's
     * built-in `closeBrackets` extension is single-char only — it
     * happily closes `(`, `[`, `"`, `'` but cannot match a two-char
     * trigger. This input handler watches for a `{` insertion that
     * follows another `{` and replaces the typed `{` with `{}}` plus a
     * caret placement between the closing braces.
     */
    const doubleBraceAutoClose = EditorView.inputHandler.of(
      (view, from, to, text, _insert) => {
        if (text !== '{') return false;
        // Only fire on a single-cursor, no-selection insertion that
        // immediately follows another `{`.
        if (from !== to) return false;
        if (from === 0) return false;
        const prevChar = view.state.doc.sliceString(from - 1, from);
        if (prevChar !== '{') return false;
        view.dispatch({
          changes: { from, to, insert: '{}}' },
          selection: { anchor: from + 1 },
          userEvent: 'input.type',
        });
        return true;
      }
    );

    const ariaExtension = ariaLabel
      ? EditorView.contentAttributes.of({ 'aria-label': ariaLabel })
      : [];

    return [
      receiptTemplateExtension(),
      doubleBraceAutoClose,
      autocompletion({
        override: [templateAutocompleteSource],
        activateOnTyping: true,
        closeOnBlur: true,
      }),
      buildTemplateLinter((key, params) =>
        params ? t(key, params as Record<string, unknown>) : t(key)
      ),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      Prec.high(lengthFilter),
      BASE_THEME,
      ariaExtension,
    ];
  }, [maxLength, t, ariaLabel]);

  return (
    <div className={className} data-testid="text-block-editor">
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        onCreateEditor={view => {
          onCreateView?.(view);
        }}
        extensions={extensions}
        placeholder={placeholder ?? t('editor.codeEditor.placeholder')}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          closeBrackets: false,
          history: false,
          defaultKeymap: false,
          dropCursor: false,
          indentOnInput: false,
          allowMultipleSelections: false,
          searchKeymap: false,
          syntaxHighlighting: false,
          bracketMatching: false,
        }}
        aria-label={ariaLabel}
      />
    </div>
  );
}
