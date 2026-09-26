// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    rules: {
      // Boyscout rule (CLAUDE.md): always wrap statements in braces, never a one-line `if`. Clean as of
      // 2026-07-31 (eslint --fix handled all 351 pre-existing violations) - kept at 'error'.
      curly: ['error', 'all'],
      // Prefer arrow functions in every context (CLAUDE.md). Every function declaration has been converted; a new
      // one is an error. Mind hoisting: define an arrow before the first eager use of it.
      'func-style': ['error', 'expression'],
      // ~213 pre-existing `any` casts (docs audit #36 tracks typing them properly). 'warn' matches the
      // audit's own suggested severity - not meant to ever become a hard error given how often `any` is
      // legitimately needed at DB/API boundaries.
      '@typescript-eslint/no-explicit-any': 'warn',
      'vue/comment-directive': 'error',
      // CLAUDE.md explicitly prefers ternaries over if/else, including ternaries used purely for their
      // side effects (both branches are statements, not a value) - the default rule treats those as
      // likely mistakes, but here they're the house style.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // Every control-char regex in this codebase is intentional (ANSI escape stripping, filename
      // sanitization against \x00-\x1f) - the rule exists to catch accidental copy-paste artifacts.
      'no-control-regex': 'off',
      // Multi-root templates are valid, idiomatic Vue 3 (this is a Vue 2 compat rule) - several pages
      // deliberately use a sibling <Teleport>/<Dialog> alongside the main root.
      'vue/no-multiple-template-root': 'off',
      // Vue stylistic rules from @nuxt/eslint's recommended preset - not part of CLAUDE.md's explicit
      // standards, so kept advisory (warn) rather than blocking unrelated commits on pre-existing style.
      '@typescript-eslint/no-unused-vars': 'warn',
      'vue/attributes-order': 'warn',
      'vue/html-self-closing': 'warn',
      'vue/require-default-prop': 'warn',
      'vue/multi-word-component-names': 'warn',
    },
  },
  {
    // Prisma `include` selects EVERY scalar of the model and of each included relation. On this schema that means
    // LocalReleaseTrack.metadata (~3.3 KB of JSON per track), LocalRelease.folderPath/statusReason/groupKey...
    // for rows a list only shows a title and a cover from. Use an explicit `select` (see
    // server/utils/releaseTiles.ts). Warn, not error: a handful of small-table uses remain and are converted as
    // they are touched; where `include` is genuinely right, disable the line with a reason.
    files: ['server/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['warn', {
        selector: "Property[key.name='include']",
        message: 'Use an explicit `select` instead of `include` - include pulls every column (incl. large JSON) of every included row.',
      }],
    },
  },
)

