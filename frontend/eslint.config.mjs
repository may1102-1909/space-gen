import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    // Unit tests reach into Pascal's node union and three internals (e.g. `renderer.properties`)
    // to assert on fields the public types do not expose.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // Wrapper around the untyped @manycore/aholo-viewer SDK (declared without types).
    files: ['components/AholoViewer/AholoViewer.tsx', 'components/AholoViewer/AholoViewerTypes.ts', 'components/AholoViewer/AholoCameraControls.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'dist/**',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    // Vendored, pre-bundled worker output copied into public/.
    'public/**',
  ]),
]);
