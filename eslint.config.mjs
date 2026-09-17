import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // mockup/ holds exported Claude Design files (gitignored), not project source.
  { ignores: ['**/dist/**', '**/out/**', '**/coverage/**', '**/node_modules/**', 'mockup/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
