import { defineConfig } from 'vite-plus'

const piPackages = ['@earendil-works/pi-coding-agent', '@earendil-works/pi-tui', '@earendil-works/pi-ai', '@earendil-works/pi-agent-core']

export default defineConfig({
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'import', 'promise'],
    categories: {
      correctness: 'error',
      suspicious: 'error',
      perf: 'error',
    },
    env: { es2024: true },
    rules: {
      // A leading `_` marks an event argument the handler does not use.
      'no-underscore-dangle': 'off',
      // A switch over a union returns in each case; the type checker proves
      // that, and switch-exhaustiveness-check keeps it true.
      'typescript/consistent-return': 'off',
      'typescript/switch-exhaustiveness-check': 'error',

      // Promises: an error must reach a handler, with its stack.
      'typescript/no-misused-promises': 'error',
      'typescript/return-await': 'error',
      'typescript/only-throw-error': 'error',
      'typescript/prefer-promise-reject-errors': 'error',
      'typescript/use-unknown-in-catch-callback-variable': 'error',

      // `any` must not travel: each use of an untyped value is a decision.
      'typescript/no-explicit-any': 'error',
      'typescript/no-unsafe-argument': 'error',
      'typescript/no-unsafe-assignment': 'error',
      'typescript/no-unsafe-call': 'error',
      'typescript/no-unsafe-member-access': 'error',
      'typescript/no-unsafe-return': 'error',

      // A deprecation in the pi types is a change to make before the API goes away.
      'typescript/no-deprecated': 'error',

      'typescript/no-unnecessary-condition': 'error',
      'typescript/strict-boolean-expressions': 'error',
      'typescript/restrict-plus-operands': 'error',
      eqeqeq: 'error',
      'import/no-cycle': 'error',
    },
    overrides: [
      {
        // A feature reads shared code, never another feature, so a feature
        // can be deleted with its directory.
        files: ['extensions/**'],
        rules: {
          'typescript/no-restricted-imports': [
            'error',
            {
              patterns: [
                { group: ['../*/**', '!../../**'], message: 'A feature does not import another feature; move the code to shared/.' },
              ],
            },
          ],
        },
      },
      {
        // Shared code does not depend on a feature.
        files: ['shared/**'],
        rules: {
          'typescript/no-restricted-imports': [
            'error',
            { patterns: [{ group: ['**/extensions/**'], message: 'Shared code does not import a feature.' }] },
          ],
        },
      },
      {
        // The core is pure: it reaches pi only through types.
        files: ['extensions/*/core.ts'],
        rules: {
          'typescript/no-restricted-imports': [
            'error',
            {
              patterns: [
                { group: ['../*/**', '!../../**'], message: 'A feature does not import another feature; move the code to shared/.' },
              ],
              paths: piPackages.map(name => ({
                name,
                message: 'The core does not call pi; import its types only.',
                allowTypeImports: true,
              })),
            },
          ],
        },
      },
      {
        // pi owns the terminal: console output breaks the TUI. Use ctx.ui.notify.
        files: ['extensions/**', 'shared/**'],
        rules: { 'no-console': 'error' },
      },
      {
        // A test builds pi inputs and fixtures by hand; the assertion is the
        // fixture's claim, and the test checks it.
        files: ['**/*.test.ts'],
        rules: {
          'typescript/no-unsafe-type-assertion': 'off',
          'typescript/no-explicit-any': 'off',
          'typescript/no-unsafe-assignment': 'off',
          'typescript/no-unsafe-member-access': 'off',
        },
      },
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    printWidth: 140,
    semi: false,
    singleQuote: true,
    arrowParens: 'avoid',
    trailingComma: 'all',
    sortImports: {
      groups: [
        ['builtin', 'external'],
        ['parent', 'sibling', 'index'],
      ],
    },
    sortPackageJson: false,
    ignorePatterns: ['pnpm-lock.yaml'],
  },
  test: {
    include: ['extensions/**/*.test.ts', 'shared/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
