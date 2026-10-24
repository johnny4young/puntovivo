/** The theme must share the editor language runtime, in both module formats. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

const require = createRequire(import.meta.url);

test('One Dark shares the ESM editor language runtime and installs into editor state', () => {
  assert.ok(oneDarkHighlightStyle instanceof HighlightStyle);
  const state = EditorState.create({
    doc: 'synthetic receipt template',
    extensions: [syntaxHighlighting(oneDarkHighlightStyle)],
  });
  assert.equal(state.doc.toString(), 'synthetic receipt template');
});

test('One Dark shares the CommonJS editor language runtime', () => {
  const themeRequire = createRequire(require.resolve('@codemirror/theme-one-dark'));
  assert.equal(
    themeRequire.resolve('@codemirror/language'),
    require.resolve('@codemirror/language')
  );
  assert.ok(
    require('@codemirror/theme-one-dark').oneDarkHighlightStyle instanceof
      require('@codemirror/language').HighlightStyle
  );
});
