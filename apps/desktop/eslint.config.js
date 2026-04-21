import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.vite/', 'out/', 'dist/', 'node_modules/', '*.config.js', '*.config.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // ENG-006 — the Electron main process imports the pino logger via
    // @puntovivo/server (createModuleLogger). Every diagnostic must flow
    // through it so operators get structured JSON and PII redaction.
    // Scoped to src/main/** only; the preload (sandboxed) and renderer-
    // bundled code are not touched by ENG-006.
    files: ['src/main/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  }
);
