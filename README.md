# ZeppOS_editor_statistics
A website for displaying usage statistics for the watch face editor on ZeppOS

Static site for GitHub Pages — no build step. Data is loaded from the Supabase
`public-device-stats` function on every page load.

- `config.js` — API URL and Supabase publishable key (set `publishableKey` to your key).
- `index.html`, `assets/` — page, styles, translations (EN / RU / UK) and logic.
- Open with `?demo` to render `data/example.json` instead of the live API.

Local preview: `python -m http.server 8765`, then open http://localhost:8765/?demo

Deploy: Settings → Pages → Deploy from a branch → `main` / root.
