# Security Audit — 3D 五子棋 (555) · run-1

## Executive summary
This is a pure client-side static game with **no backend, no authentication, no network I/O, and no cross-user data channel**. The realistic attack surface is tiny. I found **no CRITICAL/HIGH/MEDIUM exploitable vulnerability**. There is **one LOW-severity output-encoding inconsistency**: the leaderboard renderer escapes the player `name` but interpolates the sibling fields (`side`, `date`, `moves`) and signature strokes into `innerHTML` unescaped. Because the app never produces malicious values on its own write path, exploiting this requires an attacker to plant a crafted `gomoku3d-rank` entry into `localStorage` — which on GitHub Pages is only reachable via the shared-origin `tonnychiulab.github.io` (a sibling project on the same subdomain) or local DevTools access. Given the origin holds no credentials, session, or sensitive data, real impact is limited. Overall the code is small, clean, and defensively written in the places that matter.

## Baseline
Comparable to other static, `localStorage`-backed browser games. The industry norm is that a user editing their own storage is out of scope; what matters is whether a *different* actor can plant executing content. Here the only such actor is a same-origin sibling on `*.github.io` — a real but conditional vector, not a default-exploitable one.

## Findings

| Severity | Title | Location |
|----------|-------|----------|
| LOW | Inconsistent HTML/attribute encoding in leaderboard render (stored-DOM XSS via attacker-influenced `localStorage`) | `main.js:649` `renderRank`, `main.js:641` `sigSvg` |

### LOW — Inconsistent output encoding in `renderRank` / `sigSvg`

**Location:** `main.js:649-665` (`renderRank`), `main.js:641-647` (`sigSvg`), source at `main.js:628-629` (`loadRank`).

**What's wrong.** `renderRank` builds `rank-list.innerHTML` from rank entries. `r.name` is correctly passed through `escapeHtml` (`main.js:660`), but the same template interpolates `r.side` (`main.js:660`), `r.moves` and `r.date` (`main.js:662`) with no escaping, and passes `r.sig` to `sigSvg`, which writes stroke points straight into a `<polyline points="…">` attribute (`main.js:644`) without escaping or numeric coercion. The developer clearly intended these to be render-safe (numbers / fixed strings), but nothing enforces that on read.

**Concrete attack.** The rank entries come from `JSON.parse(localStorage.getItem('gomoku3d-rank'))` (`main.js:629`). If an attacker can write that key, they control every field:
- Text-position injection via `side`: a value like `"><img src=x onerror=alert(document.domain)>` renders an `<img>` whose `onerror` runs when the rank modal opens.
- Attribute-breakout via `sig`: a stroke point whose string contains `"/>` closes the `points` attribute and the `<polyline>`, then injects arbitrary markup.

The write vector is the constraint: the app never generates these payloads itself, so this is not exploitable by normal play. It becomes reachable when another page on the **same origin** sets the key — i.e. any other project hosted under `tonnychiulab.github.io` (GitHub Pages gives every repo the same origin and thus shared `localStorage`), or a local actor with DevTools.

**Impact.** Arbitrary JS in the `tonnychiulab.github.io` origin context. That origin has no cookies/session/credentials for this app, so the primary consequence is same-origin pivoting: reading or rewriting the shared `localStorage` of the user's *other* github.io projects, or defacing/redirecting the page. Limited, hence LOW.

**Fix.** Escape every interpolated field, not just `name`, and coerce signature points to numbers:
- In `renderRank`, wrap `r.side`, `r.date`, and `r.moves` with `escapeHtml(...)` (they're already stringifiable).
- In `sigSvg`, map each coordinate through `Number(...)` (dropping `NaN`) before building the `points` string, so only numeric data can reach the attribute.

See `FINDINGS-DETAIL.md` for the full data flow and drop-in code.

## Hardening notes (defense-in-depth, not findings)
- **Shared-origin `localStorage` on GitHub Pages.** All of this user's `*.github.io` projects share one `localStorage`. Consider namespacing keys (already partly done via the `gomoku3d-` prefix) and, more importantly, treating any data read back from storage as untrusted — the fix above does exactly that. A custom domain (one project per origin) would eliminate the shared-origin class entirely.
- **`window.__g3d` test hook** (`main.js:798-809`) exposes internal game state and functions globally. Harmless (client-only, no privilege), but you may want to strip it from the production build.
- **Content-Security-Policy.** A static `<meta http-equiv="Content-Security-Policy">` with `script-src 'self'` (no inline scripts — the app already uses external `engine.js`/`main.js`) would neutralize injected `<img onerror>`/inline handlers as a second layer.

## Positive patterns (what the code does well)
- `escapeHtml` (`main.js:667`) is a correct, complete entity encoder and is applied to the one genuinely free-text field a user controls.
- All `localStorage` access is wrapped in `try/catch` (`loadRank`/`saveRank`/intro), so corrupt or blocked storage degrades gracefully instead of throwing.
- The engine validates every move (`inBoard` + occupancy + `winner` guards in `place`, `engine.js:24-38`); no way to place out of bounds or on an occupied cell.
- No `eval`/`Function`/`document.write`, no network calls, no URL/`postMessage` input — the classic web sinks simply aren't present.
- The heavy `innerHTML` render paths (board/stones/fx) build strings purely from computed numbers via `toFixed`, so they carry no injection risk.

## Coverage note
This is run-1 and the audit was performed by full manual read of the whole codebase (1103 lines) rather than fan-out agents, which the size made unnecessary. A single run finds roughly half of what multiple runs would; a second run focusing on the render/animation math and engine edge cases (as reliability rather than security) is recommended if you want deeper coverage.
