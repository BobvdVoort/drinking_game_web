const socket = io();
let state = null;
let code = null;
let rulesData = null;
const el = (id) => document.getElementById(id);

// ---------- Reference / rules overlay ----------
function setRefTab(tab) {
  document.querySelectorAll('.ref-overlay-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.reftab === tab);
  });
  const pTiles  = el('refPanel-tiles');
  const pCommon = el('refPanel-common');
  const pMinis  = el('refPanel-minigames');
  if (pTiles)  pTiles.style.display  = tab === 'tiles'     ? 'block' : 'none';
  if (pCommon) pCommon.style.display = tab === 'common'    ? 'block' : 'none';
  if (pMinis)  pMinis.style.display  = tab === 'minigames' ? 'block' : 'none';
  if (tab === 'common' && window.GameReference && el('refCommonContent')) {
    el('refCommonContent').innerHTML = window.GameReference.renderCommonRulesHTML();
  }
  if (tab === 'minigames' && window.GameReference && el('refMinigamesContent')) {
    el('refMinigamesContent').innerHTML = window.GameReference.renderMinigamesHTML();
  }
}

const TOKEN_INFO = {
  thumbmaster:      { emoji: '👍', label: 'Thumbmaster' },
  'beer-slut':      { emoji: '🍺', label: 'Beer-Slut' },
  gnome:            { emoji: '🍄', label: 'Gnome' },
  'drinking-buddy': { emoji: '🤝', label: 'Drinking Buddy' },
  pirate:           { emoji: '🏴‍☠️', label: 'Pirate' },
  marine:           { emoji: '⚓', label: 'Marine' },
  'skip-turn':      { emoji: '⏭', label: 'Skip Next Turn' },
  'straw':          { emoji: '🥤', label: 'Must Drink With Straw' },
  'hold-out':       { emoji: '✊', label: 'Hold Out' },
  'mute':           { emoji: '🤐', label: 'Mute' },
  '69':             { emoji: '😏', label: '69' },
  'blind':          { emoji: '🙈', label: 'Blind' },
};
const SPECIAL_TILE_IDS = [16, 32, 48, 64, 80, 96, 97, 98, 99];
const ENDGAME_FIRST = 96;
const BREAK_TILES = [16, 32, 48, 64, 80];
const ML_PER_SIP = 30;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtSips(n) {
  const v = Number(n) || 0;
  if (v <= 0) return '0 sips (0L)';
  const sips = Math.round(v * 10) / 10;
  const liters = +((v * ML_PER_SIP) / 1000).toFixed(2);
  return `${sips} sips (${liters}L)`;
}

function formatMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function playAlarm() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      const t = now + i * 0.4;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.35, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.start(t);
      o.stop(t + 0.32);
    }
  } catch (e) { /* silent */ }
}

let _strawSeenStart = null;
let _strawAlarmFired = false;

function updateStrawCountdown() {
  if (!state || !state.activeRule || !state.activeRule.straw) return;
  const s = state.activeRule.straw;
  const disp = el('strawCountdown');
  if (!disp) return;
  if (s.startedAt !== _strawSeenStart) {
    _strawSeenStart = s.startedAt;
    _strawAlarmFired = false;
  }
  if (s.phase === 'running') {
    const remaining = Math.max(0, s.durationMs - (Date.now() - s.startedAt));
    disp.textContent = formatMMSS(remaining);
    disp.style.color = remaining <= 10000 ? '#f87171' : '#22d3ee';
    if (remaining <= 0 && !_strawAlarmFired) {
      _strawAlarmFired = true;
      playAlarm();
    }
  } else if (s.phase === 'done') {
    disp.textContent = '0:00';
    disp.style.color = '#f87171';
  } else {
    disp.textContent = formatMMSS(s.durationMs);
    disp.style.color = '#22d3ee';
  }
}

setInterval(updateStrawCountdown, 250);

function tokenBadges(p) {
  if (!p.tokens || p.tokens.length === 0) return '';
  const badges = p.tokens.map(t => {
    const info = TOKEN_INFO[t] || { emoji: '🏷️', label: t };
    return `<span class="token-badge" title="${info.label}">${info.emoji}</span>`;
  }).join('');
  return `<span class="token-badges">${badges}</span>`;
}

function inEndgameZone(p) { return p && p.position >= ENDGAME_FIRST && p.position <= 99; }

function rpsBeats(a, b) {
  return (a === 'rock' && b === 'scissors')
      || (a === 'scissors' && b === 'paper')
      || (a === 'paper' && b === 'rock');
}

function makeBidSelect(selected) {
  const sel = document.createElement('select');
  sel.style.width = '80px';
  sel.style.background = '#0f141b';
  sel.style.color = '#fff';
  sel.style.border = '1px solid #2a3542';
  sel.style.borderRadius = '6px';
  sel.style.padding = '4px';
  for (let v = 10; v <= 100; v += 10) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = `${v}%`;
    sel.appendChild(opt);
  }
  if (selected !== undefined) sel.value = String(selected);
  return sel;
}

function makeMedusaSelect(participantId, state, m) {
  const sel = document.createElement('select');
  sel.style.width = '100px';
  sel.style.background = '#0f141b';
  sel.style.color = '#fff';
  sel.style.border = '1px solid #2a3542';
  sel.style.borderRadius = '6px';
  sel.style.padding = '4px';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Pick…';
  sel.appendChild(placeholder);
  for (const pid of m.participants) {
    if (pid === participantId) continue;
    const p = state.players.find(pp => pp.id === pid);
    if (!p) continue;
    const opt = document.createElement('option');
    opt.value = pid;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.onchange = () => {
    if (sel.value) socket.emit('player:medusaPick', { code: state.code, playerId: participantId, targetId: sel.value });
  };
  return sel;
}

function makeRpsSelect(participantId) {
  const sel = document.createElement('select');
  sel.style.width = '110px';
  sel.style.background = '#0f141b';
  sel.style.color = '#fff';
  sel.style.border = '1px solid #2a3542';
  sel.style.borderRadius = '6px';
  sel.style.padding = '4px';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Throw…';
  sel.appendChild(placeholder);
  ['rock', 'paper', 'scissors'].forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t === 'rock' ? '✊ Rock' : t === 'paper' ? '✋ Paper' : '✌️ Scissors';
    sel.appendChild(opt);
  });
  sel.onchange = () => {
    if (sel.value) socket.emit('player:rpsPick', { code: state.code, playerId: participantId, throw: sel.value });
  };
  return sel;
}

el('btnCreate').onclick = () => {
  const count = Math.max(2, Math.min(12, Number(el('l_count').value) || 4));
  const names = el('l_names').value.split(',').map(s => s.trim()).filter(Boolean);
  socket.emit('local:create', { playerCount: count, names });
};

socket.on('local:created', (res) => {
  code = res.code;
  el('setup').style.display = 'none';
  el('gameArea').style.display = 'block';
  el('codeText').textContent = code;
});

