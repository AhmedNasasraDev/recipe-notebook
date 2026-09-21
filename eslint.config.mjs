// ESLint, flat config, for the whole workspace.
//
// Named `.mjs` rather than `.js`: the root package has no `"type": "module"`,
// and adding one to satisfy a lint config would change how every other tool in
// the repo resolves plain `.js` files.
//
// WHAT THIS IS FOR, AND WHAT IT IS NOT FOR
//
// `tsc --noEmit` already covers types, and 1031 tests cover behaviour. What
// neither of them can see is the class of mistake that type-checks and passes:
// a `useEffect` with a stale dependency list, a promise nobody awaited, a
// `switch` that falls through, an unused import that outlives a refactor. That
// is what is enabled below, and nothing else — a rule that only argues about
// formatting would cost a diff on every file and catch no defect.
//
// The type-aware rules are on, which is the expensive half and the useful one:
// `no-floating-promises` and `no-misused-promises` need the type checker, and
// this codebase is full of `void save(...)` calls whose correctness depends on
// exactly that distinction being deliberate.
//
// Test files get a slightly looser rule set, spelled out at the bottom rather
// than hidden in a preset: a test may legitimately assert on a non-null
// assertion, and its fixtures are cast from literals on purpose.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // Build output, dependencies, and the untouchable prototype. The handoff
    // says the design app is the reference and must not be rewritten, so it is
    // not linted either — a lint error there would invite an edit.
    ignores: [
      '**/dist/**',
      '**/dist-demo/**',
      '**/node_modules/**',
      'design_handoff_recipe_notebook/**',
      '.e2e-shots/**',
      /*
        The AUDIT VIEWER (see artifact/README.md). It is not product code, it
        is in no tsconfig, and the type-aware rules cannot parse a file the
        project service has no program for — without this line `npm run lint`
        fails with three parsing errors that say nothing about the product.
        This is the ONE tracked file the audit task touched, and reverting it
        is deleting these four lines.
      */
      'artifact/**',

      /*
        The Edge Function. Deno, not Node: it imports from `jsr:` URLs, uses
        the `Deno` global, and is in no tsconfig's `include` — so the project
        service has no program for it and the type-aware rules would fail to
        parse it rather than check it. It is deployed by the Supabase CLI,
        which type-checks it with Deno's own checker.
      */
      'supabase/functions/**',

      /*
        The FIGMA BUILD SCRIPTS (see figma/README.md). They run inside Figma's
        plugin sandbox against the `figma` global, with top-level await and no
        module system — the type-aware rules have no program for them and would
        report the environment rather than the code. They have their own
        checker: `npm run figma:check`.
      */
      'figma/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parserOptions: {
        projectService: {
          // `vitest.config.ts` and the two `.mts` round-trip scripts are run by
          // tooling and are in no tsconfig's `include`, so the project service
          // has no program for them. Linting them with the default project is
          // better than the alternative the first run produced: a hard parse
          // error that stopped the whole run.
          allowDefaultProject: [
            '*.mjs',
            'vitest.config.ts',
            '*/*/vitest.config.ts',
            'supabase/scripts/*.mts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Raised from the plugin's default `warn`. A dependency list that does
      // not match what the callback reads is a STALE VALUE on screen, which is
      // the whole reason this plugin is here — the first run found exactly one,
      // and it was a real one: the recipe page recomputed its baseline when a
      // price changed and left the costs it displays on the old price.
      'react-hooks/exhaustive-deps': 'error',

      // An unused import or variable is dead code, and dead code is the residue
      // of a refactor that was not finished. `_` prefixed is the escape hatch
      // for a signature that must keep a parameter it does not use.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // The two that need types, and the reason the type-aware config is on.
      // A dropped promise in a save path is exactly the "it said it saved"
      // defect this project keeps hunting.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // `any` is a hole in every guarantee the types make. It is an error in
      // app code; the test override below relaxes only what a fixture needs.
      '@typescript-eslint/no-explicit-any': 'error',

      // Non-null assertion is a claim the compiler cannot check. Allowed, but
      // visible, so it is a decision rather than a habit.
      '@typescript-eslint/no-non-null-assertion': 'warn',

      /*
        TURNED OFF DELIBERATELY, and this is the list of what this config is
        NOT for. Each of these fired in the hundreds on the first run and not
        one of them pointed at a defect:

        · `no-unnecessary-type-assertion` (163) — mostly `arr[0]!` in tests.
          With `noUncheckedIndexedAccess` the assertion is what makes the
          reader's intent visible even where a permissive parameter makes it
          redundant to the compiler. Removing all 163 is a diff across every
          test file that catches nothing.
        · `require-await` (72) — an `async () => [...rows]` in a repository
          double is correct: the interface returns a Promise, and the double
          has nothing to await. The rule is arguing with the design.
        · `unbound-method` (50) — `expect(obj.method)` in tests.
        · `no-base-to-string` (25) — all in test fixtures interpolating ids.
      */
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-base-to-string': 'off',

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-fallthrough': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    // Tests and test doubles. A fixture is written as a literal and cast into
    // the domain type on purpose — that is how a test says "this row came from
    // a database that does not care about my interfaces".
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/test/**',
      '**/e2e/**',
      'supabase/scripts/**',
    ],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      // A fixture is a database row written by hand; `any` is how it says so.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      'no-console': 'off',
    },
  },

  {
    // The browser E2E scripts and the Node-side tooling are plain JS modules
    // run by node, outside any tsconfig — so the type-aware rules have no
    // program to consult and must be switched off for them. The rule sets are
    // MERGED rather than replaced: a bare `rules: {...}` after the spread would
    // overwrite the whole set that `disableTypeChecked` just turned off, which
    // is how the first run of this config died on `await-thenable`.
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-console': 'off',
    },
  },
);
