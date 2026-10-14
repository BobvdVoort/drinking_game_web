const socket = io();
let state = null;
let myId = null;
let _pendingJoin = null;

const el = (id) => document.getElementById(id);

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
const ENDGAME_FIRST = 96;
const ML_PER_SIP = 30;
const METER_MAX_LITERS = 10;

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

function renderDrunkMeter(totalSips) {
  const liters = ((Number(totalSips) || 0) * ML_PER_SIP) / 1000;
  const pct = Math.max(0, Math.min(100, (liters / METER_MAX_LITERS) * 100));
  return `
    <div class="drunk-meter">
      <div class="drunk-meter-icons">
        <span class="icon sober" title="Sober">😁</span>
        <span class="icon wasted" title="Wasted">😵‍💫</span>
      </div>
      <div class="drunk-meter-track">
        <div class="drunk-meter-fill" style="--fill-pct:${pct}%;">
          <div class="drunk-meter-foam"></div>
          <div class="drunk-meter-bubbles">
            <span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span>
          </div>
        </div>
      </div>
      <div class="drunk-meter-label">🍺 Total drunk: ${fmtSips(totalSips)} / 10L</div>
    </div>
  `;
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

function rpsBeats(a, b) {
  return (a === 'rock' && b === 'scissors')
      || (a === 'scissors' && b === 'paper')
      || (a === 'paper' && b === 'rock');
}

(function buildBidOptions() {
  const sel = el('bidInput');
  for (let v = 10; v <= 100; v += 10) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = `${v}%`;
    sel.appendChild(opt);
  }
})();

function getOrCreatePlayerId() {
  let id = localStorage.getItem('dbg_playerId');
  if (!id || !/^p-[a-z0-9-]+$/i.test(id)) {
    id = 'p-' + Date.now().toString(36) + '-' +
         Math.random().toString(36).slice(2, 10) +
         Math.random().toString(36).slice(2, 10);
    localStorage.setItem('dbg_playerId', id);
  }
  return id;
}

function showJoinPanel(errMsg) {
  el('joinPanel').style.display = 'block';
  el('gamePanel').style.display = 'none';
  if (errMsg) {
    el('joinError').style.display = 'block';
    el('joinError').textContent = errMsg;
  } else {
    el('joinError').style.display = 'none';
  }
}

function showGamePanel() {
  el('joinPanel').style.display = 'none';
  el('gamePanel').style.display = 'block';
  el('joinError').style.display = 'none';
}

function tryJoin(code, name, password) {
  _pendingJoin = { code, name, password };
  const playerId = getOrCreatePlayerId();
  socket.emit('player:join', { code, name, playerId, password: password || '' });
}

el('btnJoin').onclick = () => {
  const code = el('in_code').value.trim().toUpperCase();
  const name = el('in_name').value.trim() || 'Player';
  const password = (el('in_password').value || '').trim();
  if (!code) {
    showJoinPanel('Enter a room code.');
    return;
  }
  tryJoin(code, name, password);
};

el('btnLeave').onclick = () => {
  if (!confirm('Leave the current room?')) return;
  localStorage.removeItem('dbg_code');
  localStorage.removeItem('dbg_name');
  localStorage.removeItem('dbg_password');
  localStorage.removeItem('dbg_playerId');
  window.location.reload();
};

['in_code', 'in_name', 'in_password'].forEach(id => {
  const input = el(id);
  if (!input) return;
  input.addEventListener('input', () => {
    el('joinError').style.display = 'none';
  });
});

socket.on('player:joinResult', (res) => {
  if (res.error) {
    showJoinPanel(res.error);
    _pendingJoin = null;
    return;
  }
  myId = res.playerId;
  const code = (_pendingJoin && _pendingJoin.code) || el('in_code').value.trim().toUpperCase();
  const name = (_pendingJoin && _pendingJoin.name) || el('in_name').value.trim() || 'Player';
  const password = (_pendingJoin && _pendingJoin.password) || (el('in_password').value || '').trim();
  localStorage.setItem('dbg_code', code);
  localStorage.setItem('dbg_name', name);
  localStorage.setItem('dbg_password', password);
  el('roomCodeDisplay').textContent = code;
  _pendingJoin = null;
  showGamePanel();
  if (state) render();
});

socket.on('connect', () => {
  const savedCode = localStorage.getItem('dbg_code') || '';
  const savedName = localStorage.getItem('dbg_name') || '';
  const savedPassword = localStorage.getItem('dbg_password') || '';
  if (savedCode) el('in_code').value = savedCode;
  if (savedName) el('in_name').value = savedName;
  if (savedPassword && el('in_password')) el('in_password').value = savedPassword;

  if (savedCode && savedName) {
    tryJoin(savedCode, savedName, savedPassword);
  } else {
    showJoinPanel();
  }
});