socket.on('state', (s) => {
  state = s;
  if (state && state.code) code = state.code;
  render();
});

socket.on('rules', (r) => { rulesData = r; renderRulesTable(); });

socket.on('playtest:result', (res) => {
  if (!res.ok) {
    alert('Play-test error: ' + (res.reason || 'unknown'));
  }
});

function renderRulesTable() {
  if (!rulesData) return;
  const body = el('rulesBody');
  body.innerHTML = '';
  const tiles = Object.keys(rulesData).map(Number).sort((a, b) => a - b);
  el('rulesCount').textContent = `${tiles.length} tiles loaded`;
  for (const tile of tiles) {
    const rule = rulesData[tile];
    const isSpecial = SPECIAL_TILE_IDS.includes(tile);
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #1a212c';
    if (isSpecial) tr.style.background = '#1e2a15';
    const tag = isSpecial ? ' <span style="color:#a3e635;font-size:10px;">special</span>' : '';
    tr.innerHTML = `
      <td style="padding:6px 8px; font-weight:700;">${tile}${tag}</td>
      <td style="padding:6px 8px; color:#98a3b3;">${esc(rule.type)}</td>
      <td style="padding:6px 8px;">${esc(rule.title)}</td>
      <td style="padding:6px 8px; color:#c4b5fd;">${esc(rule.minigame || '')}</td>
      <td style="padding:6px 8px; color:#fbbf24;">${esc(rule.tokenIndicators || '')}</td>
      <td style="padding:6px 8px; color:#f472b6;">${esc(rule.betgameVariant || '')}</td>
      <td style="padding:6px 8px; color:#f87171;">${rule.sips ?? ''}</td>
      <td style="padding:6px 8px; color:#fbbf24;">${rule.gold ?? ''}</td>
      <td style="padding:6px 8px; color:#60a5fa;">${rule.toiletCard ?? ''}</td>
      <td style="padding:6px 8px; color:#cbd5e1; max-width:480px;">${esc(rule.text)}</td>
    `;
    body.appendChild(tr);
  }
}

