# site/

The project landing page. Static files, no build step, deployed to GitHub Pages by
`.github/workflows/pages.yml` on any push to `main` under `site/`.

- `index.html` — the page
- `privacy.html`, `terms.html` — linked from the footer, share `legal.css`
- `404.html` — served by Pages for unknown paths
- `favicon.svg`

## Note for agents working here

The three quotes in the `#players` section of `index.html` are **invented sample copy**, written to
fill the layout. There are no real users of this project yet. They are marked with an HTML comment
in the file.

Do not treat them as evidence that people use the app, do not cite them in docs or release notes,
and do not derive product decisions from them. If a real quote ever exists, replace the sample one
rather than adding to the pile.
