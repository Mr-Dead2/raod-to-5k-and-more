# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An installable **PWA** (Progressive Web App): a 4-week "Road to 5K" running
tracker built with **React + Vite** and `vite-plugin-pwa`. It runs in the
browser, installs to a phone home screen, works offline, and can show reminder
notifications. It started life as a single Claude-artifact JSX file; that has
been migrated into the `src/` project (original is in git history).

## Commands

- `npm install` — install dependencies (Node 20+).
- `npm run dev` — Vite dev server with the PWA/service worker enabled.
- `npm run build` — production build into `dist/` (also builds the service worker
  and precache manifest).
- `npm run preview` — serve the built `dist/` locally (uses the GitHub Pages base
  path `/raod-to-5k-and-more/`, so open that path).
- `npm run icons` — regenerate PWA PNG icons from the inline SVG in
  `scripts/gen-icons.mjs` (requires `sharp`). Re-run after changing the icon.

There is no test suite or linter configured.

## Deployment

`vite.config.js` defaults `base` to `/` (the root), which is what Cloudflare,
Netlify, Vercel and local preview all serve from. Override with the `BASE_PATH`
env var for sub-path hosts.

- **Cloudflare (primary)** — `@cloudflare/vite-plugin` + `wrangler.jsonc` are
  wired in. `npm run build` emits a deployable bundle (incl. `dist/wrangler.json`)
  and `npm run deploy` runs `vite build && wrangler deploy`. Connecting the repo
  in the Cloudflare dashboard auto-redeploys on push. `wrangler.jsonc` uses
  `assets.not_found_handling: single-page-application`.
- **Netlify / Vercel** — `netlify.toml` / `vercel.json` build with `npm run build`
  and publish `dist`; base `/` is already correct.
- **GitHub Pages** — `.github/workflows/main.yml` deploys on push to `main`, and
  **must** pass `BASE_PATH: /raod-to-5k-and-more/` to `npm run build` (it does),
  since Pages serves under `/<repo-name>/`. Requires a paid plan for private repos.

## Architecture

- **`src/data.js` — the plan + theme, single source of truth.** `WEEKS` (4 weeks
  × 7 days) defines the whole training plan; edit a day here and the rows, "next
  up", stats, charts, and history all follow. `FLAT` flattens days and assigns
  each a stable `key` of the form `` `w${week}d${index}` `` — this key joins the
  static plan to user progress, so any progress read/write must use that exact
  format. `C` is the entire color palette; use its tokens (`C.accent`, `C.run`,
  `C.easy`, `C.rest`, …) and `typeColor(type)` instead of hardcoding hex.
- **`src/App.jsx` — one stateful component, three tabs (`plan | stats |
  history`).** All user progress lives in a single `log` object keyed by the
  `w{n}d{i}` keys; each entry is a partial `{ done, km, min, stitch, note, date
  }`. `update(key, patch)` shallow-merges and persists; it stamps `date` the
  first time a day is marked done (history/charts depend on this). `stats`,
  `weekly`, `history`, and `cumulative` are all `useMemo`s derived from `log`.
- **Persistence is split by access pattern.** Run progress → `localStorage`
  (`src/storage.js`, key `run5k:v2`). Reminder settings → **IndexedDB**
  (`src/idb.js`, a tiny dependency-free KV store) because the service worker
  cannot read `localStorage` and needs the reminder while the app is closed. Bump
  the storage key/version suffix if you change a stored shape incompatibly.
- **Notifications (`src/notifications.js` + `src/sw.js`).** No backend/push
  server. Three layers, best-effort: (1) Notification permission + the SW to show
  notices; (2) Periodic Background Sync — Chrome wakes the SW ~twice a day, which
  reads the reminder from IndexedDB and fires if due; (3) a foreground timer that
  fires if the app is open at reminder time. `lastFired` (a YYYY-MM-DD string)
  guards against firing more than once per day. The app keeps a precomputed
  `message` (today's session text) in IndexedDB so the SW doesn't need to know
  the plan. Be honest in any UX: the web cannot guarantee an exact alarm when
  fully closed.
- **Charts (`src/components/Charts.jsx`)** are hand-rolled inline SVG (no chart
  lib): `WeeklyBars` (logged vs plan target per week) and `CumulativeArea`
  (running distance total). They are purely presentational — App computes the
  arrays.

## Styling conventions

- All styling is inline `style={{}}` objects plus one `<style>` block in
  `App.jsx` for fonts, keyframes, and utility classes (`.syne`, `.num`, `.row`,
  `.glow`, `.rise`, `.inp`, `.chip`, `.sw`). No CSS file or framework.
- Fonts: `Syne` (headings/numbers via `.syne`/`.num`) and `Manrope` (body), from
  Google Fonts in the `<style>` block. Safe-area insets are handled via
  `env(safe-area-inset-*)` for notched phones.