function renderMakerules() {
  const panel = el('makerulesPanel');
  const list = el('makerulesList');
  const rules = (state && state.makerules) || [];
  if (rules.length === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  list.innerHTML = rules.map(r =>
    `<li><b>${esc(r.by)}</b>: ${esc(r.text)}</li>`
  ).join('');
}

function renderWhisperLocal(r) {
  const w = r.whisper;
  el('whisperPanel').style.display = 'block';
  const info      = el('whisperInfo');
  const inputWrap = el('whisperInputWrap');
  const prompt    = el('whisperPrompt');
  const input     = el('whisperInput');
  const list      = el('whisperList');
  const forceBtn  = el('btnWhisperForce');

  let sel = document.getElementById('whisperPlayerSelect');
  if (!sel) {
    sel = document.createElement('select');
    sel.id = 'whisperPlayerSelect';
    sel.style.width = '100%';
    sel.style.marginBottom = '6px';
    sel.style.background = '#0f141b';
    sel.style.color = '#fff';
    sel.style.border = '1px solid #2a3542';
    sel.style.borderRadius = '6px';
    sel.style.padding = '6px 8px';
    input.parentNode.insertBefore(sel, input);
  }

  if (w.phase === 'r1' || w.phase === 'r2') {
    const label = w.phase === 'r1' ? 'Round 1' : 'Round 2';
    const submitted = w.participants.filter(pid => (w.questions[pid] || {})[w.phase]).length;
    info.textContent = `🤫 Whisper — ${label}: ${submitted}/${w.participants.length} submitted.`;
    info.className = 'banner warn';
    if (forceBtn) forceBtn.style.display = 'block';

    const pending = w.participants.filter(pid => !(w.questions[pid] || {})[w.phase]);
    if (pending.length === 0) {
      inputWrap.style.display = 'none';
      sel.style.display = 'none';
    } else {
      inputWrap.style.display = 'block';
      sel.style.display = 'block';
      const prev = sel.value;
      sel.innerHTML = '';
      for (const pid of pending) {
        const p = state.players.find(pp => pp.id === pid);
        if (!p) continue;
        const opt = document.createElement('option');
        opt.value = pid;
        opt.textContent = `Submitting as: ${p.name}`;
        sel.appendChild(opt);
      }
      if (pending.includes(prev)) sel.value = prev;
      prompt.textContent = `Question for ${label}:`;
    }
  } else {
    info.textContent = '🤫 Whisper complete.';
    info.className = 'banner good';
    inputWrap.style.display = 'none';
    if (forceBtn) forceBtn.style.display = 'none';
  }

  const rows = w.participants.map(pid => {
    const p = state.players.find(pp => pp.id === pid);
    const name = p ? p.name : '?';
    const q1 = (w.questions[pid] || {}).r1 || '—';
    const q2 = (w.questions[pid] || {}).r2 || '—';
    return `<div><b>${esc(name)}</b> — R1: ${esc(q1)} · R2: ${esc(q2)}</div>`;
  }).join('');
  list.innerHTML = `<div class="roll-result">Questions so far</div>${rows}`;
}

function renderAuctionLocal(r) {
  const a = r.auction;
  el('auctionPanel').style.display = 'block';
  const info    = el('auctionInfo');
  const bidWrap = el('auctionBidWrap');
  const prompt  = el('auctionPrompt');
  const input   = el('auctionBidInput');
  const hist    = el('auctionHistory');

  const shot = Math.min(a.shotNumber, a.maxShots);

  if (a.phase === 'done') {
    info.textContent = '🔨 Auction complete.';
    info.className = 'banner good';
    bidWrap.style.display = 'none';
  } else if (!a.bidders || a.bidders.length === 0) {
    info.textContent = `🔨 Shot ${shot} of ${a.maxShots} — no bidders.`;
    info.className = 'banner warn';
    bidWrap.style.display = 'none';
  } else {
    const currentId = a.bidders[a.turnIndex];
    const currentP  = state.players.find(p => p.id === currentId);
    const winner    = a.currentWinner
      ? state.players.find(p => p.id === a.currentWinner)
      : null;

    const bidStr = winner
      ? `Lowest bid: ${a.currentBid}g (${winner.name})`
      : `Starting at 3.5g — no bids yet`;
    info.textContent =
      `🔨 Shot ${shot} of ${a.maxShots} — auctioneer: ${a.auctioneerName}. ${bidStr}.`;
    info.className = 'banner warn';

    bidWrap.style.display = 'block';
    const floor = 0.5;
    const ceiling = a.currentBid > floor ? a.currentBid - 0.5 : floor;
    prompt.textContent = `${currentP ? currentP.name : '?'}'s turn — bid the gold they'll receive for drinking the shot (between ${floor}g and ${ceiling}g).`;
    input.min = String(floor);
    input.max = String(ceiling);
    const cur = Number(input.value);
    if (!input.value || !Number.isFinite(cur) || cur > ceiling || cur < floor) {
      input.value = String(ceiling);
    }
  }

  const rows = a.history.map(h => {
    if (h.winnerName) {
      return `<div>Shot ${h.shot}: <b>${esc(h.winnerName)}</b> — drinks for ${h.price}g</div>`;
    }
    return `<div>Shot ${h.shot}: no winner</div>`;
  }).join('') || '<div style="color:#98a3b3;">No shots resolved yet.</div>';
  hist.innerHTML = `<div class="roll-result">History</div>${rows}`;
}

function renderJizzLocal(r) {
  const j = r.jizz;
  el('jizzPanel').style.display = 'block';
  const info = el('jizzInfo');
  const picker = el('jizzPicker');
  const wrap = el('jizzLosers');
  const tally = el('jizzTally');
  const cont = el('btnJizzContinue');

  const round = j.history.length + 1;
  const isDone = j.phase === 'done';
  const landerId = r.playerId;

  if (isDone) {
    const winnerId = j.active[0];
    const winnerP = state.players.find(p => p.id === winnerId);
    const eliminatedEarly = j.history.some(h => h.loserId === landerId && !h.isFinale);
    const passed = !eliminatedEarly;
    info.textContent = `🏆 Jizz Tournament complete — winner: ${winnerP ? winnerP.name : '?'}. Lander ${passed ? 'made top 2 ✓' : 'eliminated early ✗'}.`;
    info.className = passed ? 'banner good' : 'banner warn';
    if (cont) {
      cont.style.display = 'block';
      cont.textContent = `Continue as lander (${passed ? 'advance to 98' : 'stay on 97'})`;
    }
  } else {
    info.textContent = `🎵 Jizz Tournament — Round ${round} of ${j.maxRounds} (sudden death). Loser drinks ${round === j.maxRounds ? 'a shot (7 sips)' : '3 sips'}.`;
    info.className = 'banner warn';
    if (cont) cont.style.display = 'none';
  }

  wrap.innerHTML = '';
  if (!isDone) {
    picker.style.display = 'block';
    for (const pid of j.active) {
      const p = state.players.find(pp => pp.id === pid);
      if (!p) continue;
      const b = document.createElement('button');
      b.textContent = p.name;
      b.style.background = p.color;
      b.style.color = '#fff';
      b.onclick = () => socket.emit('player:jizzLoser', {
        code: state.code, loserId: pid,
      });
      wrap.appendChild(b);
    }
  } else {
    picker.style.display = 'none';
  }

  if (j.history.length > 0) {
    const lines = j.history.map(h =>
      `<div>Round ${h.round}: <b>${esc(h.loserName)}</b> out — ${h.sips} sips${h.isFinale ? ' (shot!)' : ''}</div>`
    ).join('');
    tally.style.display = 'block';
    tally.innerHTML = `<div class="roll-result">Eliminations</div>${lines}`;
  } else {
    tally.style.display = 'none';
  }
}

function renderSongLocal(r) {
  const s = r.song;
  el('songPanel').style.display = 'block';
  const info = el('songInfo');
  const remaining = s.maxGuesses - s.wrongGuesses;
  info.textContent = `🎵 Guess the Song — ${remaining} guess${remaining === 1 ? '' : 'es'} left (${s.wrongGuesses}/${s.maxGuesses} wrong). Click below for the current player.`;
  info.className = 'banner warn';
}

function renderPlaytest() {
  const pt = state && state.playtest;
  const panel = el('playtestPanel');

  if (!pt || !pt.enabled) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  const wrap = el('playtestRollBtns');
  wrap.innerHTML = '';
  for (let n = 1; n <= 6; n++) {
    const b = document.createElement('button');
    b.textContent = String(n);
    const isActive = pt.forcedRoll === n;
    b.className = isActive ? 'good' : 'secondary';
    b.style.minWidth = '40px';
    b.onclick = () => socket.emit('host:forceRoll', { code: state.code, value: n });
    wrap.appendChild(b);
  }
  const clear = document.createElement('button');
  clear.textContent = 'Clear';
  clear.className = 'danger';
  clear.onclick = () => socket.emit('host:forceRoll', { code: state.code, value: 'clear' });
  wrap.appendChild(clear);

  el('playtestRollStatus').textContent = pt.forcedRoll != null
    ? `Next roll is forced to ${pt.forcedRoll} (will clear after use).`
    : 'Next roll is normal.';

  const phaseWrap = el('playtestPhaseBtns');
  phaseWrap.innerHTML = '';
  for (let n = 1; n <= 6; n++) {
    const b = document.createElement('button');
    b.textContent = String(n);
    const isActive = state.phase === n;
    b.className = isActive ? 'good' : 'secondary';
    b.style.minWidth = '40px';
    b.title = n <= 5
      ? `Break tile ${BREAK_TILES[n - 1]}`
      : 'Endgame (no break lock)';
    b.onclick = () => socket.emit('host:setPhase', { code: state.code, phase: n });
    phaseWrap.appendChild(b);
  }
  if (state.breakLock) {
    const total = state.players.filter(p => !p.finished).length;
    el('playtestPhaseStatus').textContent =
      `Current break tile: ${state.breakLock.tile} (${state.breakLock.arrived.length}/${total} arrived)`;
  } else {
    el('playtestPhaseStatus').textContent = 'No break lock — endgame unlocked.';
  }

  const posWrap = el('playtestPositions');
  posWrap.innerHTML = '';
  for (const p of state.players) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.alignItems = 'center';
    row.style.fontSize = '13px';

    const dot = document.createElement('div');
    dot.style.width = '12px';
    dot.style.height = '12px';
    dot.style.borderRadius = '50%';
    dot.style.background = p.color;
    row.appendChild(dot);

    const name = document.createElement('div');
    name.textContent = p.name;
    name.style.minWidth = '80px';
    row.appendChild(name);

    const cur = document.createElement('div');
    cur.textContent = `tile ${p.position}`;
    cur.style.color = '#98a3b3';
    cur.style.minWidth = '70px';
    row.appendChild(cur);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.value = String(p.position);
    input.style.width = '70px';
    input.style.background = '#0f141b';
    input.style.color = '#fff';
    input.style.border = '1px solid #2a3542';
    input.style.borderRadius = '6px';
    input.style.padding = '4px';
    row.appendChild(input);

    const setBtn = document.createElement('button');
    setBtn.textContent = 'Set';
    setBtn.className = 'good';
    setBtn.onclick = () => {
      const v = parseInt(input.value, 10);
      if (Number.isNaN(v)) return;
      socket.emit('host:setPosition', {
        code: state.code,
        playerId: p.id,
        position: v,
      });
    };
    row.appendChild(setBtn);

    posWrap.appendChild(row);
  }
}

let _lastRollShown = null;
let _firstRender = true;
let _seenFinished = null;
let _rollBannerTimer = null;