socket.on('disconnect', () => {
  console.log('Socket disconnected.');
});

socket.on('state', (s) => { state = s; render(); });

function me() { return state && myId && state.players.find(p => p.id === myId); }
function isMyTurn() { return state && state.turnOrder[state.currentTurnIndex] === myId; }
function inEndgameZone(p) { return p && p.position >= ENDGAME_FIRST && p.position <= 99; }

function renderMakerule(r, isMine) {
  const m = r.makerule;
  el('makerulePanel').style.display = 'block';
  const info = el('makeruleInfo');
  if (m.isOdd) {
    if (m.phase === 'choosing') {
      info.innerHTML = `<div class="roll-result">Rolled ${m.roll} — ODD</div><div>Make a rule!</div>`;
    } else {
      info.innerHTML = `<div class="roll-result">Rule made</div><div>"${esc(m.submittedText || '')}"</div>`;
    }
  } else {
    info.innerHTML = `<div class="roll-result">Rolled ${m.roll} — EVEN</div><div>Drink 3 sips.</div>`;
  }

  const inputWrap = el('makeruleInputWrap');
  const input = el('makeruleInput');
  const submitBtn = el('btnMakeruleSubmit');

  if (m.isOdd && m.phase === 'choosing' && isMine) {
    inputWrap.style.display = 'block';
    input.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Rule';
  } else if (m.isOdd && m.phase === 'choosing') {
    inputWrap.style.display = 'block';
    input.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Waiting for player…';
  } else {
    inputWrap.style.display = 'none';
  }
}

function renderOddEven(r) {
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
}

function renderSwapSeats(r) {
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
}

