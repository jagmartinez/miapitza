import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'public/sw.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
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
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-case-declarations': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    // Guardas del design system (Plan 01): en `warn` hasta que el Plan 05 las suba a error.
    // La lista de archivos pendientes vive en src/ui/legacy-allowlist.json.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/**'],
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          paths: [
            {
              name: 'react-select',
              message: 'Usa AppSelect de @/ui en lugar de importar react-select directamente.',
            },
          ],
          patterns: [
            {
              group: ['react-select/*'],
              message: 'Usa AppSelect de @/ui en lugar de importar react-select directamente.',
            },
            {
              group: ['**/components/Modal', '**/components/Sidebar', '**/components/CatalogTable'],
              message: 'Componentes heredados: usa FullScreenModal, Drawer o DataTable de @/ui en archivos nuevos.',
            },
          ],
        },
      ],
    },
  },
  {
    // Context modules intentionally colocate their provider and consumer hook.
    // They are application singletons, not leaf components eligible for HMR
    // replacement in isolation.
    files: [
      'src/context/ConfirmContext.tsx',
      'src/context/ToastContext.tsx',
      'src/hooks/useConfirm.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  }
);
