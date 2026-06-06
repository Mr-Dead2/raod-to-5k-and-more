# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file React app: a 4-week "Road to 5K" running training tracker
(`road-to-5k.jsx`). The entire app — data, styling, and logic — lives in that
one file's default-exported `App` component. There is no `package.json`, build
tooling, test suite, or linter config in the repo; the file is an artifact meant
to run inside a host environment that supplies React and a `window.storage` API.

## Build / run / test

There are no project-level commands (no `package.json`, no `npm`/`yarn`
scripts, no test runner). Do not invent build or test commands. To preview
changes, run the JSX through a React-capable host/sandbox that polyfills
`window.storage` (see Persistence below).

## Architecture

- **Plan data is static, declared at module top.** `WEEKS` is the source of
  truth: an array of 4 week objects, each with 7 `days` (`MON`–`SUN`). Each day
  has `type` (`run` | `easy` | `rest`), `title`, `detail`, and target `km`.
  Editing the training plan means editing `WEEKS`, nothing else.
- **`FLAT` / `TOTAL` derive from `WEEKS`.** `FLAT` flattens every day into a
  list, assigning each a stable `key` of the form `` `w${week}d${dayIndex}` ``.
  This key is the join between static plan data and user progress. Any code that
  reads or writes a day's logged state must use this exact key format.
- **User progress lives in one `log` state object**, keyed by the same
  `w{n}d{i}` keys. Each entry is a partial record: `{ done, km, min, stitch,
  note }`. `update(key, patch)` shallow-merges a patch and persists; there is no
  per-field state. `stats` (a `useMemo` over `log`) recomputes km logged, days
  done, runs, side-stitch count, and best streak on every change.
- **Two tabs (`plan` | `stats`)** switch the main view. `plan` renders the
  per-week day rows (expandable to log km/time/stitch/note) plus a "Next Up"
  card derived from the first not-`done` day in `FLAT`. `stats` shows the stat
  cards and a stopwatch.
- **Stopwatch** uses `setInterval` driven by an effect on `swRun`, computing
  elapsed time from a captured `Date.now()` start rather than accumulating ticks.

## Persistence (`window.storage`)

State is loaded once on mount and written on every change, both through the
host-provided async `window.storage` API under the key **`run5k:v2`**, with the
value JSON-stringified. All access is wrapped in try/catch and fails silently.
If you change the persisted shape, bump the key suffix (e.g. `run5k:v3`) so old
data doesn't deserialize into the new format.

## Styling conventions

- All styling is inline `style={{}}` objects plus one `<style>` block for
  fonts, keyframes, and a few utility classes (`.syne`, `.num`, `.row`,
  `.glow`, `.rise`, `.inp`, `.chip`). There is no CSS file or framework.
- **The `C` object is the entire color palette.** Use these tokens (`C.bg`,
  `C.accent`, `C.run`, `C.easy`, `C.rest`, etc.) instead of hardcoding hex
  values. `typeColor(type)` maps a day's `type` to its accent color and is used
  for borders, checkboxes, and labels.
- Fonts: `Syne` (headings/numbers, via `.syne` / `.num`) and `Manrope` (body),
  imported from Google Fonts inside the `<style>` block.
