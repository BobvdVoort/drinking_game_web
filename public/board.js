window.BoardGame = (function () {
  const SIZE = 10;

  function generateBoard(size = SIZE) {
    const board = Array.from({ length: size }, () => Array(size).fill(null));
    let top = 0, bottom = size - 1, left = 0, right = size - 1, num = 1;
    while (top <= bottom && left <= right) {
      for (let c = left; c <= right; c++) board[top][c] = num++;
      top++;
      for (let r = top; r <= bottom; r++) board[r][right] = num++;
      right--;
      if (top <= bottom) {
        for (let c = right; c >= left; c--) board[bottom][c] = num++;
        bottom--;
      }
      if (left <= right) {
        for (let r = bottom; r >= top; r--) board[r][left] = num++;
        left++;
      }
    }
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        if (board[r][c] === 100) board[r][c] = 'FINISH';
    return board;
  }

  const BOARD = generateBoard();

  const SPECIAL_TILES = {
    16: { id: 1, type: 'break' },
    32: { id: 2, type: 'break' },
    48: { id: 3, type: 'break' },
    64: { id: 4, type: 'break' },
    80: { id: 5, type: 'break' },
    96: { id: 6, type: 'endgame' },
    97: { id: 7, type: 'endgame' },
    98: { id: 8, type: 'endgame' },
    99: { id: 9, type: 'endgame' },
  };

  const TILE_POS = {};
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = BOARD[r][c];
      if (typeof v === 'number') TILE_POS[v] = [r, c];
      else if (v === 'FINISH') TILE_POS[100] = [r, c];
    }
  }

  // ---------- Tooltip ----------
  let tooltipEl = null;
  function ensureTooltip() {
    if (tooltipEl && document.body.contains(tooltipEl)) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'tileTooltip';
    tooltipEl.className = 'tile-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function buildTooltipContent(tile, rule) {
    const lines = [];
    const titleLine = `
      <div class="tile-tooltip-head">
        <span class="tile-tooltip-num">Tile ${tile}</span>
        <span class="tile-tooltip-title">${escapeHtml(rule.title || '—')}</span>
      </div>`;
    lines.push(titleLine);

    if (rule.text) {
      lines.push(`<div class="tile-tooltip-text">${escapeHtml(rule.text)}</div>`);
    }

    const metaBits = [];
    if (rule.type)      metaBits.push(`<span class="tt-meta-tag tt-type">${escapeHtml(rule.type)}</span>`);
    if (rule.minigame)  metaBits.push(`<span class="tt-meta-tag tt-minigame">${escapeHtml(rule.minigame)}${rule.betgameVariant ? ' · ' + escapeHtml(rule.betgameVariant) : ''}</span>`);
    if (rule.tokenIndicators) metaBits.push(`<span class="tt-meta-tag tt-token">🏷️ ${escapeHtml(rule.tokenIndicators)}</span>`);
    if (typeof rule.sips === 'number') metaBits.push(`<span class="tt-meta-tag tt-sips">🍺 ${rule.sips} sips</span>`);
    if (typeof rule.gold === 'number') metaBits.push(`<span class="tt-meta-tag tt-gold">💰 ${rule.gold > 0 ? '+' : ''}${rule.gold} gold</span>`);
    if (typeof rule.toiletCard === 'number') metaBits.push(`<span class="tt-meta-tag tt-tc">🚽 ${rule.toiletCard}</span>`);

    if (metaBits.length) {
      lines.push(`<div class="tile-tooltip-meta">${metaBits.join('')}</div>`);
    }

    return lines.join('');
  }

  const _wired = new WeakSet();
  function wireTooltip(boardEl, getRules) {
    if (_wired.has(boardEl)) return;
    _wired.add(boardEl);

    let currentCell = null;

    function hide() {
      currentCell = null;
      const tip = ensureTooltip();
      tip.style.display = 'none';
    }

    function positionAt(clientX, clientY) {
      const tip = ensureTooltip();
      const pad = 14;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      tip.style.left = '0px';
      tip.style.top = '0px';
      const rect = tip.getBoundingClientRect();
      let x = clientX + pad;
      let y = clientY + pad;
      if (x + rect.width + 8 > vw) x = clientX - rect.width - pad;
      if (y + rect.height + 8 > vh) y = clientY - rect.height - pad;
      if (x < 8) x = 8;
      if (y < 8) y = 8;
      tip.style.left = x + 'px';
      tip.style.top  = y + 'px';
    }

    function showForCell(cell, clientX, clientY) {
      const rules = getRules();
      if (!rules) { hide(); return; }
      const raw = cell.dataset.tile;
      if (!raw || raw === 'FINISH') { hide(); return; }
      const tile = Number(raw);
      const rule = rules[tile];
      if (!rule) { hide(); return; }

      const tip = ensureTooltip();
      tip.innerHTML = buildTooltipContent(tile, rule);
      tip.style.display = 'block';
      currentCell = cell;
      positionAt(clientX, clientY);
    }

    boardEl.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || !boardEl.contains(cell)) return;
      showForCell(cell, e.clientX, e.clientY);
    });

    boardEl.addEventListener('mousemove', (e) => {
      if (!currentCell) return;
      const cell = e.target.closest('.cell');
      if (cell === currentCell) {
        positionAt(e.clientX, e.clientY);
      }
    });

    boardEl.addEventListener('mouseout', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const next = e.relatedTarget && e.relatedTarget.closest
        ? e.relatedTarget.closest('.cell')
        : null;
      if (next !== currentCell) hide();
    });

    boardEl.addEventListener('mouseleave', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
  }

  function renderBoard(el, state, getRules) {
    el.classList.add('board');
    el.innerHTML = '';

    const cells = {};
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = BOARD[r][c];
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.tile = String(v);
        if (v === 'FINISH') {
          cell.classList.add('finish');
          cell.innerHTML = `<span class="tile-num">🏁</span><span class="tile-label">FINISH</span>`;
        } else {
          if (SPECIAL_TILES[v]) {
            cell.classList.add('special', `special-${SPECIAL_TILES[v].type}`);
            cell.innerHTML = `<span class="tile-num">${v}</span><span class="tile-label">Special ${SPECIAL_TILES[v].id}</span>`;
          } else {
            cell.innerHTML = `<span class="tile-num">${v}</span>`;
          }
        }
        const tokens = document.createElement('div');
        tokens.className = 'tokens';
        cell.appendChild(tokens);
        el.appendChild(cell);
        cells[v] = tokens;
      }
    }

    if (state && state.players) {
      for (const p of state.players) {
        const pos = p.position === 0 ? 1 : p.position;
        const target = cells[pos === 100 ? 'FINISH' : pos];
        if (!target) continue;
        const token = document.createElement('div');
        token.className = 'token';
        token.style.background = p.color;
        token.title = `${p.name} (${p.gold} gold)`;
        token.textContent = p.name.slice(0, 2).toUpperCase();
        if (p.finished) token.classList.add('finished');
        target.appendChild(token);
      }
    }

    if (typeof getRules === 'function') {
      wireTooltip(el, getRules);
    }
  }

  // ---------- Roll animation overlay ----------
  // opts: { spinMs, resultMs }
  //   spinMs   — duration of the dice spin (default 2000 ms)
  //   resultMs — how long the result stays visible after the spin (default 3500 ms)
  let _rollTimer = null;
  function showRollOverlay(rolls, opts) {
    const spinMs   = Number(opts && opts.spinMs)   || 2000;
    const resultMs = Number(opts && opts.resultMs) || 3500;
    const totalMs  = spinMs + resultMs;

    const overlay = document.getElementById('rollOverlay');
    const result  = document.getElementById('rollOverlayResult');
    if (!overlay || !result) return;
    const dieEl = overlay.querySelector('.die');

    const total = (rolls || []).reduce((a, b) => a + b, 0);
    result.textContent = rolls && rolls.length > 1
      ? `${rolls.join(' + ')} = ${total}`
      : String(total);

    // Reset any previous animation, then force a reflow so the new
    // animation timings actually re-trigger.
    overlay.style.animation = 'none';
    if (dieEl) dieEl.style.animation = 'none';
    result.style.animation = 'none';
    overlay.style.display = 'none';
    void overlay.offsetWidth;

    const spinIterations  = 4;
    const spinIterationMs = Math.max(150, Math.floor(spinMs / spinIterations));
    overlay.style.animation = `diceFade ${totalMs}ms ease forwards`;
    if (dieEl) dieEl.style.animation = `diceSpin ${spinIterationMs}ms linear ${spinIterations}`;
    result.style.animation = `diceResultPop 400ms ease ${spinMs}ms forwards`;

    overlay.style.display = 'flex';

    if (_rollTimer) clearTimeout(_rollTimer);
    _rollTimer = setTimeout(() => { overlay.style.display = 'none'; }, totalMs);
  }

  // ---------- Win overlay ----------
  let _winTimer = null;
  function showWinOverlay(name) {
    const overlay = document.getElementById('winOverlay');
    const nm = document.getElementById('winOverlayName');
    if (!overlay || !nm) return;
    nm.textContent = name;

    overlay.style.display = 'none';
    void overlay.offsetWidth;
    overlay.style.display = 'flex';

    if (_winTimer) clearTimeout(_winTimer);
    _winTimer = setTimeout(() => { overlay.style.display = 'none'; }, 5000);
  }

  return { SIZE, BOARD, SPECIAL_TILES, TILE_POS, renderBoard, generateBoard, showRollOverlay, showWinOverlay };
})();