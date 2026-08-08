// eslint.config.mjs — Flat config (ESLint 9+)
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['node_modules', 'dist', 'coverage', 'uploads', 'prisma/migrations'],
  },
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Correctness rules (blocking)
      // NOTE: no-unused-vars is set to 'warn' (non-blocking) initially because the
      // pre-existing codebase has ~20 unused-variable instances. Per the production
      // safety spec (§9), warnings may remain non-blocking initially, and (§2) we
      // do NOT perform unrelated refactors during pipeline implementation.
      // These pre-existing issues are tracked in docs/ci-cd-audit.md §7 (Risks) and
      // should be fixed in a separate, dedicated cleanup PR.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  prettier,
];
