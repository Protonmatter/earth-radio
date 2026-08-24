// Static analysis for the maintained code surface. The recovered/minified runtime
// bundles and the evidence-only source snapshot are intentionally out of scope.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      '.build/**',
      '.recovery/**',
      'release/**',
      'playwright-report/**',
      'test-results/**',
      'evidence/**',
      // Recovered, content-hashed runtime bundles: immutable except for recorded
      // hardening overlays; never a lint target.
      'site/assets/index-*.js',
      'site/assets/hls.light-*.js',
      // Evidence-only source snapshot (TypeScript, no toolchain in this repo).
      'src-recovered/**'
    ]
  },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-unreachable': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unused-private-class-members': 'error',
      'require-atomic-updates': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Sanitizers strip C0 control characters by design.
      'no-control-regex': 'off'
    }
  },
  {
    files: ['server/**/*.mjs', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'electron/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } }
  },
  {
    // Playwright specs execute snippets in the page via evaluate/waitForFunction.
    files: ['tests/e2e/**/*.mjs', 'tests/browser/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } }
  },
  {
    files: ['site/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } }
  },
  {
    files: ['site/sw.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.serviceworker } }
  }
];
