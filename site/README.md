# site/

The project landing page. Static files, no build step, deployed to GitHub Pages by
`.github/workflows/pages.yml` on any push to `main` under `site/`.

- `index.html` — the page
- `privacy.html`, `terms.html` — linked from the footer, share `legal.css`
- `404.html` — served by Pages for unknown paths
- `favicon.svg`

- `img/` — screenshots captured from the real app by `scripts/site-screenshots.ts`
  (`bun run build && bun scripts/site-screenshots.ts`; set `ROADMAP_PNG` to re-encode the roadmap graphic)

## Note for agents working here

The page carries **no testimonials**: the project has no outside users yet, and invented quotes were
removed in the 2.0 refresh. Don't add any until real ones exist. Proof on the page is real screenshots
and checkable facts (test count, licence). Keep the test count in the hero current when you touch it.
