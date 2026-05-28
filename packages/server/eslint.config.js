import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', '**/*.test.ts', '__tests__'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_|^err' }],
      // ENG-179c — promoted warn -> error. Any remaining explicit `any`
      // must carry a documented `eslint-disable-next-line ... -- reason:`
      // (seeds + the outbox kernel Drizzle-boundary casts are the only
      // exemptions, each annotated with why).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'prefer-const': 'warn',
      // ENG-006 — every diagnostic must flow through the pino logger
      // (`createModuleLogger(...)`). Tests keep using console via the
      // existing `__tests__` / `*.test.ts` ignore at the top of this
      // file. No allow list — even console.warn and console.error need
      // a logger instead.
      'no-console': 'error',
    },
  }
);