function showRollBanner(lastRoll) {
  const banner = el('rollBanner');
  if (!banner) return;
  const rolls = lastRoll.rolls || [];
  const total = rolls.reduce((a, b) => a + b, 0);
  const rolled = rolls.length > 1 ? `${rolls.join('+')} = ${total}` : String(total);
  const p = state.players.find(pp => pp.id === lastRoll.playerId);
  banner.textContent = `🎲 ${p ? p.name : '?'} rolled ${rolled}`;
  banner.style.display = 'block';
  if (_rollBannerTimer) clearTimeout(_rollBannerTimer);
  _rollBannerTimer = setTimeout(() => { banner.style.display = 'none'; }, 5000);
}

function render() {
  if (!state) return;

  if (_firstRender) {
    _lastRollShown = state.lastRoll ? state.lastRoll.at : null;
    _firstRender = false;
  } else if (state.lastRoll && state.lastRoll.at !== _lastRollShown) {
    _lastRollShown = state.lastRoll.at;
    BoardGame.showRollOverlay(state.lastRoll.rolls, {
      spinMs:   state.settings.rollSpinMs   || 2000,
      resultMs: state.settings.rollResultMs || 3500,
    });
    showRollBanner(state.lastRoll);
  }

  if (_seenFinished === null) {
    _seenFinished = new Set(state.players.filter(pl => pl.finished).map(pl => pl.id));
  } else if (!state.players.some(pl => pl.finished)) {
    _seenFinished = new Set();
  } else {
    for (const pl of state.players) {
      if (pl.finished && !_seenFinished.has(pl.id)) {
        _seenFinished.add(pl.id);
        BoardGame.showWinOverlay(pl.name);
      }
    }
  }

  el('codeText').textContent = state.code;
  el('phaseBanner').textContent = `Phase ${state.phase} · Round ${state.round} · ${state.roundPhase}`;

  const cpId = state.turnOrder[state.currentTurnIndex];
  const cp = state.players.find(p => p.id === cpId);
  let turnText = cp ? `Turn: ${cp.name}` : 'Waiting…';
  if (state.roundPhase === 'order-selection') {
    const chooser = state.players.find(p => p.id === state.orderChooserId);
    if (chooser) turnText = `${chooser.name} is choosing first/last…`;
  }
  if (state.breakLock) {
    const total = state.players.filter(p => !p.finished).length;
    turnText += ` · 🛑 Break ${state.breakLock.tile}: ${state.breakLock.arrived.length}/${total}`;
  }
  if (cp && inEndgameZone(cp)) turnText += ` · 🏁 Endgame tile ${cp.position}`;
  if (state.playtest && state.playtest.enabled) turnText += ' · 🧪 play-test';
  el('turnBanner').textContent = turnText;

  renderMakerules();
  renderPlaytest();
  BoardGame.renderBoard(el('board'), state, () => rulesData);

  const ownEndgameInfoRule = !!(
    state.activeRule
    && cp
    && cp.position >= 96 && cp.position <= 99
    && state.activeRule.tile === cp.position
    && !state.activeRule.rps && !state.activeRule.jizz && !state.activeRule.song
  );

  if (state.activeRule) {
    const r = state.activeRule;
    const owner = state.players.find(pp => pp.id === r.playerId);
    el('rulePanel').style.display = 'block';
    el('ruleTitle').textContent = `${owner ? owner.name : 'Player'} — tile ${r.tile} — ${r.rule.title}`;
    el('ruleText').textContent = r.rule.text;

    const isMakerule = !!(r.rule && r.rule.minigame === 'makerule' && r.makerule);
    const isOddEven = !!(r.rule && r.rule.minigame === 'odd-or-even' && r.oddEven);
    const isSwapSeats = !!(r.rule && r.rule.minigame === 'swap-seats' && r.swapSeats);
    const isViking = !!(r.rule && r.rule.minigame === 'viking' && r.viking);
    const isStraw = !!(r.rule && r.rule.minigame === 'straw' && r.straw);
    const isJizzDie = !!(r.rule && r.rule.minigame === 'jizz-die' && r.jizzDie);
    const isDrinkingBuddy = !!(r.rule && r.rule.minigame === 'drinking-buddy' && r.drinkingBuddy);
    const isGamble = !!(r.rule && r.rule.minigame === 'gamble' && r.gamble);
    const isMedusa = !!(r.rule && r.rule.minigame === 'medusa' && r.medusa);
    const isRps = !!(r.rule && r.rps);
    const isBuyout = !!(r.rule && r.buyout);
    const isWhisper = !!(r.rule && r.rule.minigame === 'whisper' && r.whisper);
    const isAuction = !!(r.rule && r.rule.minigame === 'auction' && r.auction);
    const isJizz = !!(r.rule && r.rule.minigame === 'jizz' && r.jizz);
    const isSong = !!(r.rule && r.rule.minigame === 'song' && r.song);

    if (isMakerule) {
      el('makerulePanel').style.display = 'block';
      const m = r.makerule;
      const info = el('makeruleInfo');
      if (m.isOdd) {
        if (m.phase === 'choosing') {
          info.innerHTML = `<div class="roll-result">Rolled ${m.roll} — ODD</div>
                            <div>${owner ? esc(owner.name) : 'Player'} makes a rule — type it below.</div>`;
        } else {
          info.innerHTML = `<div class="roll-result">Rule made</div>
                            <div>"${esc(m.submittedText || '')}"</div>`;
        }
      } else {
        info.innerHTML = `<div class="roll-result">Rolled ${m.roll} — EVEN</div><div>Drink 3 sips.</div>`;
      }
      const inputWrap = el('makeruleInputWrap');
      const input = el('makeruleInput');
      const submitBtn = el('btnMakeruleSubmit');
      if (m.isOdd && m.phase === 'choosing') {
        inputWrap.style.display = 'block';
        input.disabled = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Rule';
      } else {
        inputWrap.style.display = 'none';
      }
    } else {
      el('makerulePanel').style.display = 'none';
    }

    if (isOddEven) {
      el('oddEvenPanel').style.display = 'block';
      const o = r.oddEven;
      const info = el('oddEvenInfo');
      if (o.isEven) {
        const bits = [];
        if (o.tokens) bits.push(`Token applied: <b>${esc(o.tokens)}</b>`);
        if (o.sips) bits.push(`Drink ${o.sips} sips`);
        if (bits.length === 0) bits.push('Nothing to drink');
        info.innerHTML =
          `<div class="roll-result">Rolled ${o.roll} — EVEN</div>` +
          `<div>${bits.join(' · ')}.</div>`;
      } else {
        info.innerHTML =
          `<div class="roll-result">Rolled ${o.roll} — ODD</div>` +
          `<div>Nothing happens.</div>`;
      }
    } else {
      el('oddEvenPanel').style.display = 'none';
    }

    if (isSwapSeats) {
      el('swapSeatsPanel').style.display = 'block';
      const s = r.swapSeats;
      const info = el('swapSeatsInfo');
      if (s.ok) {
        info.innerHTML =
          `<div class="roll-result">🪑 Swap!</div>` +
          `<div><b>${esc(s.fromPlayerName)}</b> (tile ${s.fromPlayerOldTile}) swapped with ` +
          `<b>${esc(s.withPlayerName)}</b> (tile ${s.withPlayerOldTile}).</div>` +
          (s.multipleCandidates
            ? `<div style="margin-top:4px;color:#98a3b3;">Multiple targets — swapped with the richest.</div>`
            : '');
      } else {
        info.innerHTML =
          `<div class="roll-result">🪑 No swap</div>` +
          `<div>${esc(s.reason || 'Nothing happens')}.</div>`;
      }
    } else {
      el('swapSeatsPanel').style.display = 'none';
    }

    if (isViking) {
      const v = r.viking;
      el('vikingPanel').style.display = 'block';
      const played = v.history.length;
      const round = Math.min(played + 1, v.maxRounds);
      const isDone = v.phase === 'done';
      el('vikingInfo').textContent = isDone
        ? `🛡 Viking complete — ${v.maxRounds} rounds played.`
        : `🛡 Round ${round} of ${v.maxRounds} — loser drinks ${v.sipsPerLoss} sips.`;

      const picker = el('vikingPicker');
      const wrap = el('vikingLosers');
      wrap.innerHTML = '';
      if (!isDone) {
        picker.style.display = 'block';
        for (const p of state.players) {
          if (p.finished) continue;
          const b = document.createElement('button');
          b.textContent = p.name;
          b.style.background = p.color;
          b.style.color = '#fff';
          b.onclick = () => socket.emit('player:vikingLoser', {
            code: state.code, loserId: p.id,
          });
          wrap.appendChild(b);
        }
      } else {
        picker.style.display = 'none';
      }

      const tally = el('vikingTally');
      if (v.history.length > 0) {
        const counts = {};
        for (const h of v.history) counts[h.loserId] = (counts[h.loserId] || 0) + 1;
        const lines = Object.entries(counts).map(([pid, n]) => {
          const p = state.players.find(pp => pp.id === pid);
          const name = p ? p.name : '?';
          return `<div>${esc(name)}: ${n} loss${n > 1 ? 'es' : ''} → ${n * v.sipsPerLoss} sips</div>`;
        }).join('');
        tally.style.display = 'block';
        tally.innerHTML = `<div class="roll-result">Tally</div>${lines}`;
      } else {
        tally.style.display = 'none';
      }
    } else {
      el('vikingPanel').style.display = 'none';
    }

    if (isStraw) {
      el('strawPanel').style.display = 'block';
      const s = r.straw;
      const info = el('strawInfo');
      if (s.phase === 'idle') {
        info.textContent = 'Click Start when everyone is ready. 1-minute timer.';
        info.className = 'banner';
      } else if (s.phase === 'running') {
        info.textContent = '⏱ Timer running…';
        info.className = 'banner warn';
      } else {
        info.textContent = "⏰ Time's up! Mark the task done to continue.";
        info.className = 'banner good';
      }
      el('btnStrawStart').textContent = s.phase === 'running' ? 'Restart Timer' : 'Start 60s Timer';
      el('btnStrawReset').style.display = (s.phase === 'idle') ? 'none' : 'block';
      updateStrawCountdown();
    } else {
      el('strawPanel').style.display = 'none';
    }

    if (isWhisper) renderWhisperLocal(r); else el('whisperPanel').style.display = 'none';
    if (isAuction) renderAuctionLocal(r); else el('auctionPanel').style.display = 'none';

    if (isJizzDie) {
      el('jizzDiePanel').style.display = 'block';
      const jd = r.jizzDie;
      el('jizzDieInfo').innerHTML =
        `<div class="roll-result">🎲 Rolled ${jd.roll}</div>` +
        `<div>Loser of the Jizz game drinks <b>${jd.roll} sips</b>.</div>`;
    } else {
      el('jizzDiePanel').style.display = 'none';
    }

    if (isDrinkingBuddy) {
      const db = r.drinkingBuddy;
      el('drinkingBuddyPanel').style.display = 'block';
      const info = el('drinkingBuddyInfo');
      const picker = el('drinkingBuddyPicker');
      const wrap = el('drinkingBuddyTargets');
      const result = el('drinkingBuddyResult');
      const lander = state.players.find(pp => pp.id === db.landerId);

      if (db.phase === 'picking') {
        info.textContent = `${lander ? lander.name : '?'} is choosing a drinking buddy.`;
        info.className = 'banner warn';
        picker.style.display = 'block';
        wrap.innerHTML = '';
        for (const pid of db.participants) {
          const p = state.players.find(pp => pp.id === pid);
          if (!p) continue;
          const b = document.createElement('button');
          b.textContent = p.name;
          b.style.background = p.color;
          b.style.color = '#fff';
          b.onclick = () => socket.emit('player:drinkingBuddyPick', {
            code: state.code, playerId: db.landerId, buddyId: pid,
          });
          wrap.appendChild(b);
        }
        result.style.display = 'none';
      } else {
        picker.style.display = 'none';
        result.style.display = 'block';
        const buddy = state.players.find(pp => pp.id === db.buddyId);
        if (buddy && lander) {
          info.textContent = '🤝 Drinking buddy selected.';
          info.className = 'banner good';
          result.className = 'gamble-result win';
          result.textContent = `${lander.name} and ${buddy.name} share all sips and shots for the rest of the game.`;
        } else {
          info.textContent = '🤝 No buddy chosen.';
          info.className = 'banner';
          result.style.display = 'none';
        }
      }
    } else {
      el('drinkingBuddyPanel').style.display = 'none';
    }

    if (isGamble) {
      el('gamblePanel').style.display = 'block';
      const choicesWrap = el('gambleChoices');
      const res = el('gambleResult');
      if (r.gamble.phase === 'choosing') {
        choicesWrap.style.display = 'grid';
        res.style.display = 'none';
        const btns = choicesWrap.querySelectorAll('button');
        btns.forEach(b => {
          b.disabled = false;
          b.onclick = () => socket.emit('player:gambleChoice', {
            code: state.code, playerId: r.playerId, choice: Number(b.dataset.n),
          });
        });
      } else {
        choicesWrap.style.display = 'none';
        res.style.display = 'block';
        const g = r.gamble;
        if (g.outcome === 'win') {
          res.className = 'gamble-result win';
          res.textContent = `Rolled ${g.die} vs ${g.chosen} → WIN +${g.goldDelta} gold.`;
        } else if (g.outcome === 'lose') {
          res.className = 'gamble-result lose';
          res.textContent = `Rolled ${g.die} vs ${g.chosen} → LOSE. Drink ${g.sipsDelta} sips.`;
        } else {
          res.className = 'gamble-result lose';
          res.textContent = `Rolled ${g.die} vs ${g.chosen} → tie. Drink ${g.sipsDelta} sips.`;
        }
      }
    } else {
      el('gamblePanel').style.display = 'none';
    }

    if (isMedusa) {
      const m = r.medusa;
      el('medusaPanel').style.display = 'block';
      el('medusaInfo').textContent = `Round ${m.round} — ${m.shotsRemaining} of ${m.shotsTotal} shot(s) left.`;
      if (m.phase === 'picking') {
        el('medusaProgress').style.display = 'block';
        el('medusaProgress').textContent = `${Object.keys(m.picks).length} / ${m.participants.length} picked. See each player row for pick controls.`;
        el('medusaReveal').style.display = 'none';
        el('btnMedusaNext').style.display = 'none';
      } else if (m.phase === 'revealed') {
        el('medusaProgress').style.display = 'none';
        el('medusaReveal').style.display = 'block';
        const rev = m.lastReveal;
        if (!rev || rev.pairs.length === 0) {
          el('medusaReveal').innerHTML = `<div class="gamble-result tie">No eye contact.</div>`;
        } else {
          const rows = rev.pairs.map(([a, b]) => {
            const pa = state.players.find(p => p.id === a);
            const pb = state.players.find(p => p.id === b);
            return `<div>${pa ? pa.name : '?'} ↔ ${pb ? pb.name : '?'}</div>`;
          }).join('');
          el('medusaReveal').innerHTML = `
            <div class="gamble-result lose">
              ${rows}
              <div style="margin-top:6px;">${rev.shotsConsumed} shot(s) consumed. ${m.shotsRemaining} left.</div>
            </div>
          `;
        }
        el('btnMedusaNext').style.display = 'block';
      } else if (m.phase === 'done') {
        el('medusaProgress').style.display = 'none';
        el('medusaReveal').style.display = 'block';
        el('medusaReveal').innerHTML = `<div class="gamble-result win">Medusa complete.</div>`;
        el('btnMedusaNext').style.display = 'none';
      }
    } else {
      el('medusaPanel').style.display = 'none';
    }

    if (isRps) {
      const rps = r.rps;
      el('rpsPanel').style.display = 'block';
      const lander = state.players.find(pp => pp.id === rps.landerId);
      el('rpsInfo').textContent = `${lander ? lander.name : '?'} challenges ${rps.participants.length - 1} opponent(s).`;
      if (rps.phase === 'picking') {
        el('rpsProgress').style.display = 'block';
        el('rpsProgress').textContent = `${Object.keys(rps.picks).length} / ${rps.participants.length} picked. See each player row for throw controls.`;
        el('rpsResult').style.display = 'none';
        el('btnRpsDone').style.display = 'none';
      } else {
        el('rpsProgress').style.display = 'none';
        el('rpsResult').style.display = 'block';
        const res = rps.result;
        const rows = Object.entries(res.opponents).map(([oid, othrow]) => {
          const op = state.players.find(pp => pp.id === oid);
          const outcome = rpsBeats(res.landerThrow, othrow) ? 'WIN'
                        : rpsBeats(othrow, res.landerThrow) ? 'LOSE' : 'TIE';
          return `<div>${op ? op.name : '?'} threw ${othrow} → <b>${outcome}</b></div>`;
        }).join('');
        el('rpsResult').className = 'gamble-result ' + (res.success ? 'win' : 'lose');
        el('rpsResult').innerHTML = `
          <div>${lander ? lander.name : '?'} threw <b>${res.landerThrow}</b>.</div>
          ${rows}
          <div style="margin-top:6px;">Wins ${res.wins} · needed ${res.needToWin} → <b>${res.success ? 'SUCCESS' : 'FAIL'}</b></div>
        `;
        el('btnRpsDone').style.display = 'block';
      }
    } else {
      el('rpsPanel').style.display = 'none';
    }

    if (isJizz) renderJizzLocal(r); else el('jizzPanel').style.display = 'none';
    if (isSong) renderSongLocal(r); else el('songPanel').style.display = 'none';

    if (isBuyout) {
      el('buyoutPanel').style.display = 'block';
      const info = el('buyoutInfo');
      const btnAccept = el('btnBuyoutAccept');
      const btnBuyout = el('btnBuyoutPay');
      const result = el('buyoutResult');

      if (r.buyout.phase === 'choosing') {
        info.style.display = 'block';
        info.textContent = `Choose: accept the punishment or buy out.`;
        btnAccept.style.display = 'block';
        btnBuyout.style.display = 'block';
        result.style.display = 'none';
        btnAccept.disabled = false;
        const ownerP = state.players.find(pp => pp.id === r.buyout.playerId);
        const canAfford = ownerP && ownerP.gold >= r.buyout.cost;
        btnBuyout.disabled = !canAfford;
        btnBuyout.textContent = canAfford
          ? `Buy-out (${r.buyout.cost} gold)`
          : `Buy-out (need ${r.buyout.cost} gold)`;
      } else {
        info.style.display = 'none';
        btnAccept.style.display = 'none';
        btnBuyout.style.display = 'none';
        result.style.display = 'block';
        if (r.buyout.choice === 'buyout') {
          result.className = 'gamble-result tie';
          result.textContent = `Bought out for ${r.buyout.cost} gold.`;
        } else {
          result.className = 'gamble-result lose';
          result.textContent = `Accepted the punishment.`;
        }
      }
    } else {
      el('buyoutPanel').style.display = 'none';
    }

    const blockedByGamble   = isGamble   && r.gamble.phase === 'choosing';
    const blockedByMedusa   = isMedusa   && r.medusa.phase !== 'done';
    const blockedByBuyout   = isBuyout   && r.buyout.phase !== 'done';
    const blockedByMakerule = isMakerule && r.makerule.isOdd && r.makerule.phase === 'choosing';
    const blockedByViking   = isViking   && r.viking.phase !== 'done';
    const blockedByBuddy    = isDrinkingBuddy && r.drinkingBuddy.phase === 'picking';
    const blockedByRps      = isRps;
    const blockedByWhisper  = isWhisper  && r.whisper.phase !== 'done';
    const blockedByJizz     = isJizz;
    const blockedBySong     = isSong;

    const blocked = blockedByGamble || blockedByMedusa
                 || blockedByBuyout || blockedByMakerule
                 || blockedByViking || blockedByBuddy
                 || blockedByRps    || blockedByWhisper
                 || blockedByJizz   || blockedBySong;

    const hideResolve = isRps || isJizz || isSong || ownEndgameInfoRule;
    el('btnResolveRule').style.display = hideResolve ? 'none' : 'block';
    el('btnResolveRule').disabled = blocked;
  } else {
    el('rulePanel').style.display = 'none';
  }

  const vp = el('vplayers');
  vp.innerHTML = '';
  for (const p of state.players) {
    const row = document.createElement('div');
    row.className = 'player-row' + (p.id === cpId ? ' current' : '');

    const dot = document.createElement('div');
    dot.className = 'player-dot';
    dot.style.background = p.color;

    const onBreak = state.breakLock && state.breakLock.arrived.includes(p.id);
    const info = document.createElement('div');
    info.innerHTML = `<b>${p.name}</b>${p.finished ? ' 🏁' : ''}${onBreak ? ' 🛑' : ''}${inEndgameZone(p) ? ' ⚔️' : ''}${tokenBadges(p)}<div class="meta">tile ${p.position} · ${p.gold}g${p.toiletCards ? ' · 🚽'+p.toiletCards : ''} · 🍺 ${fmtSips(p.totalSips)}</div>`;

    row.appendChild(dot);
    row.appendChild(info);

    const actions = document.createElement('div');
    actions.style.marginLeft = 'auto';
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.flexWrap = 'wrap';
    actions.style.alignItems = 'center';

    if (state.roundPhase === 'roll-off') {
      const isCandidate = !state.rollOffCandidates || state.rollOffCandidates.includes(p.id);
      const b = document.createElement('button');
      if (!isCandidate) {
        b.textContent = '🚫 Eliminated';
        b.disabled = true;
        b.className = 'secondary';
        b.style.opacity = '0.4';
      } else {
        b.textContent = state.rollOff[p.id] !== undefined ? `Rolled ${state.rollOff[p.id]}` : 'Roll-off';
        b.disabled = state.rollOff[p.id] !== undefined;
        b.onclick = () => socket.emit('player:rollOff', { code: state.code, playerId: p.id });
      }
      actions.appendChild(b);
    } else if (state.roundPhase === 'order-selection' && state.orderChooserId === p.id) {
      const b1 = document.createElement('button');
      b1.textContent = 'First';
      b1.className = 'good';
      b1.onclick = () => socket.emit('player:chooseOrder', { code: state.code, playerId: p.id, choice: 'first' });
      const b2 = document.createElement('button');
      b2.textContent = 'Last';
      b2.className = 'secondary';
      b2.onclick = () => socket.emit('player:chooseOrder', { code: state.code, playerId: p.id, choice: 'last' });
      actions.appendChild(b1); actions.appendChild(b2);
    } else if (state.roundPhase === 'playing' && p.id === cpId && (!state.activeRule || ownEndgameInfoRule)) {
      if (inEndgameZone(p)) {
        const eg = state.endgameMinigames && state.endgameMinigames[p.position];
        if (eg === 'rps') {
          const br = document.createElement('button');
          br.textContent = '⚔️ RPS';
          br.className = 'good';
          br.onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: p.id, action: 'rps-start' });
          actions.appendChild(br);
        } else if (eg === 'jizz') {
          const br = document.createElement('button');
          br.textContent = '🎵 Jizz Tournament';
          br.className = 'good';
          br.onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: p.id, action: 'jizz-start' });
          actions.appendChild(br);
        } else if (eg === 'song') {
          const br = document.createElement('button');
          br.textContent = '🎵 Guess the Song';
          br.className = 'good';
          br.onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: p.id, action: 'song-start' });
          actions.appendChild(br);
        } else if (p.position === 99) {
          const br = document.createElement('button');
          br.textContent = '🎲 Roll to Finish';
          br.className = 'good';
          br.onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: p.id, action: 'roll' });
          actions.appendChild(br);
        } else {
          const bS = document.createElement('button');
          bS.textContent = '✔ Success';
          bS.className = 'good';
          bS.onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: p.id, action: 'success' });
          const bF = document.createElement('button');
          bF.textContent = '✖ Fail';
          bF.className = 'danger';
          bF.onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: p.id, action: 'fail' });
          actions.appendChild(bS); actions.appendChild(bF);
        }
      } else {
        const b = document.createElement('button');
        b.textContent = onBreak ? 'Waiting…' : 'Roll';
        b.className = 'good';
        b.disabled = !!onBreak;
        b.onclick = () => socket.emit('player:roll', { code: state.code, playerId: p.id });
        actions.appendChild(b);
      }
    }

    if (state.activeRule && state.activeRule.medusa) {
      const m = state.activeRule.medusa;
      if (m.phase === 'picking' && m.participants.includes(p.id) && m.picks[p.id] === undefined) {
        const sel = makeMedusaSelect(p.id, state, m);
        actions.appendChild(sel);
      } else if (m.phase === 'picking' && m.participants.includes(p.id) && m.picks[p.id] !== undefined) {
        const chosen = state.players.find(pp => pp.id === m.picks[p.id]);
        const tag = document.createElement('span');
        tag.textContent = `→ ${chosen ? chosen.name : '?'}`;
        tag.style.color = '#98a3b3';
        tag.style.fontSize = '12px';
        actions.appendChild(tag);
      }
    }

    if (state.activeRule && state.activeRule.rps) {
      const rps = state.activeRule.rps;
      if (rps.phase === 'picking' && rps.participants.includes(p.id) && rps.picks[p.id] === undefined) {
        const sel = makeRpsSelect(p.id);
        actions.appendChild(sel);
      } else if (rps.phase === 'picking' && rps.participants.includes(p.id) && rps.picks[p.id] !== undefined) {
        const tag = document.createElement('span');
        tag.textContent = `→ ${rps.picks[p.id]}`;
        tag.style.color = '#98a3b3';
        tag.style.fontSize = '12px';
        actions.appendChild(tag);
      }
    }

    if (state.activeRule && state.activeRule.drinkingBuddy
        && state.activeRule.drinkingBuddy.phase === 'picking'
        && state.activeRule.drinkingBuddy.participants.includes(p.id)) {
      const db = state.activeRule.drinkingBuddy;
      const bb = document.createElement('button');
      bb.textContent = '🤝 Buddy';
      bb.className = 'good';
      bb.onclick = () => socket.emit('player:drinkingBuddyPick', {
        code: state.code, playerId: db.landerId, buddyId: p.id,
      });
      actions.appendChild(bb);
    }

    if (state.betGame && state.betGame.playerIds.includes(p.id)) {
      const bidVal = state.betGame.bids[p.id];
      const bidSelect = makeBidSelect(bidVal !== undefined ? bidVal : 10);
      const bb = document.createElement('button');
      bb.textContent = bidVal !== undefined ? `Bid ✓ ${bidVal}%` : 'Bid';
      bb.disabled = bidVal !== undefined;
      bb.onclick = () => socket.emit('bet:bid', { code: state.code, playerId: p.id, bid: Number(bidSelect.value) });
      actions.appendChild(bidSelect);
      actions.appendChild(bb);
    }

    if (p.toiletCards > 0) {
      const tb = document.createElement('button');
      tb.textContent = '🚽';
      tb.className = 'secondary';
      tb.title = 'Use toilet card';
      tb.onclick = () => socket.emit('player:useToilet', { code: state.code, playerId: p.id });
      actions.appendChild(tb);
    }

    row.appendChild(actions);
    vp.appendChild(row);
  }

  const lg = el('log');
  lg.innerHTML = '';
  for (const entry of state.log) {
    const d = document.createElement('div');
    d.textContent = entry.msg;
    lg.appendChild(d);
  }

  const focus = document.activeElement;
  const set = (id, v) => { if (el(id) !== focus) el(id).value = v; };
  set('s_gold', state.settings.startGold);
  set('s_timer', state.settings.turnTimer);
  set('s_timerAction', state.settings.timerAction);
  set('s_allowDrinksOnBreak', String(state.settings.allowDrinksOnBreak));
  set('s_rollSpinMs', state.settings.rollSpinMs || 2000);
  set('s_rollResultMs', state.settings.rollResultMs || 3500);
  set('s_punishment', state.settings.punishment);

  // --- Adjust-sips panel: keep the player dropdown in sync ---
  const adjSel = el('adjPlayer');
  if (adjSel) {
    const cur = adjSel.value;
    adjSel.innerHTML = '';
    for (const pp of state.players) {
      const opt = document.createElement('option');
      opt.value = pp.id;
      opt.textContent = `${pp.name} — ${fmtSips(pp.totalSips)}`;
      adjSel.appendChild(opt);
    }
    if (cur && state.players.some(pp => pp.id === cur)) adjSel.value = cur;
  }
}

