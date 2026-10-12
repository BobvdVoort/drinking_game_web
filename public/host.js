const socket = io();
let state = null;
let code = null;
let rulesData = null;

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
const SPECIAL_TILE_IDS = [16, 32, 48, 64, 80, 96, 97, 98, 99];
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

function rpsBeats(a, b) {
  return (a === 'rock' && b === 'scissors')
      || (a === 'scissors' && b === 'paper')
      || (a === 'paper' && b === 'rock');
}

socket.on('connect', () => {
  socket.emit('host:create');
});

socket.on('host:created', (res) => {
  code = res.code;
  el('codeText').textContent = code;
});

socket.on('state', (s) => { state = s; render(); });
socket.on('rules', (r) => { rulesData = r; renderRulesTable(); });

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

function renderWhisperHost(r) {
  const w = r.whisper;
  el('whisperPanel').style.display = 'block';
  const info      = el('whisperInfo');
  const inputWrap = el('whisperInputWrap');
  const list      = el('whisperList');
  const forceBtn  = el('btnWhisperForce');

  if (inputWrap) inputWrap.style.display = 'none';

  if (w.phase === 'r1' || w.phase === 'r2') {
    const label = w.phase === 'r1' ? 'Round 1' : 'Round 2';
    const submitted = w.participants.filter(pid => (w.questions[pid] || {})[w.phase]).length;
    info.textContent = `🤫 Whisper — ${label}: ${submitted}/${w.participants.length} submitted.`;
    info.className = 'banner warn';
    if (forceBtn) forceBtn.style.display = 'block';
  } else {
    info.textContent = '🤫 Whisper complete.';
    info.className = 'banner good';
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

function renderAuctionHost(r) {
  const a = r.auction;
  el('auctionPanel').style.display = 'block';
  const info    = el('auctionInfo');
  const bidWrap = el('auctionBidWrap');
  const hist    = el('auctionHistory');

  if (bidWrap) bidWrap.style.display = 'none';

  if (a.phase === 'done') {
    info.textContent = '🔨 Auction complete.';
    info.className = 'banner good';
  } else if (!a.bidders || a.bidders.length === 0) {
    info.textContent = `🔨 Shot ${Math.min(a.shotNumber, a.maxShots)}/${a.maxShots} — no bidders.`;
    info.className = 'banner warn';
  } else {
    const shot      = Math.min(a.shotNumber, a.maxShots);
    const currentId = a.bidders[a.turnIndex];
    const currentP  = state.players.find(p => p.id === currentId);
    const winner    = a.currentWinner
      ? state.players.find(p => p.id === a.currentWinner)
      : null;
    const bidStr = winner
      ? `Lowest bid: ${a.currentBid}g (${winner.name})`
      : `Starting at 3.5g — no bids yet`;
    info.textContent =
      `🔨 Shot ${shot}/${a.maxShots} — auctioneer: ${a.auctioneerName}. ` +
      `${bidStr} — bid = gold the winner receives for drinking the shot. ` +
      `Waiting on: ${currentP ? currentP.name : '—'}.`;
    info.className = 'banner warn';
  }

  const rows = a.history.map(h => h.winnerName
    ? `<div>Shot ${h.shot}: <b>${esc(h.winnerName)}</b> — drinks for ${h.price}g</div>`
    : `<div>Shot ${h.shot}: no winner</div>`
  ).join('') || '<div style="color:#98a3b3;">No shots resolved yet.</div>';
  hist.innerHTML = `<div class="roll-result">History</div>${rows}`;
}

function renderJizzHost(r) {
  const j = r.jizz;
  el('jizzPanel').style.display = 'block';
  const info = el('jizzInfo');
  const picker = el('jizzPicker');
  const wrap = el('jizzLosers');
  const tally = el('jizzTally');

  const round = j.history.length + 1;
  const isDone = j.phase === 'done';

  if (isDone) {
    const winnerId = j.active[0];
    const winnerP = state.players.find(p => p.id === winnerId);
    info.textContent = `🏆 Jizz Tournament complete — winner: ${winnerP ? winnerP.name : '?'}. Waiting for the lander to continue…`;
    info.className = 'banner good';
  } else {
    info.textContent = `🎵 Jizz Tournament — Round ${round} of ${j.maxRounds} (sudden death). Loser drinks ${round === j.maxRounds ? 'a shot (7 sips)' : '3 sips'}.`;
    info.className = 'banner warn';
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

function renderSongHost(r) {
  const s = r.song;
  el('songPanel').style.display = 'block';
  const info = el('songInfo');
  const remaining = s.maxGuesses - s.wrongGuesses;
  info.textContent = `🎵 Guess the Song — ${remaining} guess${remaining === 1 ? '' : 'es'} left (${s.wrongGuesses}/${s.maxGuesses} wrong). Player picks the outcome on their phone.`;
  info.className = 'banner warn';
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
  if (cp && cp.position >= 96 && cp.position <= 99) turnText += ` · 🏁 Endgame tile ${cp.position}`;
  if (state.paused) turnText += ` (paused: ${state.pauseReason || ''})`;
  if (state.password) turnText += ' · 🔒 password';
  el('turnBanner').textContent = turnText;

  renderMakerules();
  BoardGame.renderBoard(el('board'), state, () => rulesData);

  if (state.activeRule) {
    const r = state.activeRule;
    const owner = state.players.find(pp => pp.id === r.playerId);
    el('rulePanel').style.display = 'block';
    el('ruleTitle').textContent = `${owner ? owner.name : 'Player'} — tile ${r.tile} — ${r.rule.title}`;
    el('ruleText').textContent = r.rule.text;

    const isGamble = !!(r.rule && r.rule.minigame === 'gamble' && r.gamble);
    const isMakerule = !!(r.rule && r.rule.minigame === 'makerule' && r.makerule);
    const isOddEven = !!(r.rule && r.rule.minigame === 'odd-or-even' && r.oddEven);
    const isSwapSeats = !!(r.rule && r.rule.minigame === 'swap-seats' && r.swapSeats);
    const isViking = !!(r.rule && r.rule.minigame === 'viking' && r.viking);
    const isStraw = !!(r.rule && r.rule.minigame === 'straw' && r.straw);
    const isJizzDie = !!(r.rule && r.rule.minigame === 'jizz-die' && r.jizzDie);
    const isDrinkingBuddy = !!(r.rule && r.rule.minigame === 'drinking-buddy' && r.drinkingBuddy);
    const isMedusa = !!(r.rule && r.rule.minigame === 'medusa' && r.medusa);
    const isRps = !!(r.rule && r.rps);
    const isBuyout = !!(r.rule && r.buyout);
    const isWhisper = !!(r.rule && r.rule.minigame === 'whisper' && r.whisper);
    const isAuction = !!(r.rule && r.rule.minigame === 'auction' && r.auction);
    const isJizz = !!(r.rule && r.rule.minigame === 'jizz' && r.jizz);
    const isSong = !!(r.rule && r.rule.minigame === 'song' && r.song);

    const ownEndgameInfoRule = !!(
      cp
      && cp.position >= 96 && cp.position <= 99
      && r.tile === cp.position
      && !r.rps && !r.jizz && !r.song
    );

    if (isMakerule) {
      el('makerulePanel').style.display = 'block';
      const m = r.makerule;
      const info = el('makeruleInfo');
      if (m.isOdd) {
        if (m.phase === 'choosing') {
          info.innerHTML = `<div class="roll-result">Rolled ${m.roll} — ODD</div>
                            <div>Waiting for <b>${owner ? esc(owner.name) : 'player'}</b> to submit a rule…</div>`;
        } else {
          info.innerHTML = `<div class="roll-result">Rule made</div>
                            <div>"${esc(m.submittedText || '')}"</div>`;
        }
      } else {
        info.innerHTML = `<div class="roll-result">Rolled ${m.roll} — EVEN</div><div>Drink 3 sips.</div>`;
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

    if (isWhisper) renderWhisperHost(r); else el('whisperPanel').style.display = 'none';
    if (isAuction) renderAuctionHost(r); else el('auctionPanel').style.display = 'none';

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
      const res = el('gambleResult');
      const waiting = el('gambleWaiting');
      if (r.gamble.phase === 'choosing') {
        res.style.display = 'none';
        waiting.style.display = 'block';
      } else {
        waiting.style.display = 'none';
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
      const pickedCount = Object.keys(m.picks).length;

      if (m.phase === 'picking') {
        el('medusaProgress').style.display = 'block';
        el('medusaProgress').textContent = `${pickedCount} / ${m.participants.length} picked.`;
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
        el('rpsProgress').textContent =
          `${Object.keys(rps.picks).length} / ${rps.participants.length} picked.`;
        el('rpsResult').style.display = 'none';
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
      }
    } else {
      el('rpsPanel').style.display = 'none';
    }

    if (isJizz) renderJizzHost(r); else el('jizzPanel').style.display = 'none';
    if (isSong) renderSongHost(r); else el('songPanel').style.display = 'none';

    if (isBuyout) {
      el('buyoutPanel').style.display = 'block';
      const info = el('buyoutInfo');
      const result = el('buyoutResult');
      if (r.buyout.phase === 'choosing') {
        info.style.display = 'block';
        info.textContent = `${owner ? owner.name : 'Player'} is choosing: accept or buy-out (${r.buyout.cost} gold).`;
        result.style.display = 'none';
      } else {
        info.style.display = 'none';
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
    const blockedByJizz     = isJizz     && r.jizz.phase !== 'done';
    const blockedBySong     = isSong;

    const blocked = blockedByGamble || blockedByMedusa
                 || blockedByBuyout || blockedByMakerule
                 || blockedByViking || blockedByBuddy
                 || blockedByRps    || blockedByWhisper
                 || blockedByJizz   || blockedBySong;

    const hideResolve = isRps || ownEndgameInfoRule;
    el('btnResolveRule').style.display = hideResolve ? 'none' : 'block';
    el('btnResolveRule').disabled = blocked;
  } else {
    el('rulePanel').style.display = 'none';
  }

  const pw = el('players');
  pw.innerHTML = '';
  for (const p of state.players) {
    const row = document.createElement('div');
    row.className = 'player-row' + (p.id === cpId ? ' current' : '');
    const onBreak = state.breakLock && state.breakLock.arrived.includes(p.id);
    const inEndgame = p.position >= 96 && p.position <= 99 && !p.finished;
    row.innerHTML = `
      <div class="player-dot" style="background:${p.color}"></div>
      <div><b>${p.name}</b>${p.finished ? ' 🏁' : ''}${onBreak ? ' 🛑' : ''}${inEndgame ? ' ⚔️' : ''}${tokenBadges(p)}</div>
      <div class="meta">tile ${p.position} · ${p.gold}g${p.toiletCards ? ' · 🚽'+p.toiletCards : ''}${p.skipNextTurn ? ' · skip' : ''} · 🍺 ${fmtSips(p.totalSips)}</div>
    `;
    pw.appendChild(row);
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
  // Room password input: show the current value.
  if (el('s_roomPassword') !== focus) {
    el('s_roomPassword').value = state.password || '';
  }

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
el('btnStrawStart').onclick = () => socket.emit('player:strawStart', { code });
el('btnStrawReset').onclick = () => socket.emit('player:strawReset', { code });
el('btnWhisperForce').onclick = () => socket.emit('host:whisperForceAdvance', { code });
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
el('btnApplyTimerNow').onclick = () => socket.emit('host:setTimerNow', { code, seconds: Number(el('s_timer').value) });
el('btnShowRules').onclick = () => {
  el('rulesOverlay').style.display = 'block';
  if (!rulesData) socket.emit('host:getRules', { code });
};
el('btnCloseRules').onclick = () => { el('rulesOverlay').style.display = 'none'; };
el('btnReloadRulesOverlay').onclick = () => socket.emit('host:reloadRules', { code });

// --- Room password ---
el('btnSavePassword').onclick = () => {
  const pw = (el('s_roomPassword').value || '').trim();
  socket.emit('host:setPassword', { code, password: pw });
};
el('btnClearPassword').onclick = () => {
  el('s_roomPassword').value = '';
  socket.emit('host:setPassword', { code, password: '' });
};

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