function renderViking(r, canPick) {
  const v = r.viking;
  el('vikingPanel').style.display = 'block';
  const played = v.history.length;
  const round = Math.min(played + 1, v.maxRounds);
  const isDone = v.phase === 'done';

  el('vikingInfo').textContent = isDone
    ? `🛡 Viking complete — ${v.maxRounds} rounds played. Total below.`
    : `🛡 Round ${round} of ${v.maxRounds} — loser drinks ${v.sipsPerLoss} sips.`;

  const picker = el('vikingPicker');
  const wrap = el('vikingLosers');
  wrap.innerHTML = '';

  if (!isDone && canPick) {
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
}

function renderStraw(r) {
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
}

let _whisperLastRound = null;

function renderWhisper(r, isMine) {
  const w = r.whisper;
  el('whisperPanel').style.display = 'block';
  const info = el('whisperInfo');
  const inputWrap = el('whisperInputWrap');
  const prompt = el('whisperPrompt');
  const input = el('whisperInput');
  const list = el('whisperList');
  const forceBtn = el('btnWhisperForce');
  if (forceBtn) forceBtn.style.display = 'none';

  const isParticipant = w.participants.includes(myId);
  const round = w.phase === 'r1' ? 'r1' : (w.phase === 'r2' ? 'r2' : null);
  const roundLabel = round === 'r1' ? 'Round 1' : (round === 'r2' ? 'Round 2' : 'Done');

  if (!isParticipant) {
    info.textContent = `🤫 Whisper — ${roundLabel}. You are spectating this round.`;
    info.className = 'banner';
    inputWrap.style.display = 'none';
  } else if (round) {
    info.textContent = `🤫 Whisper — ${roundLabel}. Submit the question your right neighbour asked you.`;
    info.className = 'banner warn';
    const submitted = (w.questions[myId] || {})[round];
    if (submitted) {
      inputWrap.style.display = 'none';
    } else {
      inputWrap.style.display = 'block';
      prompt.textContent = `Your question for ${roundLabel}:`;
      if (_whisperLastRound !== round) {
        input.value = '';
        _whisperLastRound = round;
      }
    }
  } else {
    info.textContent = '🤫 Whisper complete.';
    info.className = 'banner good';
    inputWrap.style.display = 'none';
    _whisperLastRound = null;
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

function renderAuction(r) {
  const a = r.auction;
  el('auctionPanel').style.display = 'block';
  const info = el('auctionInfo');
  const bidWrap = el('auctionBidWrap');
  const prompt = el('auctionPrompt');
  const input = el('auctionBidInput');
  const hist = el('auctionHistory');

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
    const winner    = a.currentWinner
      ? state.players.find(p => p.id === a.currentWinner)
      : null;
    const bidStr = winner
      ? `Lowest bid: ${a.currentBid}g (${winner.name})`
      : `Starting at 3.5g — no bids yet`;
    info.textContent =
      `🔨 Shot ${shot} of ${a.maxShots} — auctioneer: ${a.auctioneerName}. ${bidStr}.`;
    info.className = 'banner warn';

    const amICurrent = currentId === myId;
    bidWrap.style.display = amICurrent ? 'block' : 'none';
    if (amICurrent) {
      const floor = 0.5;
      const ceiling = a.currentBid > floor ? a.currentBid - 0.5 : floor;
      prompt.textContent = `Your turn — bid the gold you'll receive for drinking the shot (between ${floor}g and ${ceiling}g), or pass.`;
      input.min = String(floor);
      input.max = String(ceiling);
      const cur = Number(input.value);
      if (!input.value || !Number.isFinite(cur) || cur > ceiling || cur < floor) {
        input.value = String(ceiling);
      }
    }
  }

  const rows = a.history.map(h => h.winnerName
    ? `<div>Shot ${h.shot}: <b>${esc(h.winnerName)}</b> — drinks for ${h.price}g</div>`
    : `<div>Shot ${h.shot}: no winner</div>`
  ).join('') || '<div style="color:#98a3b3;">No shots resolved yet.</div>';
  hist.innerHTML = `<div class="roll-result">History</div>${rows}`;
}

function renderJizzDie(r) {
  el('jizzDiePanel').style.display = 'block';
  const jd = r.jizzDie;
  const info = el('jizzDieInfo');
  info.innerHTML =
    `<div class="roll-result">🎲 Rolled ${jd.roll}</div>` +
    `<div>Play Jizz — the loser drinks <b>${jd.roll} sips</b>.</div>`;
}

function renderDrinkingBuddy(r, isMine) {
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
    result.style.display = 'none';
    if (isMine) {
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
    } else {
      picker.style.display = 'none';
    }
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
}

function renderMedusa(r, isMine) {
  const m = r.medusa;
  el('medusaPanel').style.display = 'block';
  const isParticipant = m.participants.includes(myId);
  const myPick = m.picks[myId];

  if (m.phase === 'picking') {
    el('medusaInfo').textContent = `Round ${m.round} — ${m.shotsRemaining} of ${m.shotsTotal} shot(s) left.`;
    el('medusaReveal').style.display = 'none';
    el('btnMedusaNext').style.display = 'none';

    if (!isParticipant) {
      el('medusaProgress').style.display = 'block';
      el('medusaProgress').textContent = `Watching — ${Object.keys(m.picks).length} / ${m.participants.length} picked.`;
      el('medusaPicks').style.display = 'none';
    } else if (myPick === undefined) {
      el('medusaProgress').style.display = 'none';
      el('medusaPicks').style.display = 'block';
      const wrap = el('medusaTargets');
      wrap.innerHTML = '';
      for (const pid of m.participants) {
        if (pid === myId) continue;
        const p = state.players.find(pp => pp.id === pid);
        if (!p) continue;
        const b = document.createElement('button');
        b.textContent = p.name;
        b.style.background = p.color;
        b.style.color = '#fff';
        b.onclick = () => socket.emit('player:medusaPick', { code: state.code, playerId: myId, targetId: pid });
        wrap.appendChild(b);
      }
    } else {
      el('medusaPicks').style.display = 'none';
      el('medusaProgress').style.display = 'block';
      const chosen = state.players.find(pp => pp.id === myPick);
      el('medusaProgress').textContent = `You picked ${chosen ? chosen.name : '…'}. Waiting for others (${Object.keys(m.picks).length} / ${m.participants.length}).`;
    }
  } else if (m.phase === 'revealed') {
    el('medusaPicks').style.display = 'none';
    el('medusaProgress').style.display = 'none';
    el('medusaReveal').style.display = 'block';
    const rev = m.lastReveal;
    if (!rev || rev.pairs.length === 0) {
      el('medusaReveal').innerHTML = `<div class="gamble-result tie">No eye contact this round — no shots consumed.</div>`;
    } else {
      const rows = rev.pairs.map(([a, b]) => {
        const pa = state.players.find(p => p.id === a);
        const pb = state.players.find(p => p.id === b);
        return `<div>${pa ? pa.name : '?'} ↔ ${pb ? pb.name : '?'}</div>`;
      }).join('');
      el('medusaReveal').innerHTML = `
        <div class="gamble-result lose">
          ${rows}
          <div style="margin-top:6px;">${rev.shotsConsumed} shot(s) consumed. ${m.shotsRemaining} of ${m.shotsTotal} left.</div>
        </div>
      `;
    }
    el('btnMedusaNext').style.display = 'block';
    el('btnMedusaNext').textContent = m.shotsRemaining > 0 ? 'Next Round' : 'Finish';
  } else if (m.phase === 'done') {
    el('medusaPicks').style.display = 'none';
    el('medusaProgress').style.display = 'none';
    el('medusaReveal').style.display = 'block';
    el('medusaReveal').innerHTML = `<div class="gamble-result win">All ${m.shotsTotal} shots are gone. Medusa complete!</div>`;
    el('btnMedusaNext').style.display = 'none';
  }
}

function renderRps(r, isMine) {
  const rps = r.rps;
  el('rpsPanel').style.display = 'block';
  const isParticipant = rps.participants.includes(myId);
  const isLander = rps.landerId === myId;
  const lander = state.players.find(pp => pp.id === rps.landerId);
  const myThrow = rps.picks[myId];

  el('rpsInfo').textContent = isLander
    ? `You challenge ${rps.participants.length - 1} opponent(s).`
    : `${lander ? lander.name : '?'} challenges you.`;

  if (rps.phase === 'picking') {
    el('rpsResult').style.display = 'none';
    el('btnRpsDone').style.display = 'none';
    if (!isParticipant) {
      el('rpsProgress').style.display = 'block';
      el('rpsProgress').textContent =
        `Watching — ${Object.keys(rps.picks).length} / ${rps.participants.length} picked.`;
      el('rpsPicks').style.display = 'none';
    } else if (myThrow === undefined) {
      el('rpsProgress').style.display = 'none';
      el('rpsPicks').style.display = 'block';
    } else {
      el('rpsPicks').style.display = 'none';
      el('rpsProgress').style.display = 'block';
      el('rpsProgress').textContent =
        `You picked ${myThrow}. Waiting for others (${Object.keys(rps.picks).length} / ${rps.participants.length}).`;
    }
  } else {
    el('rpsPicks').style.display = 'none';
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
      <div style="margin-top:6px;">
        Wins ${res.wins} / ${res.opponents ? Object.keys(res.opponents).length : 0}
        &nbsp;·&nbsp; needed ${res.needToWin}
        &nbsp;→&nbsp; <b>${res.success ? 'SUCCESS — advance!' : 'FAIL — stay.'}</b>
      </div>
    `;
    if (isMine) el('btnRpsDone').style.display = 'block';
  }
}

function renderJizz(r, isMine) {
  const j = r.jizz;
  el('jizzPanel').style.display = 'block';
  const info = el('jizzInfo');
  const status = el('jizzStatus');
  const continueBtn = el('btnJizzContinue');

  const elimLines = j.history.map(h =>
    `<div>R${h.round}: <b>${esc(h.loserName)}</b> out — ${h.sips} sips${h.isFinale ? ' 🥃 shot' : ''}</div>`
  ).join('');

  if (j.phase === 'picking') {
    const round = j.history.length + 1;
    info.textContent = `🎵 Jizz Tournament — Round ${round} of ${j.maxRounds} (sudden death)`;
    info.className = 'banner warn';

    const aliveNames = j.active.map(pid => {
      const p = state.players.find(pp => pp.id === pid);
      return p ? p.name : '?';
    }).join(', ');

    const myStatus = isMine
      ? (j.active.includes(myId) ? "You're still in!" : "You've been eliminated.")
      : '';

    status.innerHTML =
      `<div class="roll-result">Still in: ${esc(aliveNames)}</div>` +
      `<div style="font-size:13px;color:#98a3b3;margin-top:6px;">Waiting for host to record the loser…</div>` +
      (elimLines ? `<div style="margin-top:8px;">${elimLines}</div>` : '') +
      (myStatus ? `<div style="margin-top:8px;color:#fbbf24;">${myStatus}</div>` : '');

    if (continueBtn) continueBtn.style.display = 'none';
  } else {
    info.textContent = '🏆 Jizz Tournament complete.';
    info.className = 'banner good';

    const eliminatedEarly = j.history.some(h => h.loserId === r.playerId && !h.isFinale);
    const passed = !eliminatedEarly;

    const winnerId = j.active[0];
    const winnerP = state.players.find(p => p.id === winnerId);
    const winnerName = winnerP ? winnerP.name : '?';

    status.innerHTML =
      `<div class="roll-result">Winner: ${esc(winnerName)}</div>` +
      (elimLines ? `<div style="margin-top:8px;">${elimLines}</div>` : '') +
      `<div style="margin-top:8px;color:${passed ? '#bbf7d0' : '#fecaca'};">` +
        (passed ? '🏆 You made top 2!' : '😢 You were eliminated before the finale.') +
      `</div>`;

    if (continueBtn) {
      continueBtn.style.display = isMine ? 'block' : 'none';
      continueBtn.textContent = passed ? 'Continue to tile 98' : 'Continue (stay on 97)';
    }
  }
}

function renderSong(r, isMine) {
  const s = r.song;
  el('songPanel').style.display = 'block';
  const info = el('songInfo');
  const status = el('songStatus');
  const wrongBtn = el('btnSongWrong');
  const correctBtn = el('btnSongCorrect');

  const remaining = s.maxGuesses - s.wrongGuesses;
  info.textContent = `🎵 Guess the Song — ${remaining} guess${remaining === 1 ? '' : 'es'} left (${s.wrongGuesses}/${s.maxGuesses} wrong).`;
  info.className = 'banner warn';

  status.textContent = 'Each wrong guess = half a shot. Guess right to advance to tile 99.';

  if (isMine && s.phase === 'guessing') {
    wrongBtn.style.display = 'block';
    correctBtn.style.display = 'block';
    wrongBtn.disabled = s.wrongGuesses >= s.maxGuesses;
  } else {
    wrongBtn.style.display = 'none';
    correctBtn.style.display = 'none';
  }
}

let _lastRollShown = null;
let _firstRender = true;
let _seenFinished = null;

function render() {
  if (!state || !me()) return;
  const p = me();

  if (_firstRender) {
    _lastRollShown = state.lastRoll ? state.lastRoll.at : null;
    _firstRender = false;
  } else if (state.lastRoll && state.lastRoll.at !== _lastRollShown) {
    _lastRollShown = state.lastRoll.at;
    BoardGame.showRollOverlay(state.lastRoll.rolls, {
      spinMs:   state.settings.rollSpinMs   || 1500,
      resultMs: state.settings.rollResultMs || 1000,
    });
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

  el('meInfo').innerHTML = `
    <div class="player-row">
      <div class="player-dot" style="background:${p.color}"></div>
      <div><b>${p.name}</b>${p.finished ? ' 🏁' : ''}${tokenBadges(p)}</div>
      <div class="meta">tile ${p.position} · ${p.gold}g · 🚽${p.toiletCards}${p.skipNextTurn ? ' · skip next' : ''}</div>
    </div>
    ${renderDrunkMeter(p.totalSips)}
  `;

  // Roll-off panel: kept visible for everyone. Eliminated players see a
  // disabled "Eliminated" button so they know why they can't roll.
  if (state.roundPhase === 'roll-off') {
    const isCandidate = !state.rollOffCandidates || state.rollOffCandidates.includes(myId);
    el('rollOffPanel').style.display = 'block';

    if (!isCandidate) {
      el('btnRollOff').disabled = true;
      el('btnRollOff').textContent = '🚫 Eliminated';
      el('btnRollOff').className = 'secondary big';
      el('btnRollOff').style.opacity = '0.4';
    } else {
      el('btnRollOff').className = 'good big';
      el('btnRollOff').style.opacity = '';
      el('btnRollOff').disabled = state.rollOff[myId] !== undefined;
      el('btnRollOff').textContent = state.rollOff[myId] !== undefined
        ? `Rolled ${state.rollOff[myId]}` : 'Roll-off';
    }
  } else {
    el('rollOffPanel').style.display = 'none';
  }

  el('rollPanel').style.display = state.roundPhase === 'playing' ? 'block' : 'none';

  el('orderPanel').style.display =
    (state.roundPhase === 'order-selection' && state.orderChooserId === myId) ? 'block' : 'none';

  const ownEndgameInfoRule = !!(
    state.activeRule
    && isMyTurn()
    && p.position >= 96 && p.position <= 99
    && state.activeRule.tile === p.position
    && !state.activeRule.rps && !state.activeRule.jizz && !state.activeRule.song
  );

  if (state.activeRule) {
    const r = state.activeRule;
    const owner = state.players.find(pp => pp.id === r.playerId);
    const isMine = r.playerId === myId;
    el('rulePanel').style.display = 'block';
    el('ruleTitle').textContent = `${r.rule.title} — tile ${r.tile}`;
    el('ruleText').textContent = `${owner ? owner.name : 'Player'}: ${r.rule.text}`;

    const isMakerule = !!(r.rule && r.rule.minigame === 'makerule' && r.makerule);
    if (isMakerule) renderMakerule(r, isMine);
    else el('makerulePanel').style.display = 'none';

    const isOddEven = !!(r.rule && r.rule.minigame === 'odd-or-even' && r.oddEven);
    if (isOddEven) renderOddEven(r);
    else el('oddEvenPanel').style.display = 'none';

    const isSwapSeats = !!(r.rule && r.rule.minigame === 'swap-seats' && r.swapSeats);
    if (isSwapSeats) renderSwapSeats(r);
    else el('swapSeatsPanel').style.display = 'none';

    const isViking = !!(r.rule && r.rule.minigame === 'viking' && r.viking);
    if (isViking) renderViking(r, isMine);
    else el('vikingPanel').style.display = 'none';

    const isStraw = !!(r.rule && r.rule.minigame === 'straw' && r.straw);
    if (isStraw) renderStraw(r);
    else el('strawPanel').style.display = 'none';

    const isWhisper = !!(r.rule && r.rule.minigame === 'whisper' && r.whisper);
    if (isWhisper) renderWhisper(r, isMine);
    else el('whisperPanel').style.display = 'none';

    const isAuction = !!(r.rule && r.rule.minigame === 'auction' && r.auction);
    if (isAuction) renderAuction(r);
    else el('auctionPanel').style.display = 'none';

    const isJizzDie = !!(r.rule && r.rule.minigame === 'jizz-die' && r.jizzDie);
    if (isJizzDie) renderJizzDie(r);
    else el('jizzDiePanel').style.display = 'none';

    const isJizz = !!(r.rule && r.rule.minigame === 'jizz' && r.jizz);
    if (isJizz) renderJizz(r, isMine);
    else el('jizzPanel').style.display = 'none';

    const isSong = !!(r.rule && r.rule.minigame === 'song' && r.song);
    if (isSong) renderSong(r, isMine);
    else el('songPanel').style.display = 'none';

    const isDrinkingBuddy = !!(r.rule && r.rule.minigame === 'drinking-buddy' && r.drinkingBuddy);
    if (isDrinkingBuddy) renderDrinkingBuddy(r, isMine);
    else el('drinkingBuddyPanel').style.display = 'none';

    const isGamble = !!(r.rule && r.rule.minigame === 'gamble' && r.gamble);
    if (isGamble) {
      el('gamblePanel').style.display = 'block';
      const choicesWrap = el('gambleChoices');
      const res = el('gambleResult');
      const waiting = el('gambleWaiting');
      const btns = choicesWrap.querySelectorAll('button');
      if (r.gamble.phase === 'choosing') {
        choicesWrap.style.display = 'grid';
        res.style.display = 'none';
        waiting.style.display = isMine ? 'none' : 'block';
        btns.forEach(b => {
          b.disabled = !isMine;
          b.onclick = () => socket.emit('player:gambleChoice', {
            code: state.code, playerId: myId, choice: Number(b.dataset.n),
          });
        });
      } else {
        choicesWrap.style.display = 'none';
        waiting.style.display = 'none';
        res.style.display = 'block';
        const g = r.gamble;
        if (g.outcome === 'win') {
          res.className = 'gamble-result win';
          res.textContent = `Rolled ${g.die} vs your ${g.chosen} → WIN +${g.goldDelta} gold.`;
        } else if (g.outcome === 'lose') {
          res.className = 'gamble-result lose';
          res.textContent = `Rolled ${g.die} vs your ${g.chosen} → LOSE. Drink ${g.sipsDelta} sips.`;
        } else {
          res.className = 'gamble-result lose';
          res.textContent = `Rolled ${g.die} vs your ${g.chosen} → tie. Drink ${g.sipsDelta} sips.`;
        }
      }
    } else {
      el('gamblePanel').style.display = 'none';
    }

    const isMedusa = !!(r.rule && r.rule.minigame === 'medusa' && r.medusa);
    if (isMedusa) renderMedusa(r, isMine);
    else el('medusaPanel').style.display = 'none';

    const isRps = !!(r.rule && r.rps);
    if (isRps) renderRps(r, isMine);
    else el('rpsPanel').style.display = 'none';

    const isBuyout = !!(r.rule && r.buyout);
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
        btnAccept.disabled = !isMine;
        const canAfford = p && p.gold >= r.buyout.cost;
        btnBuyout.disabled = !isMine || !canAfford;
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

    const blocked = !isMine
                 || blockedByGamble || blockedByMedusa
                 || blockedByBuyout || blockedByMakerule
                 || blockedByViking || blockedByBuddy
                 || blockedByRps    || blockedByWhisper
                 || blockedByJizz   || blockedBySong;

    const hideResolve = isRps || isJizz || isSong || ownEndgameInfoRule;
    el('btnResolveRule').style.display = hideResolve ? 'none' : 'block';
    el('btnResolveRule').disabled = blocked;
    if (isMine) {
      if (blockedByGamble)        el('btnResolveRule').textContent = 'Choose a number to continue…';
      else if (blockedByMedusa)   el('btnResolveRule').textContent = 'Medusa in progress…';
      else if (blockedByBuyout)   el('btnResolveRule').textContent = 'Choose accept or buy-out…';
      else if (blockedByMakerule) el('btnResolveRule').textContent = 'Submit your rule to continue…';
      else if (blockedByViking)   el('btnResolveRule').textContent = 'Finish the 5 Viking rounds…';
      else if (blockedByBuddy)    el('btnResolveRule').textContent = 'Pick your buddy to continue…';
      else if (blockedByWhisper)  el('btnResolveRule').textContent = 'Submit your question to continue…';
      else                        el('btnResolveRule').textContent = 'Done';
    } else {
      el('btnResolveRule').textContent = 'Waiting for player to acknowledge…';
    }
  } else {
    el('rulePanel').style.display = 'none';
  }

  if (state.roundPhase === 'playing') {
    const onBreakNow = state.breakLock && p.position === state.breakLock.tile;
    const blockedByRule = !!state.activeRule && !ownEndgameInfoRule;
    const blockedByBet  = !!state.betGame;
    const myEndgame = inEndgameZone(p) && isMyTurn();

    el('btnRoll').style.display = 'block';
    el('endgameControls').style.display = 'none';
    el('btnEndgameSuccess').style.display = 'none';
    el('btnEndgameFail').style.display = 'none';
    el('btnEndgameRoll').style.display = 'none';
    el('btnEndgameRps').style.display = 'none';
    el('btnEndgameJizz').style.display = 'none';
    el('btnEndgameSong').style.display = 'none';

    if (blockedByRule) {
      el('rollStatus').textContent = 'Resolve the tile action first…';
      el('rollStatus').className = 'banner warn';
      el('btnRoll').disabled = true;
    } else if (blockedByBet) {
      el('rollStatus').textContent = 'Bet game in progress…';
      el('rollStatus').className = 'banner warn';
      el('btnRoll').disabled = true;
    } else if (myEndgame) {
      el('btnRoll').style.display = 'none';
      el('endgameControls').style.display = 'block';
      const eg = state.endgameMinigames && state.endgameMinigames[p.position];
      if (eg === 'rps') {
        el('btnEndgameRps').style.display = 'block';
        el('rollStatus').textContent = `Endgame tile ${p.position} — attempt Rock Paper Scissors.`;
      } else if (eg === 'jizz') {
        el('btnEndgameJizz').style.display = 'block';
        el('rollStatus').textContent = `Endgame tile ${p.position} — start the Jizz Tournament.`;
      } else if (eg === 'song') {
        el('btnEndgameSong').style.display = 'block';
        el('rollStatus').textContent = `Endgame tile ${p.position} — start Guess the Song.`;
      } else if (p.position === 99) {
        el('btnEndgameRoll').style.display = 'block';
        el('rollStatus').textContent = 'Endgame tile 99 — roll to finish!';
      } else {
        el('btnEndgameSuccess').style.display = 'block';
        el('btnEndgameFail').style.display = 'block';
        el('rollStatus').textContent = `Endgame tile ${p.position} — attempt the challenge.`;
      }
      el('rollStatus').className = 'banner warn';
    } else if (inEndgameZone(p)) {
      el('rollStatus').textContent = `You're in endgame on tile ${p.position}.`;
      el('rollStatus').className = 'banner warn';
      el('btnRoll').disabled = true;
    } else if (onBreakNow) {
      const total = state.players.filter(pp => !pp.finished).length;
      const here  = state.breakLock.arrived.length;
      el('rollStatus').textContent = `On break tile ${state.breakLock.tile} — waiting (${here}/${total}).`;
      el('rollStatus').className = 'banner warn';
      el('btnRoll').disabled = true;
    } else if (isMyTurn()) {
      el('rollStatus').textContent = 'Your turn!';
      el('rollStatus').className = 'banner good';
      el('btnRoll').disabled = false;
    } else {
      const cp = state.players.find(pp => pp.id === state.turnOrder[state.currentTurnIndex]);
      el('rollStatus').textContent = cp ? `Waiting for ${cp.name}…` : 'Waiting…';
      el('rollStatus').className = 'banner';
      el('btnRoll').disabled = true;
    }
  }

  if (state.lastRoll && state.lastRoll.playerId === myId) {
    el('diceRow').textContent = state.lastRoll.rolls.join(' + ');
    el('rollDisplay').textContent = state.lastRoll.total > 0 ? `+${state.lastRoll.total}` : state.lastRoll.total;
  }

  const sel = el('buyTarget');
  const currentVal = sel.value;
  sel.innerHTML = '';
  for (const pp of state.players) {
    if (pp.id === myId) continue;
    const opt = document.createElement('option');
    opt.value = pp.id;
    opt.textContent = `${pp.name} (tile ${pp.position})`;
    sel.appendChild(opt);
  }
  if (currentVal) sel.value = currentVal;

  if (p.pendingDrink && p.pendingDrink.length) {
    el('pendingPanel').style.display = 'block';
    const list = el('pendingList');
    list.innerHTML = '';
    p.pendingDrink.forEach((d, i) => {
      const row = document.createElement('div');
      row.className = 'player-row';
      row.style.flexWrap = 'wrap';
      row.style.alignItems = 'flex-start';

      const label = document.createElement('div');
      label.style.width = '100%';
      label.style.fontSize = '14px';
      label.innerHTML = `<b>${esc(d.item)}</b> from ${esc(d.from)} — ${d.cost}g`;
      row.appendChild(label);

      const actions = document.createElement('div');
      actions.className = 'pending-actions';

      const drinkBtn = document.createElement('button');
      drinkBtn.textContent = '🍺 Drink';
      drinkBtn.className = 'good';
      drinkBtn.onclick = () => socket.emit('player:acceptDrink', {
        code: state.code, playerId: myId, index: i,
      });
      actions.appendChild(drinkBtn);

      const refuseBtn = document.createElement('button');
      refuseBtn.textContent = 'Refuse (½ to buyer)';
      refuseBtn.className = 'secondary';
      refuseBtn.onclick = () => socket.emit('player:refuseDrink', {
        code: state.code, playerId: myId, index: i,
      });
      actions.appendChild(refuseBtn);

      row.appendChild(actions);
      list.appendChild(row);
    });
  } else {
    el('pendingPanel').style.display = 'none';
  }

  if (state.betGame && state.betGame.playerIds.includes(myId)) {
    el('betPanel').style.display = 'block';
    el('betInfo').textContent = `Tile ${state.betGame.tile} — stake ${state.betGame.shots} shot(s). Bid (10–100%, multiples of 10%).`;
    el('btnBid').disabled = state.betGame.bids[myId] !== undefined;
  } else {
    el('betPanel').style.display = 'none';
  }
}

el('btnRollOff').onclick = () => socket.emit('player:rollOff', { code: state.code, playerId: myId });
el('btnRoll').onclick = () => socket.emit('player:roll', { code: state.code, playerId: myId });
el('btnEndgameSuccess').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'success' });
el('btnEndgameFail').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'fail' });
el('btnEndgameRoll').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'roll' });
el('btnEndgameRps').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'rps-start' });
el('btnEndgameJizz').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'jizz-start' });
el('btnEndgameSong').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'song-start' });
el('btnJizzContinue').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'jizz-done' });
el('btnSongWrong').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'song-wrong' });
el('btnSongCorrect').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'song-correct' });
el('btnMedusaNext').onclick = () => socket.emit('player:medusaNext', { code: state.code });
el('btnBuyoutAccept').onclick = () => socket.emit('player:buyoutChoice', { code: state.code, playerId: myId, choice: 'accept' });
el('btnBuyoutPay').onclick = () => socket.emit('player:buyoutChoice', { code: state.code, playerId: myId, choice: 'buyout' });
el('btnRpsDone').onclick = () => socket.emit('player:endgameAction', { code: state.code, playerId: myId, action: 'rps-done' });
el('btnToilet').onclick = () => socket.emit('player:useToilet', { code: state.code, playerId: myId });
el('btnAdjustAdd').onclick = () => {
  const amt = Number(el('adjAmount').value) || 0;
  if (!amt) return;
  socket.emit('player:adjustSips', { code: state.code, playerId: myId, delta: amt });
};
el('btnAdjustRemove').onclick = () => {
  const amt = Number(el('adjAmount').value) || 0;
  if (!amt) return;
  socket.emit('player:adjustSips', { code: state.code, playerId: myId, delta: -amt });
};
el('btnBid').onclick = () => {
  const bid = Number(el('bidInput').value) || 10;
  socket.emit('bet:bid', { code: state.code, playerId: myId, bid });
};
el('btnFirst').onclick = () => socket.emit('player:chooseOrder', { code: state.code, playerId: myId, choice: 'first' });
el('btnLast').onclick = () => socket.emit('player:chooseOrder', { code: state.code, playerId: myId, choice: 'last' });
el('btnResolveRule').onclick = () => socket.emit('player:resolveRule', { code: state.code });
el('btnStrawStart').onclick = () => socket.emit('player:strawStart', { code: state.code });
el('btnStrawReset').onclick = () => socket.emit('player:strawReset', { code: state.code });
el('btnWhisperSubmit').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.whisper) return;
  const text = (el('whisperInput').value || '').trim();
  if (!text) return;
  socket.emit('player:whisperSubmit', { code: state.code, playerId: myId, text });
};
el('btnAuctionBid').onclick = () => {
  const bid = Number(el('auctionBidInput').value);
  if (!Number.isFinite(bid)) return;
  socket.emit('player:auctionBid', { code: state.code, playerId: myId, bid });
};
el('btnAuctionPass').onclick = () => {
  socket.emit('player:auctionPass', { code: state.code, playerId: myId });
};

el('btnMakeruleSubmit').onclick = () => {
  const r = state && state.activeRule;
  if (!r || !r.makerule) return;
  const text = (el('makeruleInput').value || '').trim();
  if (!text) return;
  socket.emit('player:makeruleSubmit', { code: state.code, playerId: myId, text });
};

document.querySelectorAll('.rps-throw').forEach(b => {
  b.onclick = () => socket.emit('player:rpsPick', {
    code: state.code, playerId: myId, throw: b.dataset.throw,
  });
});

document.querySelectorAll('.buy').forEach(btn => {
  btn.onclick = () => {
    const item = btn.dataset.item;
    const targetId = el('buyTarget').value;
    if (!targetId && item !== 'toiletCard') return;
    socket.emit('player:buy', {
      code: state.code, buyerId: myId,
      targetId: item === 'toiletCard' ? myId : targetId, item,
    });
  };
});