el('btnStart').onclick = () => socket.emit('host:start', { code });
el('btnPause').onclick = () => socket.emit('host:pause', { code, reason: 'Host paused' });
el('btnResume').onclick = () => socket.emit('host:resume', { code });
el('btnSkip').onclick = () => socket.emit('host:skipTurn', { code });
el('btnResolveRule').onclick = () => socket.emit('host:resolveRule', { code });
el('btnMedusaNext').onclick = () => socket.emit('player:medusaNext', { code });
el('btnMedusaEnd').onclick = () => socket.emit('host:medusaEnd', { code });
el('btnRpsDone').onclick = () => {
  const cp = state && state.turnOrder && state.turnOrder[state.currentTurnIndex];
  if (!cp) return;
  socket.emit('player:endgameAction', { code: state.code, playerId: cp, action: 'rps-done' });
};
el('btnJizzContinue').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.jizz) return;
  socket.emit('player:endgameAction', { code: state.code, playerId: r.playerId, action: 'jizz-done' });
};
el('btnSongWrong').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.song) return;
  socket.emit('player:endgameAction', { code: state.code, playerId: r.playerId, action: 'song-wrong' });
};
el('btnSongCorrect').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.song) return;
  socket.emit('player:endgameAction', { code: state.code, playerId: r.playerId, action: 'song-correct' });
};
el('btnMakeruleSubmit').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.makerule) return;
  const text = (el('makeruleInput').value || '').trim();
  if (!text) return;
  socket.emit('player:makeruleSubmit', { code: state.code, playerId: r.playerId, text });
};
el('btnBuyoutAccept').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.buyout) return;
  socket.emit('player:buyoutChoice', { code: state.code, playerId: r.buyout.playerId, choice: 'accept' });
};
el('btnBuyoutPay').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.buyout) return;
  socket.emit('player:buyoutChoice', { code: state.code, playerId: r.buyout.playerId, choice: 'buyout' });
};
el('btnStrawStart').onclick = () => socket.emit('player:strawStart', { code });
el('btnStrawReset').onclick = () => socket.emit('player:strawReset', { code });

