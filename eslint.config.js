import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist', 'dist-electron', 'release', 'node_modules', 'build', 'scripts/**/*.mjs'],
  },

  // Electron main / preload run in Node; everything else is bundled for the browser.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts', 'vite.web.config.ts', 'vitest.config.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Unused vars: allow `_`-prefixed, and tolerate the JSX-runtime `React`
      // namespace import that tsc's noUnusedLocals also flags.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          // `React` is exempt on purpose: with the automatic JSX runtime it is
          // imported only for React.ReactNode / React.Component type positions,
          // which are erased at build time and read as "unused" to a linter.
          varsIgnorePattern: '^(_|React$)',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // The JSX runtime is automatic (`jsx: react-jsx`); the React import is required
      // for React.ReactNode-style type annotations, so it is never genuinely unused.
      'no-unused-vars': 'off',

      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // Style is owned by Prettier; keep ESLint out of formatting decisions.
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off',

      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // React Fast Refresh boundaries only make sense for renderer code.
  {
    files: ['electron/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },

  // Tests allow non-null assertions and looser typing.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
