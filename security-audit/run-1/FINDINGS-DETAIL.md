# Findings Detail

> Only findings rated MEDIUM+ require full detail per the methodology. The single finding
> here is LOW; detail is included anyway because it is the only finding and the data flow
> is worth documenting for the fix.

## LOW-1 — Inconsistent output encoding in leaderboard render

### Data flow (input → sink)
1. **Entry / source** — `loadRank` (`main.js:628-629`)
   ```js
   function loadRank() {
     try { return JSON.parse(localStorage.getItem(RANK_KEY)) || []; }
     catch { return []; }
   }
   ```
   `RANK_KEY = 'gomoku3d-rank'` (`main.js:626`). Every field of every entry is attacker-controlled if the key is writable.

2. **Propagation** — `renderRank` (`main.js:656-664`) maps entries into an HTML string:
   ```js
   el.innerHTML = list.map((r, i) => `
     <div class="rank-item">
       <span class="no">${i + 1}</span>
       <span class="who">${escapeHtml(r.name)}（${r.side}棋）</span>   // r.side UNescaped
       ${r.sig && r.sig.length ? sigSvg(r.sig) : '<span></span>'}       // r.sig UNescaped
       <span class="meta">${r.vsAI ? '勝過電腦' : '雙人對戰'} · ${r.moves} 手 · ${fmtDur(r.ms)} · ${r.date}</span>
     </div>`).join('');                                                  // r.moves, r.date UNescaped
   ```
   - `r.name` → `escapeHtml` (safe).
   - `r.vsAI` → ternary → fixed string (safe).
   - `r.ms` → `fmtDur` → coerced through `Math.round` (safe; non-numeric becomes `"NaN 秒"`).
   - `r.side`, `r.moves`, `r.date` → interpolated raw (**unsafe**).
   - `r.sig` → `sigSvg` (**unsafe**, see below).

3. **Sink A (element injection)** — `rank-list.innerHTML =` (`main.js:656`). A `r.side` of
   `"><img src=x onerror=…>` is in text position inside `<span class="who">`, so the `<img>`
   parses as an element and its `onerror` fires on render.

4. **Sink B (attribute breakout)** — `sigSvg` (`main.js:641-646`):
   ```js
   .map((s) => `<polyline points="${s.map((p) => p.join(',')).join(' ')}" .../>`)
   ```
   Each point `p` is `.join(',')`-ed straight into the `points="…"` attribute. A crafted
   point string containing `"/>` closes the attribute and the `<polyline>`, then injects markup.

### Concrete reproduction
Precondition: attacker can set `localStorage['gomoku3d-rank']` on the `tonnychiulab.github.io`
origin (via a sibling `*.github.io` project, or local DevTools).

Payload (element-injection via `side`):
```js
localStorage.setItem('gomoku3d-rank', JSON.stringify([{
  name: "x", side: '"><img src=x onerror=alert(document.domain)>',
  vsAI: false, moves: 1, ms: 1000, date: "2026/1/1", sig: []
}]));
```
Then open `https://tonnychiulab.github.io/555/` and click **排行榜**. `renderRank` runs and
the `onerror` executes → `alert('tonnychiulab.github.io')`.

Payload (attribute-breakout via `sig`):
```js
sig: [[ '"/><img src=x onerror=alert(1)>', '0' ], [ '0','0' ]]
```
renders `<polyline points=""/><img src=x onerror=alert(1)> 0,0" .../>`.

### What the attacker gets
Arbitrary JS in the origin context — read/write of the shared `*.github.io` `localStorage`
(affecting the user's other projects on that subdomain), page defacement, or redirect.
No credentials/session exist on this origin, so no account takeover. Impact = LOW.

### How the baseline handles it
Well-behaved static localStorage games treat stored data as untrusted on read and escape
*all* rendered fields (or render via `textContent`/DOM APIs instead of `innerHTML`). The
defect here is that only `name` got that treatment.

### Fix (drop-in)
`renderRank` — escape the sibling fields:
```js
<span class="who">${escapeHtml(r.name)}（${escapeHtml(r.side)}棋）</span>
...
<span class="meta">${r.vsAI ? '勝過電腦' : '雙人對戰'} · ${escapeHtml(String(r.moves))} 手 · ${fmtDur(r.ms)} · ${escapeHtml(String(r.date))}</span>
```
`sigSvg` — coerce points to numbers so only numeric data reaches the attribute:
```js
.map((s) => `<polyline points="${s.map((p) => p.map(Number).filter((n) => Number.isFinite(n)).join(',')).join(' ')}" fill="none" stroke="#1a2340" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
```
Neither change affects normal play (values produced on the write path are already numbers/
fixed strings, so escaping/coercion is a no-op for legitimate data).
