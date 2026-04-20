import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

// i18n guard rules: block new hardcoded user-facing strings on JSX attributes
// that are commonly missed when localizing. Use `{t('...')}` instead. These
// selectors only match string literals — interpolations via `{variable}` are
// fine. Test files are excluded because component test fixtures often use
// literal labels to drive assertions.
const NO_LITERAL_JSX_ATTRS = [
  {
    selector:
      'JSXAttribute[name.name="title"] > Literal[value=/^[A-Za-zÁ-Úá-ú][A-Za-zÁ-Úá-ú0-9 ,.!?\'""-]*[a-zA-Z]$/]',
    message:
      'Hardcoded JSX `title` attribute. Wrap with `t(\'namespace:key\')` from useTranslation.',
  },
  {
    selector:
      'JSXAttribute[name.name="placeholder"] > Literal[value=/^[A-Za-zÁ-Úá-ú][A-Za-zÁ-Úá-ú0-9 ,.!?\'""-]*[a-zA-Z]$/]',
    message:
      'Hardcoded JSX `placeholder` attribute. Wrap with `t(\'namespace:key\')` from useTranslation.',
  },
  {
    selector:
      'JSXAttribute[name.name="aria-label"] > Literal[value=/^[A-Za-zÁ-Úá-ú][A-Za-zÁ-Úá-ú0-9 ,.!?\'""-]*[a-zA-Z]$/]',
    message:
      'Hardcoded JSX `aria-label` attribute. Wrap with `t(\'namespace:key\')` from useTranslation.',
  },
];

export default tseslint.config(
  { ignores: ['dist', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // i18n guard: only applies to production source (tests and i18n locale
    // files are allowed to use literal strings).
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/**/*.test.{ts,tsx}',
      'src/**/__tests__/**',
      'src/test/**',
      'src/i18n/**',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...NO_LITERAL_JSX_ATTRS],
    },
  }
);