el('btnWhisperSubmit').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.whisper) return;
  const w = r.whisper;
  if (w.phase !== 'r1' && w.phase !== 'r2') return;
  const sel = document.getElementById('whisperPlayerSelect');
  if (!sel || !sel.value) return;
  const text = (el('whisperInput').value || '').trim();
  if (!text) return;
  socket.emit('player:whisperSubmit', { code: state.code, playerId: sel.value, text });
  el('whisperInput').value = '';
};
el('btnWhisperForce').onclick = () => socket.emit('host:whisperForceAdvance', { code });

el('btnAuctionBid').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.auction) return;
  const a = r.auction;
  if (a.phase !== 'bidding' || !a.bidders || a.bidders.length === 0) return;
  const currentId = a.bidders[a.turnIndex];
  if (!currentId) return;
  const bid = Number(el('auctionBidInput').value);
  if (!Number.isFinite(bid)) return;
  socket.emit('player:auctionBid', { code: state.code, playerId: currentId, bid });
};
el('btnAuctionPass').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.auction) return;
  const a = r.auction;
  if (a.phase !== 'bidding' || !a.bidders || a.bidders.length === 0) return;
  const currentId = a.bidders[a.turnIndex];
  if (!currentId) return;
  socket.emit('player:auctionPass', { code: state.code, playerId: currentId });
};

