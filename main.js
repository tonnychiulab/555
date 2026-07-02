/* 3D 五子棋：SVG 透視渲染 + 第一人稱視角 + UI */
(function () {
  'use strict';
  const E = GomokuEngine;
  const SIZE = E.SIZE, HALF = (SIZE - 1) / 2;
  const BOARD_HALF = HALF + 1;          // 棋盤板面半寬
  const SLAB_H = 0.6;                   // 棋盤厚度
  const STONE_R = 0.42, STONE_H = 0.24; // 棋子半徑 / 球心高度

  const svg = document.getElementById('scene');
  const layers = {
    bg: document.getElementById('layer-bg'),
    board: document.getElementById('layer-board'),
    stones: document.getElementById('layer-stones'),
    fx: document.getElementById('layer-fx'),
  };
  const statusEl = document.getElementById('status');

  /* ---------- 相機（第一人稱：坐在棋桌旁環顧） ---------- */
  const cam = { yaw: 0, pitch: 0.52, dist: 13.5 };
  let W = 0, H = 0, F = 0, CX = 0, CY = 0;

  function resize() {
    W = svg.clientWidth; H = svg.clientHeight;
    F = Math.min(W, H) * 0.78;
    CX = W / 2; CY = H * 0.5;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    render();
  }

  let camPos, sy_, cy_, sp_, cp_;
  function updateCam() {
    sy_ = Math.sin(cam.yaw); cy_ = Math.cos(cam.yaw);
    sp_ = Math.sin(cam.pitch); cp_ = Math.cos(cam.pitch);
    camPos = {
      x: cam.dist * cp_ * sy_,
      y: cam.dist * sp_,
      z: cam.dist * cp_ * cy_,
    };
  }

  // 世界座標 → 螢幕座標；d 為深度
  function project(wx, wy, wz) {
    let x = wx - camPos.x, y = wy - camPos.y, z = wz - camPos.z;
    const x1 = x * cy_ - z * sy_;
    const z1 = x * sy_ + z * cy_;
    const y2 = y * cp_ - z1 * sp_;
    const z2 = y * sp_ + z1 * cp_;
    const d = -z2;
    if (d < 0.25) return null;
    return { x: CX + F * x1 / d, y: CY - F * y2 / d, d };
  }

  const gx2w = (g) => g - HALF; // 格點 → 世界

  /* ---------- 遊戲狀態 ---------- */
  let game = E.createGame();
  let mode = 'pvp';       // 'pvp' | 'ai'
  let humanSide = E.BLACK;
  let aiSide = E.WHITE;
  let busy = false;       // AI 思考中
  let aiTimer = null;
  let startTime = 0;
  let hoverCell = null;
  let recorded = false;   // 本局已寫入排行榜

  /* ---------- SVG 渲染 ---------- */
  let screenPts = [];

  function polyStr(pts) {
    return pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }

  function quad(corners, fill, extra = '') {
    const ps = corners.map((c) => project(c[0], c[1], c[2]));
    if (ps.some((p) => !p)) return '';
    return `<polygon points="${polyStr(ps)}" fill="${fill}" ${extra}/>`;
  }

  function render() {
    if (!W) return;
    updateCam();

    /* 背景：天空 + 地板（以地平線分界） */
    const horizon = Math.max(0, Math.min(H, CY - F * Math.tan(cam.pitch)));
    let bg = `<rect x="0" y="0" width="${W}" height="${horizon.toFixed(1)}" fill="url(#g-sky)"/>`;
    bg += `<rect x="0" y="${horizon.toFixed(1)}" width="${W}" height="${(H - horizon).toFixed(1)}" fill="url(#g-floor)"/>`;
    layers.bg.innerHTML = bg;

    /* 棋桌 + 棋盤實體 */
    let b = quad([[-13, -SLAB_H, -13], [13, -SLAB_H, -13], [13, -SLAB_H, 13], [-13, -SLAB_H, 13]], '#3d2b1a');
    const B = BOARD_HALF;
    const top = [[-B, 0, -B], [B, 0, -B], [B, 0, B], [-B, 0, B]];
    const sides = [];
    for (let i = 0; i < 4; i++) {
      const a = top[i], c = top[(i + 1) % 4];
      const mid = project((a[0] + c[0]) / 2, -SLAB_H / 2, (a[2] + c[2]) / 2);
      sides.push({
        d: mid ? mid.d : 1e9,
        corners: [a, c, [c[0], -SLAB_H, c[2]], [a[0], -SLAB_H, a[2]]],
      });
    }
    sides.sort((p, q) => q.d - p.d);
    for (const s of sides) b += quad(s.corners, '#8a5f28');
    b += quad(top, '#c9963f');

    /* 格線 */
    let lines = '';
    for (let i = 0; i < SIZE; i++) {
      const w = gx2w(i);
      const a1 = project(w, 0.015, -HALF), a2 = project(w, 0.015, HALF);
      const b1 = project(-HALF, 0.015, w), b2 = project(HALF, 0.015, w);
      if (a1 && a2) lines += `<line x1="${a1.x.toFixed(1)}" y1="${a1.y.toFixed(1)}" x2="${a2.x.toFixed(1)}" y2="${a2.y.toFixed(1)}"/>`;
      if (b1 && b2) lines += `<line x1="${b1.x.toFixed(1)}" y1="${b1.y.toFixed(1)}" x2="${b2.x.toFixed(1)}" y2="${b2.y.toFixed(1)}"/>`;
    }
    b += `<g stroke="#5a3d1a" stroke-width="1.1" opacity=".9">${lines}</g>`;

    /* 星位 */
    for (const [sx, sz] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      const p = project(gx2w(sx), 0.02, gx2w(sz));
      if (p) b += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(F * 0.09 / p.d).toFixed(1)}" fill="#5a3d1a"/>`;
    }
    layers.board.innerHTML = b;

    /* 交叉點投影快取（供點擊命中） */
    screenPts = [];
    for (let gy = 0; gy < SIZE; gy++) {
      const row = [];
      for (let gx = 0; gx < SIZE; gx++) row.push(project(gx2w(gx), 0, gx2w(gy)));
      screenPts.push(row);
    }

    /* 棋子（含陰影，遠到近排序） */
    const stones = [];
    for (let gy = 0; gy < SIZE; gy++) {
      for (let gx = 0; gx < SIZE; gx++) {
        const v = game.board[gy][gx];
        if (v) stones.push({ gx, gy, v });
      }
    }
    const squash = 0.42 + 0.58 * sp_;
    let sh = '', st = '';
    const items = stones
      .map((s) => {
        const c = project(gx2w(s.gx), STONE_H, gx2w(s.gy));
        return c ? { ...s, c } : null;
      })
      .filter(Boolean)
      .sort((a, b2) => b2.c.d - a.c.d);
    const last = game.moves[game.moves.length - 1];
    for (const s of items) {
      const rx = F * STONE_R / s.c.d, ry = rx * squash;
      const shp = project(gx2w(s.gx) + 0.08, 0.01, gx2w(s.gy) + 0.08);
      if (shp) sh += `<ellipse cx="${shp.x.toFixed(1)}" cy="${shp.y.toFixed(1)}" rx="${(rx * 1.02).toFixed(1)}" ry="${(rx * sp_ * 0.95).toFixed(1)}" fill="rgba(0,0,0,.28)"/>`;
      st += `<ellipse cx="${s.c.x.toFixed(1)}" cy="${s.c.y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="url(#g-${s.v === E.BLACK ? 'black' : 'white'})"/>`;
      if (last && last.x === s.gx && last.y === s.gy && !game.winner) {
        st += `<circle cx="${s.c.x.toFixed(1)}" cy="${(s.c.y - ry * 0.15).toFixed(1)}" r="${Math.max(2, rx * 0.18).toFixed(1)}" fill="#e5484d"/>`;
      }
    }

    /* 預覽棋子 */
    if (hoverCell && !game.winner && !busy && game.board[hoverCell.gy][hoverCell.gx] === E.EMPTY) {
      const c = project(gx2w(hoverCell.gx), STONE_H, gx2w(hoverCell.gy));
      if (c) {
        const rx = F * STONE_R / c.d;
        st += `<ellipse cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${(rx * squash).toFixed(1)}" fill="url(#g-${game.current === E.BLACK ? 'black' : 'white'})" opacity=".45"/>`;
      }
    }
    layers.stones.innerHTML = sh + st;

    /* 勝利連線特效 */
    let fx = '';
    if (game.winLine) {
      const pts = game.winLine
        .map((c) => project(gx2w(c.x), STONE_H + 0.05, gx2w(c.y)))
        .filter(Boolean);
      if (pts.length >= 2) {
        const ends = [...pts].sort((a, b2) => a.x - b2.x || a.y - b2.y);
        const p1 = ends[0], p2 = ends[ends.length - 1];
        fx += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="#ffd166" stroke-width="5" stroke-linecap="round" opacity=".85"/>`;
        for (const p of pts) fx += `<circle cx="${p.x}" cy="${p.y}" r="${(F * 0.5 / p.d).toFixed(1)}" fill="none" stroke="#ffd166" stroke-width="2.5"/>`;
      }
    }
    layers.fx.innerHTML = fx;
  }

  /* ---------- 命中測試 ---------- */
  function hitCell(px, py) {
    let best = null, bestD = Infinity;
    for (let gy = 0; gy < SIZE; gy++) {
      for (let gx = 0; gx < SIZE; gx++) {
        const p = screenPts[gy] && screenPts[gy][gx];
        if (!p) continue;
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < bestD) { bestD = d; best = { gx, gy, p }; }
      }
    }
    if (!best) return null;
    const nb = screenPts[best.gy][Math.min(SIZE - 1, best.gx + 1)] || screenPts[best.gy][best.gx - 1];
    const spacing = nb ? Math.hypot(nb.x - best.p.x, nb.y - best.p.y) : 24;
    return bestD <= Math.max(10, spacing * 0.55) ? { gx: best.gx, gy: best.gy } : null;
  }

  /* ---------- 遊戲流程 ---------- */
  function setStatus(t) { statusEl.textContent = t; }

  function turnText() {
    if (game.winner === -1) return '和局';
    if (game.winner) {
      const c = game.winner === E.BLACK ? '黑棋' : '白棋';
      if (mode === 'ai') return game.winner === aiSide ? `電腦（${c}）獲勝！` : `你（${c}）獲勝！`;
      return `${c}獲勝！`;
    }
    const c = game.current === E.BLACK ? '黑棋' : '白棋';
    if (mode === 'ai') return game.current === aiSide ? '電腦思考中…' : `你的回合（${c}）`;
    return `${c}回合`;
  }

  function afterMove() {
    render();
    setStatus(turnText());
    if (game.winner) {
      if (game.winner > 0 && !recorded) setTimeout(openWinModal, 900);
      return;
    }
    scheduleAI();
  }

  function scheduleAI() {
    if (mode !== 'ai' || game.winner || game.current !== aiSide) return;
    busy = true;
    setStatus('電腦思考中…');
    aiTimer = setTimeout(() => {
      aiTimer = null;
      const mv = E.aiMove(game);
      if (mv) E.place(game, mv.x, mv.y);
      busy = false;
      afterMove();
    }, 380);
  }

  function tryPlace(gx, gy) {
    if (busy || game.winner) return;
    if (mode === 'ai' && game.current === aiSide) return;
    if (E.place(game, gx, gy)) {
      hoverCell = null;
      afterMove();
    }
  }

  function doUndo() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; busy = false; }
    if (!game.moves.length) return;
    recorded = false;
    E.undo(game);
    if (mode === 'ai' && game.current === aiSide && game.moves.length) E.undo(game);
    closeModal('modal-win');
    afterMove();
  }

  function newGame() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
    busy = false;
    game = E.createGame();
    recorded = false;
    hoverCell = null;
    startTime = Date.now();
    closeModal('modal-win');
    afterMove();
  }

  /* ---------- 視角操作（拖曳/縮放/點擊） ---------- */
  const pointers = new Map();
  let dragging = false, tapStart = null, pinchDist = 0;

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      tapStart = { x: e.clientX, y: e.clientY };
      dragging = false;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      tapStart = null;
    }
  });

  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === 'mouse') {
        const c = hitCell(e.clientX - svg.getBoundingClientRect().left, e.clientY - svg.getBoundingClientRect().top);
        if ((c && (!hoverCell || c.gx !== hoverCell.gx || c.gy !== hoverCell.gy)) || (!c && hoverCell)) {
          hoverCell = c;
          render();
        }
      }
      return;
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const nd = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        cam.dist = Math.min(30, Math.max(6, cam.dist * pinchDist / nd));
        render();
      }
      pinchDist = nd;
      return;
    }
    if (tapStart && Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 7) {
      dragging = true;
      svg.classList.add('dragging');
    }
    if (dragging) {
      cam.yaw -= dx * 0.005;
      cam.pitch = Math.min(1.35, Math.max(0.18, cam.pitch + dy * 0.004));
      render();
    }
  });

  function endPointer(e) {
    if (pointers.has(e.pointerId) && pointers.size === 1 && !dragging && tapStart) {
      const r = svg.getBoundingClientRect();
      const c = hitCell(e.clientX - r.left, e.clientY - r.top);
      if (c) tryPlace(c.gx, c.gy);
    }
    pointers.delete(e.pointerId);
    if (!pointers.size) {
      dragging = false;
      svg.classList.remove('dragging');
    }
    tapStart = null;
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.dist = Math.min(30, Math.max(6, cam.dist * (e.deltaY > 0 ? 1.08 : 0.93)));
    render();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && e.key === 'z') || e.key === 'u') doUndo();
  });

  /* ---------- 排行榜 ---------- */
  const RANK_KEY = 'gomoku3d-rank';

  function loadRank() {
    try { return JSON.parse(localStorage.getItem(RANK_KEY)) || []; }
    catch { return []; }
  }
  function saveRank(list) {
    try { localStorage.setItem(RANK_KEY, JSON.stringify(list.slice(0, 50))); } catch {}
  }

  function fmtDur(ms) {
    const s = Math.round(ms / 1000);
    return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`;
  }

  function sigSvg(strokes) {
    const paths = (strokes || [])
      .filter((s) => s.length >= 2)
      .map((s) => `<polyline points="${s.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#1a2340" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('');
    return `<svg viewBox="0 0 300 100" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  }

  function renderRank() {
    const list = loadRank();
    const el = document.getElementById('rank-list');
    if (!list.length) {
      el.innerHTML = '<div class="rank-empty">尚無紀錄 — 贏一局來簽名吧！</div>';
      return;
    }
    el.innerHTML = list
      .map((r, i) => `
        <div class="rank-item">
          <span class="no">${i + 1}</span>
          <span class="who">${escapeHtml(r.name)}（${r.side}棋）</span>
          ${r.sig && r.sig.length ? sigSvg(r.sig) : '<span></span>'}
          <span class="meta">${r.vsAI ? '勝過電腦' : '雙人對戰'} · ${r.moves} 手 · ${fmtDur(r.ms)} · ${r.date}</span>
        </div>`)
      .join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 簽名板 ---------- */
  const sigPad = document.getElementById('sig-pad');
  let sigStrokes = [], sigCur = null;

  function sigPoint(e) {
    const r = sigPad.getBoundingClientRect();
    return [
      Math.round((e.clientX - r.left) / r.width * 3000) / 10,
      Math.round((e.clientY - r.top) / r.height * 1000) / 10,
    ];
  }
  function drawSig() { sigPad.innerHTML = sigSvg(sigStrokes).replace(/^<svg[^>]*>|<\/svg>$/g, ''); }

  sigPad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sigPad.setPointerCapture(e.pointerId);
    sigCur = [sigPoint(e)];
    sigStrokes.push(sigCur);
  });
  sigPad.addEventListener('pointermove', (e) => {
    if (!sigCur) return;
    sigCur.push(sigPoint(e));
    drawSig();
  });
  sigPad.addEventListener('pointerup', () => { sigCur = null; drawSig(); });
  sigPad.addEventListener('pointercancel', () => { sigCur = null; });
  document.getElementById('sig-clear').addEventListener('click', () => {
    sigStrokes = []; sigCur = null; sigPad.innerHTML = '';
  });

  /* ---------- 彈窗 ---------- */
  function openModal(id) { document.getElementById(id).classList.add('show'); }
  function closeModal(id) { document.getElementById(id).classList.remove('show'); }

  function openWinModal() {
    const humanWon = mode === 'pvp' || game.winner === humanSide;
    const c = game.winner === E.BLACK ? '黑' : '白';
    document.getElementById('win-title').textContent =
      humanWon ? `${c}棋獲勝！` : '電腦獲勝！';
    document.getElementById('win-detail').textContent = humanWon
      ? `共 ${game.moves.length} 手 · 用時 ${fmtDur(Date.now() - startTime)}，簽名留下你的戰績吧！`
      : `共 ${game.moves.length} 手。悔棋可以回到落敗前，再試一次！`;
    const canSign = humanWon;
    document.getElementById('win-name').parentElement.style.display = canSign ? '' : 'none';
    sigPad.parentElement.style.display = canSign ? '' : 'none';
    document.getElementById('btn-save').style.display = canSign ? '' : 'none';
    document.getElementById('btn-skip').textContent = canSign ? '跳過' : '關閉';
    sigStrokes = []; sigPad.innerHTML = '';
    openModal('modal-win');
  }

  document.getElementById('btn-save').addEventListener('click', () => {
    const name = document.getElementById('win-name').value.trim() || '無名氏';
    const list = loadRank();
    list.push({
      name,
      sig: sigStrokes.filter((s) => s.length >= 2),
      side: game.winner === E.BLACK ? '黑' : '白',
      vsAI: mode === 'ai',
      moves: game.moves.length,
      ms: Date.now() - startTime,
      date: new Date().toLocaleDateString('zh-TW'),
    });
    list.sort((a, b) => (b.vsAI - a.vsAI) || (a.moves - b.moves) || (a.ms - b.ms));
    saveRank(list);
    recorded = true;
    closeModal('modal-win');
    renderRank();
    openModal('modal-rank');
  });
  document.getElementById('btn-skip').addEventListener('click', () => {
    recorded = true;
    closeModal('modal-win');
  });

  document.getElementById('btn-rank').addEventListener('click', () => {
    renderRank();
    openModal('modal-rank');
  });
  document.getElementById('btn-rank-close').addEventListener('click', () => closeModal('modal-rank'));
  document.getElementById('btn-rank-clear').addEventListener('click', () => {
    if (confirm('確定清空所有排行紀錄？')) {
      saveRank([]);
      renderRank();
    }
  });

  /* ---------- 開局設定 ---------- */
  function segInit(id, cb) {
    const seg = document.getElementById(id);
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      cb(btn);
    });
  }
  segInit('seg-mode', (btn) => {
    mode = btn.dataset.mode;
    document.getElementById('field-side').style.display = mode === 'ai' ? '' : 'none';
  });
  segInit('seg-side', (btn) => {
    humanSide = +btn.dataset.side;
    aiSide = humanSide === E.BLACK ? E.WHITE : E.BLACK;
  });
  document.getElementById('field-side').style.display = 'none';

  document.getElementById('btn-start').addEventListener('click', () => {
    closeModal('modal-setup');
    newGame();
  });
  document.getElementById('btn-new').addEventListener('click', () => openModal('modal-setup'));
  document.getElementById('btn-undo').addEventListener('click', doUndo);

  /* ---------- 啟動 ---------- */
  window.addEventListener('resize', resize);
  resize();
  setStatus('選擇模式開始對局');

  window.__g3d = {
    get game() { return game; },
    screenPt: (gx, gy) => screenPts[gy] && screenPts[gy][gx],
    cam,
  };
})();
