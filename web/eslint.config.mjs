// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  {
    rules: {
      // Boyscout rule (CLAUDE.md): always wrap statements in braces, never a one-line `if`. Clean as of
      // 2026-07-31 (eslint --fix handled all 351 pre-existing violations) - kept at 'error'.
      curly: ['error', 'all'],
      // Prefer arrow functions in every context (CLAUDE.md). ~319 pre-existing `function` declarations
      // across the codebase (not eslint --fix-able - most are recursive/hoisted call sites that need a
      // manual per-site rewrite). Kept at 'warn' until that conversion pass (docs audit #33) lands, then
      // promote to 'error'.
      'func-style': ['warn', 'expression'],
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
)