el('btnPlaytest').onclick = () => {
  const pw = prompt('Enter play-test password:');
  if (pw == null) return;
  socket.emit('host:enablePlaytest', { code, password: pw });
};
el('btnPlaytestOff').onclick = () => {
  socket.emit('host:disablePlaytest', { code });
};

el('btnReloadRules').onclick = () => socket.emit('host:reloadRules', { code });
el('btnSaveSettings').onclick = () => {
  socket.emit('host:settings', {
    code,
    settings: {
      startGold: Number(el('s_gold').value),
      turnTimer: Number(el('s_timer').value),
      timerAction: el('s_timerAction').value,
      allowDrinksOnBreak: el('s_allowDrinksOnBreak').value === 'true',
      punishment: el('s_punishment').value,
      rollSpinMs: Number(el('s_rollSpinMs').value) || 2000,
      rollResultMs: Number(el('s_rollResultMs').value) || 3500,
    },
  });
};
el('btnShowRules').onclick = () => {
  el('rulesOverlay').style.display = 'block';
  setRefTab('tiles');
  if (!rulesData) socket.emit('host:getRules', { code });
};
el('btnReference').onclick = () => {
  el('rulesOverlay').style.display = 'block';
  setRefTab('common');
  if (!rulesData) socket.emit('host:getRules', { code });
};

document.querySelectorAll('.ref-overlay-tab').forEach(b => {
  b.onclick = () => setRefTab(b.dataset.reftab);
});
el('btnCloseRules').onclick = () => { el('rulesOverlay').style.display = 'none'; };
el('btnReloadRulesOverlay').onclick = () => socket.emit('host:reloadRules', { code });

// --- Adjust-sips handlers ---
el('btnAdjustAdd').onclick = () => {
  const pid = el('adjPlayer').value;
  const amt = Number(el('adjAmount').value) || 0;
  if (!pid || !amt) return;
  socket.emit('player:adjustSips', { code, playerId: pid, delta: amt });
};
el('btnAdjustRemove').onclick = () => {
  const pid = el('adjPlayer').value;
  const amt = Number(el('adjAmount').value) || 0;
  if (!pid || !amt) return;
  socket.emit('player:adjustSips', { code, playerId: pid, delta: -amt });
};