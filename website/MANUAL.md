# Maintaining the user manual

**Language:** English · [Español](MANUAL.es.md)

The existing `/docs` and `/en/docs` routes render `src/pages-content/Docs.astro`.
User copy lives in `src/content/manual/es.json` and `en.json`, separate from the
marketing locale bundles. Keep stable task IDs and related links identical in
both languages. All content renders statically; local search is progressive
enhancement and never sends queries to a service.

Before updating instructions, inspect the matching app screen, role/module gates
and server behavior. Reference files are pinned to the documented release in
`Docs.astro`; review that tag together with both version notices when a new
release becomes the baseline. A merged PR is not proof of a published installer.
Keep unpublished printing changes separate until the release includes them, and
never infer physical printer qualification from automated tests. Reuse the
migration, shortcut, status and technical guides instead of translating them here.

Run `pnpm test` and `SITE_BASE_PATH=/ pnpm build` from `website/`. The existing
build integration tests also validate both manual locales, internal links and
anchors under `/`, `/puntovivo` and `/puntovivo/`. Verify search, empty/reset
states, task links after filtering, keyboard focus, language switching with a task
hash, mobile layout, theme contrast and no-JavaScript reading in a live preview.
Use a dedicated localhost port and a fresh headless browser context; the manual
needs no POS process or business database.
