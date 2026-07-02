# Architecture Summary — 3D 五子棋 (555)

## Application type
Pure client-side single-page web game. No backend, no build step, no dependencies.
Static files served by GitHub Pages at `https://tonnychiulab.github.io/555/`.

## Tech stack
- HTML + CSS + vanilla JS + inline SVG. Zero third-party libraries.
- Files: `index.html` (144 lines), `engine.js` (149, game rules/AI), `main.js` (810, SVG 3D render + UI + persistence), `style.css`.
- Persistence: `localStorage` only. Keys: `gomoku3d-intro-seen`, `gomoku3d-rank`.

## Trust model
- **No server, no auth, no authorization, no network I/O.** No `fetch`/`XHR`/WebSocket, no URL/query-param parsing, no `postMessage`, no cookies.
- All actors are "the local user" in their own browser. There is no cross-user data channel — the leaderboard is per-browser `localStorage`, not shared.
- The only externally-influenced data is what lives in `localStorage`. On GitHub Pages, **all repos under `tonnychiulab.github.io` share one origin**, so that `localStorage` is shared across every project the user hosts on that subdomain — this is the one non-trivial trust boundary.

## Input surfaces
1. `win-name` text input (`maxlength=12`) → stored in rank → rendered. **Escaped** via `escapeHtml` on render.
2. Signature pad pointer events → numeric stroke points → stored as `sig` → rendered as SVG `<polyline points>`.
3. `localStorage['gomoku3d-rank']` read by `loadRank` (`main.js:628`) → rendered by `renderRank` (`main.js:649`). This is the trust boundary that matters.
4. Pointer/wheel/keyboard events for camera + placement. Only feed numeric camera state and grid hit-testing; no injection sink.

## Dangerous sinks
- `innerHTML` assignments: `layers.*.innerHTML` (all numeric, from `toFixed` — safe), `rank-list.innerHTML` in `renderRank` (**mixes escaped + unescaped fields**), `sigPad.innerHTML` (in-memory numeric points — safe on the live path).
- No `eval`, `Function`, `document.write`, `setTimeout(string)`, dynamic import.

## Baseline comparable
Comparable to other static localStorage-backed browser games (2048, chess.js demos). Those accept that a user who edits their own `localStorage`/DevTools is out of scope; the relevant question is whether a *different* origin actor or a same-origin sibling can plant data that executes script — which is exactly the GitHub Pages shared-origin case.

## Prior runs
None (this is run-1). Coverage improves with additional runs; a second run is recommended to probe the animation/render math and engine edge cases this run treated as non-security.

## Starting points for hunting
- `renderRank` `main.js:649-665`, `sigSvg` `main.js:641-647`, `escapeHtml` `main.js:667-669`, `loadRank`/`saveRank` `main.js:628-634`, `btn-save` handler `main.js:722-740`.
