"""
Drink Board Game — Python port of the Node.js server.

Run:
    pip install -r requirements.txt
    python server.py
"""

import csv
import math
import os
import random
import socket as _socket
import threading
import time
import traceback
import uuid

from flask import Flask, request, send_from_directory, jsonify
from flask_socketio import SocketIO, emit, join_room

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')

app = Flask(__name__, static_folder=None)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-only-change-me')
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='eventlet')

PLAYTEST_PASSWORD = 'kakhoofd'


@app.route('/')
@app.route('/index.html')
def _index():
    return send_from_directory(PUBLIC_DIR, 'index.html')

@app.route('/host.html')
def _host():
    return send_from_directory(PUBLIC_DIR, 'host.html')

@app.route('/play.html')
def _play():
    return send_from_directory(PUBLIC_DIR, 'play.html')

@app.route('/local.html')
def _local():
    return send_from_directory(PUBLIC_DIR, 'local.html')

@app.route('/style.css')
def _style():
    return send_from_directory(PUBLIC_DIR, 'style.css')

@app.route('/board.js')
def _board_js():
    return send_from_directory(PUBLIC_DIR, 'board.js')

@app.route('/host.js')
def _host_js():
    return send_from_directory(PUBLIC_DIR, 'host.js')

@app.route('/play.js')
def _play_js():
    return send_from_directory(PUBLIC_DIR, 'play.js')

@app.route('/local.js')
def _local_js():
    return send_from_directory(PUBLIC_DIR, 'local.js')

@app.route('/socket.io.min.js')
def _socket_io_client():
    return send_from_directory(PUBLIC_DIR, 'socket.io.min.js')

@app.route('/debug')
def _debug():
    return jsonify({
        'rooms': list(rooms.keys()),
        'rules_loaded': len(TILE_RULES),
        'clients': len(client_info),
    })


def generate_board(size=10):
    board = [[None] * size for _ in range(size)]
    top, bottom, left, right = 0, size - 1, 0, size - 1
    num = 1
    while top <= bottom and left <= right:
        for c in range(left, right + 1):
            board[top][c] = num
            num += 1
        top += 1
        for r in range(top, bottom + 1):
            board[r][right] = num
            num += 1
        right -= 1
        if top <= bottom:
            for c in range(right, left - 1, -1):
                board[bottom][c] = num
                num += 1
            bottom -= 1
        if left <= right:
            for r in range(bottom, top - 1, -1):
                board[r][left] = num
                num += 1
            left += 1
    for r in range(size):
        for c in range(size):
            if board[r][c] == 100:
                board[r][c] = 'FINISH'
    return board


BOARD = generate_board()

SPECIAL_TILES = {
    16: {'id': 1, 'type': 'break'},
    32: {'id': 2, 'type': 'break'},
    48: {'id': 3, 'type': 'break'},
    64: {'id': 4, 'type': 'break'},
    80: {'id': 5, 'type': 'break'},
    96: {'id': 6, 'type': 'endgame'},
    97: {'id': 7, 'type': 'endgame'},
    98: {'id': 8, 'type': 'endgame'},
    99: {'id': 9, 'type': 'endgame'},
}

BREAK_TILES = [16, 32, 48, 64, 80]
ENDGAME_TILES = [96, 97, 98, 99]
ENDGAME_FIRST = 96
FINISH_TILE = 100

SHOT_SIPS = 7
HALF_SHOT_SIPS = 3.5
ML_PER_SIP = 30

COLORS = [
    '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231',
    '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#fabed4',
    '#469990', '#dcbeff',
]

TOKEN_INFO = {
    'thumbmaster':    {'emoji': '👍', 'label': 'Thumbmaster'},
    'beer-slut':      {'emoji': '🍺', 'label': 'Beer-Slut'},
    'gnome':          {'emoji': '🍄', 'label': 'Gnome'},
    'drinking-buddy': {'emoji': '🤝', 'label': 'Drinking Buddy'},
    'pirate':         {'emoji': '🏴‍☠️', 'label': 'Pirate'},
    'marine':         {'emoji': '⚓', 'label': 'Marine'},
    'skip-turn':      {'emoji': '⏭', 'label': 'Skip Next Turn'},
    'straw':          {'emoji': '🥤', 'label': 'Must Drink With Straw'},
    'hold-out':       {'emoji': '✊', 'label': 'Hold Out'},
    'mute':           {'emoji': '🤐', 'label': 'Mute'},
    '69':             {'emoji': '😏', 'label': '69'},
    'blind':          {'emoji': '🙈', 'label': 'Blind'},
}

RULES_FILE = os.path.join(BASE_DIR, 'rules.csv')


def build_default_rules():
    rules = {
        16: {'type': 'minigame', 'minigame': 'medusa', 'title': 'Medusa', 'text': 'See rules.csv.'},
        32: {'type': 'minigame', 'minigame': 'viking', 'title': 'Viking', 'text': 'See rules.csv.'},
        48: {'type': 'minigame', 'minigame': 'straw', 'title': 'Straw Transfer', 'text': 'See rules.csv.'},
        64: {'type': 'minigame', 'minigame': 'whisper', 'title': 'Whisper Questions', 'text': 'See rules.csv.'},
        80: {'type': 'minigame', 'minigame': 'auction', 'title': 'Shot Auction', 'text': 'See rules.csv.'},
        96: {'type': 'minigame', 'minigame': 'rps', 'title': 'Rock Paper Scissors', 'text': 'See rules.csv.'},
        97: {'type': 'minigame', 'minigame': 'jizz', 'title': 'Jizz Tournament', 'text': 'See rules.csv.'},
        98: {'type': 'minigame', 'minigame': 'guess-song', 'title': 'Guess the Song', 'text': 'See rules.csv.'},
        99: {'type': 'minigame', 'minigame': 'finish', 'title': 'The Finish Line', 'text': 'See rules.csv.'},
    }
    pool = [
        {'type': 'nothing', 'title': 'Safe', 'text': 'Nothing happens.'},
        {'type': 'punishment', 'sips': 1, 'title': 'Sip', 'text': 'Drink 1 sip.'},
    ]
    p = 0
    for tile in range(1, 100):
        if tile in rules or tile in SPECIAL_TILES:
            continue
        rules[tile] = pool[p % len(pool)]
        p += 1
    return rules


def _coerce_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _coerce_number(v):
    if v is None or v == '':
        return None
    try:
        if '.' in str(v):
            return float(v)
        return int(v)
    except (TypeError, ValueError):
        return None


def load_tile_rules():
    try:
        with open(RULES_FILE, 'r', encoding='utf-8-sig') as f:
            raw = f.read()
    except OSError as e:
        print(f'[rules] Could not read {RULES_FILE}: {e}. Using built-in fallback.')
        return build_default_rules()

    lines = [ln for ln in raw.splitlines()
             if ln.strip() and not ln.strip().startswith('#')]

    if len(lines) < 2:
        print(f'[rules] {RULES_FILE} has no data rows. Using built-in fallback.')
        return build_default_rules()

    reader = csv.reader(lines)
    try:
        header = [h.strip().lower() for h in next(reader)]
    except StopIteration:
        return build_default_rules()

    def col_idx(name):
        try:
            return header.index(name)
        except ValueError:
            return -1

    idx = {
        'tile':       col_idx('tile'),
        'type':       col_idx('type'),
        'title':      col_idx('title'),
        'text':       col_idx('text'),
        'sips':       col_idx('sips'),
        'gold':       col_idx('gold'),
        'toiletCard': col_idx('toiletcard'),
        'minigame':   col_idx('minigame'),
        'tokens':     col_idx('token-indicators'),
        'betgameVar': col_idx('betgame-variant'),
    }
    if idx['tile'] < 0:
        print('[rules] Missing "tile" column. Using built-in fallback.')
        return build_default_rules()

    def cell(row, key):
        i = idx[key]
        if i < 0 or i >= len(row):
            return ''
        return (row[i] or '').strip()

    specifics = {}
    pool = []

    for row in reader:
        tile_raw = cell(row, 'tile').lower()
        if not tile_raw:
            continue

        rule = {
            'type':  cell(row, 'type')  or 'task',
            'title': cell(row, 'title') or 'Tile',
            'text':  cell(row, 'text')  or '',
        }

        sips = _coerce_number(cell(row, 'sips'))
        gold = _coerce_number(cell(row, 'gold'))
        tc   = _coerce_int(cell(row, 'toiletCard'))
        mini = cell(row, 'minigame')
        toks = cell(row, 'tokens')
        bgv  = cell(row, 'betgameVar')

        if sips is not None: rule['sips'] = sips
        if gold is not None: rule['gold'] = gold
        if tc   is not None: rule['toiletCard'] = tc
        if mini: rule['minigame'] = mini
        if toks and toks.lower() != 'none': rule['tokenIndicators'] = toks
        if bgv:  rule['betgameVariant'] = bgv

        if tile_raw == 'pool':
            pool.append(rule)
        elif tile_raw.isdigit():
            n = int(tile_raw)
            if 1 <= n <= 99:
                specifics[n] = rule

    rules = dict(specifics)
    if pool:
        p = 0
        for tile in range(1, 100):
            if tile in rules or tile in SPECIAL_TILES:
                continue
            rules[tile] = pool[p % len(pool)]
            p += 1

    print(f'[rules] Loaded {len(specifics)} specific + {len(pool)} pool rule(s) from rules.csv.')
    return rules


TILE_RULES = load_tile_rules()


def reload_rules():
    global TILE_RULES
    TILE_RULES = load_tile_rules()
    return TILE_RULES


rooms = {}
client_info = {}
state_lock = threading.RLock()


def make_code():
    # 5 uppercase letters: 26^5 ≈ 11.9 million combinations.
    while True:
        code = ''.join(random.choices('ABCDEFGHIJKLMNOPQRSTUVWXYZ', k=5))
        if code not in rooms:
            return code


def default_settings():
    return {
        'startGold': 10,
        'turnTimer': 0,
        'timerAction': 'auto-roll',
        'allowDrinksOnBreak': False,
        'punishment': 'drink 2 sips',
        'rollSpinMs': 1500,
        'rollResultMs': 1000,
        'minPlayers': 2,
        'maxPlayers': 12,
    }


def create_room(host_sid):
    code = make_code()
    state = {
        'code': code,
        'hostSocketId': host_sid,
        'createdAt': int(time.time() * 1000),
        'phase': 1,
        'round': 1,
        'players': [],
        'turnOrder': [],
        'currentTurnIndex': 0,
        'settings': default_settings(),
        'paused': False,
        'pauseReason': None,
        'toiletQueue': [],
        'specialArrivals': {t: [] for t in [16, 32, 48, 64, 80, 96, 97, 98, 99]},
        'betGame': None,
        'activeRule': None,
        'pendingQueue': [],
        'log': [],
        'roundPhase': 'lobby',
        'rollOff': {},
        'rollOffCandidates': None,
        'orderChooserId': None,
        'breakLock': None,
        'lastRoll': None,
        'turnEndsAt': None,
        'winner': None,
        'endgameMinigames': {},
        'makerules': [],
        'playtest': {'enabled': False, 'forcedRoll': None},
        'password': None,
    }
    rooms[code] = state
    return state


def broadcast(code):
    state = rooms.get(code)
    if not state:
        return
    socketio.emit('state', state, to=code)


def log_msg(state, msg):
    state['log'].insert(0, {'t': int(time.time() * 1000), 'msg': msg})
    if len(state['log']) > 250:
        del state['log'][250:]


def add_sips(state, player, amount):
    if not player:
        return
    try:
        amt = float(amount)
    except (TypeError, ValueError):
        return
    if amt <= 0:
        return
    player['totalSips'] = float(player.get('totalSips', 0)) + amt


def add_player(state, pid, name, sid=None, is_virtual=False):
    if len(state['players']) >= state['settings']['maxPlayers']:
        return {'error': 'Room is full'}
    if any(p['id'] == pid for p in state['players']):
        return {'error': 'Already joined'}

    used = [p['color'] for p in state['players']]
    color = next((c for c in COLORS if c not in used),
                 COLORS[len(state['players']) % len(COLORS)])

    player = {
        'id': pid,
        'sid': sid,
        'name': name or f"Player {len(state['players']) + 1}",
        'color': color,
        'isVirtual': is_virtual,
        'position': 0,
        'gold': state['settings']['startGold'],
        'toiletCards': 0,
        'tokens': [],
        'skipNextTurn': False,
        'onBreakTile': False,
        'connected': True,
        'finished': False,
        'finishRank': None,
        'pendingDrink': [],
        'totalSips': 0.0,
    }
    state['players'].append(player)
    return {'player': player}


def current_player(state):
    if not state['turnOrder']:
        return None
    pid = state['turnOrder'][state['currentTurnIndex']]
    return next((p for p in state['players'] if p['id'] == pid), None)


def build_turn_order(state, starting_id):
    ids = [p['id'] for p in state['players']]
    try:
        idx = ids.index(starting_id)
    except ValueError:
        state['turnOrder'] = ids
        state['currentTurnIndex'] = 0
        return
    state['turnOrder'] = ids[idx:] + ids[:idx]
    state['currentTurnIndex'] = 0


def roll_die():
    return random.randint(1, 6)


def in_endgame_zone(player):
    if not player:
        return False
    return ENDGAME_FIRST <= player['position'] <= 99


def round_half(x):
    return math.floor(x * 2 + 0.5) / 2


def ceil_half(x):
    return math.ceil(x * 2) / 2


def roll_turn(forced_first=None):
    moves, rolls, events = [], [], []
    sips = 0
    gold_from_roll = 0
    skip_next = False
    is_double_six = False

    r = forced_first if forced_first is not None else roll_die()
    rolls.append(r)

    if r == 1:
        moves.append({'delta': 1})
        ones = 1
        while ones < 3:
            n = roll_die()
            rolls.append(n)
            if n == 1:
                ones += 1
                moves.append({'delta': 1})
                if ones == 2:
                    sips += 2
                    events.append('Two 1s: give 2 sips.')
                if ones == 3:
                    gold_from_roll += 2
                    sips += 4
                    skip_next = True
                    events.append('Three 1s: +2 gold, give 4 sips, skip next turn.')
            else:
                moves.append({'delta': n})
                break
    elif r == 6:
        n = roll_die()
        rolls.append(n)
        if n == 6:
            is_double_six = True
            moves.append({'delta': 6})
            moves.append({'delta': -6, 'noLand': True})
            events.append('Double 6: move 6 and resolve, then 6 back (net 0).')
        else:
            moves.append({'delta': 6})
            moves.append({'delta': n})
            events.append(f'6 then {n}: two separate moves.')
    else:
        moves.append({'delta': r})

    total = sum(m['delta'] for m in moves)
    return {
        'moves': moves,
        'total': total,
        'rolls': rolls,
        'events': events,
        'sips': sips,
        'goldFromRoll': gold_from_roll,
        'skipNext': skip_next,
        'isDoubleSix': is_double_six,
    }


def apply_move(player, delta):
    p = player['position'] + delta
    if p < 0:
        p = 0
    if p > FINISH_TILE:
        p = FINISH_TILE
    player['position'] = p


def next_break_tile(current):
    try:
        i = BREAK_TILES.index(current)
    except ValueError:
        return None
    if i >= len(BREAK_TILES) - 1:
        return None
    return BREAK_TILES[i + 1]


def all_active_arrived(state):
    lock = state['breakLock']
    if not lock:
        return False
    active = [p for p in state['players'] if not p['finished']]
    return len(active) > 0 and all(p['id'] in lock['arrived'] for p in active)


def cancel_remaining_movement(state, player_id):
    before = len(state['pendingQueue'])
    state['pendingQueue'] = [
        item for item in state['pendingQueue']
        if not (item.get('playerId') == player_id
                and item.get('kind') in ('step', 'move'))
    ]
    after = len(state['pendingQueue'])
    return before - after


def try_clear_break_lock(state, arriving_player=None):
    lock = state['breakLock']
    if not lock:
        return
    if not all_active_arrived(state):
        return

    completed_tile = lock['tile']
    completed_rule = TILE_RULES.get(completed_tile)

    for p in state['players']:
        p['onBreakTile'] = False
    nxt = next_break_tile(completed_tile)
    state['phase'] += 1

    if nxt is not None:
        state['breakLock'] = {'tile': nxt, 'arrived': []}
        log_msg(state, f"✅ Everyone arrived at break tile {completed_tile}. "
                       f"Phase → {state['phase']}. Next break: tile {nxt}.")
    else:
        state['breakLock'] = None
        log_msg(state, f"✅ Everyone arrived at break tile {completed_tile}. "
                       f"Phase → {state['phase']}. Endgame unlocked (tiles 96–99).")

    if completed_rule:
        if arriving_player:
            owner_id = arriving_player['id']
        elif lock['arrived']:
            owner_id = lock['arrived'][-1]
        else:
            owner_id = state['players'][0]['id']
        state['pendingQueue'].insert(0, {
            'kind': 'rule',
            'playerId': owner_id,
            'tile': completed_tile,
            'rule': completed_rule,
        })


def move_and_land(state, player, raw_delta):
    delta = raw_delta

    if delta > 0:
        lock = state['breakLock']
        if lock and player['position'] < lock['tile']:
            target = player['position'] + delta
            if target > lock['tile']:
                delta = lock['tile'] - player['position']
                log_msg(state, f"🛑 {player['name']} is clamped at break tile "
                               f"{lock['tile']} (moved {raw_delta} → {delta}).")

    if delta > 0:
        if player['position'] >= ENDGAME_FIRST:
            delta = 0
        elif player['position'] + delta > ENDGAME_FIRST:
            delta = ENDGAME_FIRST - player['position']
            log_msg(state, f"{player['name']} is forced to stop at endgame tile {ENDGAME_FIRST}.")

    if delta == 0:
        return

    apply_move(player, delta)
    queue_landing(state, player)

    lock = state['breakLock']
    if lock and player['position'] == lock['tile'] and player['id'] not in lock['arrived']:
        lock['arrived'].append(player['id'])
        player['onBreakTile'] = True
        active_count = len([p for p in state['players'] if not p['finished']])
        log_msg(state, f"🛑 {player['name']} arrived at break tile {lock['tile']} "
                       f"({len(lock['arrived'])}/{active_count}).")
        try_clear_break_lock(state, player)
        dropped = cancel_remaining_movement(state, player['id'])
        if dropped:
            log_msg(state, f"⏹ {player['name']} stops here — "
                           f"{dropped} remaining movement step(s) ignored.")


def queue_landing(state, player):
    tile = player['position']

    if tile == FINISH_TILE:
        player['finished'] = True
        player['finishRank'] = len([p for p in state['players'] if p['finished']])
        log_msg(state, f"🏆 {player['name']} reached FINISH! Rank #{player['finishRank']}")
        if not state['winner']:
            state['winner'] = player['id']
        return

    special = SPECIAL_TILES.get(tile)
    if special:
        is_first = player['id'] not in state['specialArrivals'][tile]
        if is_first:
            state['specialArrivals'][tile].append(player['id'])
            order = len(state['specialArrivals'][tile])
            reward = max(0, 5 - (order - 1))
            player['gold'] += reward
            log_msg(state, f"{player['name']} → Special {special['id']} (tile {tile}). Reward {reward} gold.")
        return

    rule = TILE_RULES.get(tile)
    to_add = []
    if rule:
        to_add.append({'kind': 'rule', 'playerId': player['id'], 'tile': tile, 'rule': rule})
    rule_is_bg = rule and rule.get('minigame') == 'betgame'
    if tile > 0 and not rule_is_bg:
        others = [p for p in state['players']
                  if p['id'] != player['id'] and p['position'] == tile and not p['finished']]
        if others:
            to_add.append({'kind': 'bet', 'tile': tile,
                           'playerIds': [player['id']] + [p['id'] for p in others]})
    if to_add:
        state['pendingQueue'] = to_add + state['pendingQueue']


def apply_tokens(state, player, token_string):
    if not token_string:
        return
    MULTI_HOLDER = ('drinking-buddy', 'marine', 'pirate')

    tokens = [t.strip() for t in token_string.split(',') if t.strip()]
    for token in tokens:
        if token == 'none':
            continue
        if token == 'skip-turn':
            player['skipNextTurn'] = True
            player.setdefault('tokens', [])
            if 'skip-turn' not in player['tokens']:
                player['tokens'].append('skip-turn')
            log_msg(state, f"⏭ {player['name']} will skip their next turn.")
            continue
        if token == 'drinking-buddy':
            continue
        if token not in MULTI_HOLDER:
            for other in state['players']:
                if other['id'] == player['id']:
                    continue
                if token in other.get('tokens', []):
                    other['tokens'].remove(token)
                    label = TOKEN_INFO.get(token, {}).get('label', token)
                    log_msg(state, f"↩ {other['name']} loses {label}.")
        player.setdefault('tokens', [])
        label = TOKEN_INFO.get(token, {}).get('label', token)
        if token not in player['tokens']:
            player['tokens'].append(token)
            log_msg(state, f"🏅 {player['name']} is now {label}.")
        else:
            log_msg(state, f"🏅 {player['name']} keeps {label}.")


def apply_drinking_buddy(state, lander, buddy):
    for p in state['players']:
        if 'drinking-buddy' in p.get('tokens', []):
            p['tokens'].remove('drinking-buddy')
    for p in (lander, buddy):
        p.setdefault('tokens', [])
        if 'drinking-buddy' not in p['tokens']:
            p['tokens'].append('drinking-buddy')
    log_msg(state, f"🤝 {lander['name']} and {buddy['name']} are now drinking buddies — "
                   f"they share all sips and shots for the rest of the game.")


def resolve_marine_pirate(state):
    players = state['players']
    n = len(players)
    if n < 1:
        return

    pirates = [p for p in players if 'pirate' in p.get('tokens', [])]
    marines = [p for p in players if 'marine' in p.get('tokens', [])]

    if not pirates and not marines:
        return

    for pirate in pirates:
        i = players.index(pirate)
        prev_p = players[(i - 1) % n]
        next_p = players[(i + 1) % n]
        for target in (prev_p, next_p):
            if target['id'] == pirate['id']:
                continue
            if target['gold'] >= 1:
                target['gold'] -= 1
                pirate['gold'] += 1
                log_msg(state, f"🏴‍☠️ {pirate['name']} steals 1 gold from {target['name']}.")
            else:
                log_msg(state, f"🏴‍☠️ {pirate['name']} couldn't steal from {target['name']} (0 gold).")

    for marine in marines:
        collected = 0
        for pirate in pirates:
            if pirate['id'] == marine['id']:
                continue
            if pirate['gold'] >= 1:
                pirate['gold'] -= 1
                marine['gold'] += 1
                collected += 1
        if collected > 0:
            log_msg(state, f"⚓ {marine['name']} collects {collected} gold from pirates.")
        else:
            log_msg(state, f"⚓ {marine['name']} found no pirate gold to collect.")

    for p in players:
        if 'pirate' in p.get('tokens', []):
            p['tokens'].remove('pirate')
        if 'marine' in p.get('tokens', []):
            p['tokens'].remove('marine')


def compute_bet_game_joiners(state, lander, variant):
    joiners = []
    others = [p for p in state['players'] if p['id'] != lander['id'] and not p['finished']]

    if variant == 'behind':
        joiners = [o for o in others if o['position'] < lander['position']]
        log_msg(state, f"🎲 Bet game 'behind': {len(joiners)} player(s).")
    elif variant == 'rich':
        joiners = [o for o in others if o['gold'] > lander['gold']]
        log_msg(state, f"🎲 Bet game 'rich': {len(joiners)} player(s).")
    elif variant == 'equality':
        lr = roll_die()
        log_msg(state, f"🎲 {lander['name']} rolls {lr}.")
        for o in others:
            r = roll_die()
            log_msg(state, f"🎲 {o['name']} rolls {r}.")
            if r == lr:
                joiners.append(o)
        log_msg(state, f"🎲 Bet game 'equality': {len(joiners)} matched.")
    elif variant == 'bashdown':
        lowest, lowest_p = 7, None
        for o in others:
            r = roll_die()
            log_msg(state, f"🎲 {o['name']} rolls {r}.")
            if r < lowest:
                lowest, lowest_p = r, o
        if lowest_p:
            joiners.append(lowest_p)
            log_msg(state, f"🎲 Bashdown: lowest is {lowest_p['name']} ({lowest}).")
    return joiners


def resolve_medusa_round(state):
    ar = state['activeRule']
    if not ar or 'medusa' not in ar:
        return
    m = ar['medusa']
    if m['phase'] != 'picking':
        return

    pairs, seen = [], set()
    for pid, tid in list(m['picks'].items()):
        if pid in seen:
            continue
        if m['picks'].get(tid) == pid:
            pairs.append([pid, tid])
            seen.add(pid)
            seen.add(tid)
    leftover = [pid for pid in m['picks'] if pid not in seen]
    shots_consumed = len(pairs) * 2
    m['shotsRemaining'] = max(0, m['shotsRemaining'] - shots_consumed)
    m['lastReveal'] = {'pairs': pairs, 'leftover': leftover,
                       'shotsConsumed': shots_consumed, 'round': m['round']}
    m['phase'] = 'revealed'

    if not pairs:
        log_msg(state, f"🐍 Medusa round {m['round']}: no eye contact — nobody drinks.")
    else:
        names = []
        for a, b in pairs:
            pa = next((p for p in state['players'] if p['id'] == a), None)
            pb = next((p for p in state['players'] if p['id'] == b), None)
            names.append(f"{pa['name'] if pa else '?'} ↔ {pb['name'] if pb else '?'}")
            add_sips(state, pa, SHOT_SIPS)
            add_sips(state, pb, SHOT_SIPS)
        log_msg(state, f"🐍 Medusa round {m['round']}: {len(pairs)} pair(s) — "
                       f"{', '.join(names)}. {shots_consumed} shot(s) consumed. "
                       f"{m['shotsRemaining']} left.")

    if m['shotsRemaining'] <= 0:
        m['phase'] = 'done'
        log_msg(state, "🐍 Medusa: all shots are gone! Minigame complete.")


def start_next_medusa_round(state):
    ar = state['activeRule']
    if not ar or 'medusa' not in ar:
        return
    m = ar['medusa']
    if m['phase'] != 'revealed':
        return
    m['round'] += 1
    m['picks'] = {}
    m['lastReveal'] = None
    m['phase'] = 'picking'
    log_msg(state, f"🐍 Medusa round {m['round']}: pick a target. {m['shotsRemaining']} shot(s) left.")


RPS_BEATS = {
    'rock': 'scissors',
    'scissors': 'paper',
    'paper': 'rock',
}


def resolve_rps_round(state):
    ar = state['activeRule']
    if not ar or 'rps' not in ar:
        return
    r = ar['rps']
    if r['phase'] != 'picking':
        return

    lander_id = r['landerId']
    lander_throw = r['picks'].get(lander_id)
    if not lander_throw:
        return

    wins = losses = ties = 0
    opponents = {}
    for pid in r['participants']:
        if pid == lander_id:
            continue
        opp_throw = r['picks'].get(pid)
        opponents[pid] = opp_throw
        if RPS_BEATS.get(lander_throw) == opp_throw:
            wins += 1
        elif RPS_BEATS.get(opp_throw) == lander_throw:
            losses += 1
        else:
            ties += 1

    need = (len(opponents) + 1) // 2
    success = wins >= need

    r['result'] = {
        'landerThrow': lander_throw,
        'opponents': opponents,
        'wins': wins,
        'losses': losses,
        'ties': ties,
        'needToWin': need,
        'success': success,
    }
    r['phase'] = 'resolved'

    lander = next((p for p in state['players'] if p['id'] == lander_id), None)
    if lander:
        if success:
            log_msg(state, f"⚔️ RPS: {lander['name']} wins {wins}/{len(opponents)} → advances!")
        else:
            log_msg(state, f"⚔️ RPS: {lander['name']} wins {wins}/{len(opponents)} — stays on tile {ar['tile']}.")
        if losses > 0:
            log_msg(state, f"🍺 {lander['name']} drinks {losses} sip(s) for the losses.")
            add_sips(state, lander, losses)


def viking_summary(v):
    counts = {}
    for h in v['history']:
        counts[h['loserId']] = counts.get(h['loserId'], 0) + 1
    out = []
    for pid, n in counts.items():
        name = next((h['loserName'] for h in v['history'] if h['loserId'] == pid), '?')
        out.append((name, n, n * v['sipsPerLoss']))
    return out


# ---------- Whisper ----------
def start_whisper(state):
    players = [p for p in state['players'] if not p['finished']]
    if len(players) < 2:
        return None
    return {
        'phase': 'r1',
        'participants': [p['id'] for p in players],
        'questions': {p['id']: {'r1': None, 'r2': None} for p in players},
    }


def whisper_check_advance(state):
    ar = state['activeRule']
    if not ar or 'whisper' not in ar:
        return
    w = ar['whisper']
    if w['phase'] == 'r1':
        if all(w['questions'][pid]['r1'] is not None for pid in w['participants']):
            w['phase'] = 'r2'
            log_msg(state, "🤫 Whisper: Round 1 complete. Round 2 begins.")
    elif w['phase'] == 'r2':
        if all(w['questions'][pid]['r2'] is not None for pid in w['participants']):
            w['phase'] = 'done'
            log_msg(state, "🤫 Whisper: All questions submitted. Minigame complete.")


# ---------- Auction (reverse: lowest bid wins) ----------
def start_auction(state):
    players = [p for p in state['players'] if not p['finished']]
    if len(players) < 2:
        return None
    richest = sorted(players, key=lambda p: -p['gold'])[0]
    others = sorted([p for p in players if p['id'] != richest['id']],
                    key=lambda p: p['gold'])
    if not others:
        return None
    return {
        'phase': 'bidding',
        'shotNumber': 1,
        'maxShots': 3,
        'auctioneerId': richest['id'],
        'auctioneerName': richest['name'],
        'bidders': [p['id'] for p in others],
        'biddersNames': [p['name'] for p in others],
        'passed': [],
        'currentBid': 3.5,
        'currentWinner': None,
        'turnIndex': 0,
        'history': [],
    }


def advance_auction_turn(a):
    if not a['bidders']:
        return
    n = len(a['bidders'])
    active_ids = set(a['bidders']) - set(a['passed'])
    if not active_ids:
        return
    for _ in range(n):
        a['turnIndex'] = (a['turnIndex'] + 1) % n
        if a['bidders'][a['turnIndex']] in active_ids:
            return


def check_auction_end(state):
    a = state['activeRule'].get('auction')
    if not a or a['phase'] != 'bidding':
        return
    active = [bid for bid in a['bidders'] if bid not in a['passed']]
    if len(active) <= 1:
        if active:
            a['currentWinner'] = active[0]
        resolve_auction_shot(state)


def resolve_auction_shot(state, bet_game_triggered=False):
    a = state['activeRule'].get('auction')
    if not a:
        return
    shot = a['shotNumber']
    winner_id = a['currentWinner']
    price = a['currentBid']

    if winner_id:
        w = next((p for p in state['players'] if p['id'] == winner_id), None)
        if w:
            w['gold'] += price
            add_sips(state, w, SHOT_SIPS)
            a['history'].append({
                'shot': shot,
                'winnerId': winner_id,
                'winnerName': w['name'],
                'price': price,
                'betGame': bet_game_triggered,
            })
            log_msg(state, f"🔨 Shot {shot}: {w['name']} drinks the shot and receives {price} gold.")
    else:
        a['history'].append({
            'shot': shot,
            'winnerId': None,
            'winnerName': None,
            'price': 0,
            'betGame': False,
        })
        log_msg(state, f"🔨 Shot {shot}: no bidders, shot not sold.")

    a['shotNumber'] += 1
    if a['shotNumber'] > a['maxShots']:
        a['phase'] = 'done'
        summary = ', '.join(
            f"Shot {h['shot']}: {h['winnerName']} ({h['price']}g)" if h['winnerName']
            else f"Shot {h['shot']}: no winner"
            for h in a['history']
        )
        log_msg(state, f"🔨 Auction complete. {summary}.")
    else:
        a['passed'] = []
        a['currentBid'] = 3.5
        a['currentWinner'] = None
        a['turnIndex'] = 0
        log_msg(state, f"🔨 Shot {a['shotNumber']} of {a['maxShots']} begins. Starting bid: 3.5g.")


def resolve_swap_seats(state, player, from_tile):
    if not player:
        return {'ok': False, 'reason': 'no player'}

    specials = sorted(SPECIAL_TILES.keys())
    next_special = next((s for s in specials if s > from_tile), None)
    if next_special is None:
        return {'ok': False, 'reason': f'no special tile after {from_tile}'}

    candidates = [
        p for p in state['players']
        if p['position'] == next_special
        and not p['finished']
        and p['id'] != player['id']
    ]
    if not candidates:
        return {'ok': False, 'reason': f'nobody on tile {next_special}',
                'tile': next_special}

    multiple = len(candidates) > 1
    if multiple:
        target = sorted(candidates, key=lambda p: -p['gold'])[0]
    else:
        target = candidates[0]

    old_player_pos = player['position']
    old_target_pos = target['position']
    player['position'] = old_target_pos
    target['position'] = old_player_pos

    log_msg(state, f"🪑 Swap Seats: {player['name']} (tile {old_player_pos}) ⇄ "
                   f"{target['name']} (tile {old_target_pos}).")

    lock = state['breakLock']
    if lock and next_special == lock['tile']:
        if target['id'] in lock['arrived']:
            lock['arrived'].remove(target['id'])
            target['onBreakTile'] = False
        if player['id'] not in lock['arrived']:
            lock['arrived'].append(player['id'])
            player['onBreakTile'] = True
            active_count = len([p for p in state['players'] if not p['finished']])
            log_msg(state, f"{player['name']} arrived at break tile {lock['tile']} "
                           f"({len(lock['arrived'])}/{active_count}).")
        try_clear_break_lock(state, player)
        dropped = cancel_remaining_movement(state, player['id'])
        if dropped:
            log_msg(state, f"⏹ {player['name']} stops here — {dropped} remaining movement step(s) ignored.")

    return {
        'ok': True,
        'tile': next_special,
        'fromPlayerName': player['name'],
        'fromPlayerOldTile': old_player_pos,
        'withPlayerName': target['name'],
        'withPlayerOldTile': old_target_pos,
        'multipleCandidates': multiple,
    }


def drain_queue(state):
    if not state['pendingQueue']:
        advance_turn(state)
        return

    nxt = state['pendingQueue'].pop(0)
    kind = nxt.get('kind')

    if kind == 'rule':
        p = next((pp for pp in state['players'] if pp['id'] == nxt['playerId']), None)
        rule = nxt['rule']

        rule_text = (rule.get('text') or '').lower()
        gold_val = rule.get('gold')
        has_buyout_word = 'buy-out' in rule_text
        has_neg_gold = isinstance(gold_val, (int, float)) and gold_val < 0
        is_buyout = has_buyout_word and has_neg_gold

        mg = rule.get('minigame')
        auto_apply_tokens = (mg != 'odd-or-even'
                             and mg != 'drinking-buddy')

        if p and not is_buyout:
            effects = []
            if isinstance(gold_val, (int, float)) and gold_val != 0:
                p['gold'] = max(0, p['gold'] + gold_val)
                effects.append(f"+{gold_val} gold" if gold_val > 0 else f"{gold_val} gold")
            tc = rule.get('toiletCard')
            if isinstance(tc, int) and tc > 0:
                p['toiletCards'] += tc
                effects.append(f"+{tc} toilet card{'s' if tc > 1 else ''}")
            if effects:
                log_msg(state, f"💰 {p['name']} receives: {', '.join(effects)}.")

            if rule.get('tokenIndicators') and auto_apply_tokens:
                apply_tokens(state, p, rule['tokenIndicators'])

            sips_val = rule.get('sips')
            if isinstance(sips_val, (int, float)) and sips_val > 0:
                add_sips(state, p, sips_val)

        if p and rule.get('minigame') == 'betgame':
            variant = (rule.get('betgameVariant') or 'equality').lower()
            log_msg(state, f"📋 {p['name']} — tile {nxt['tile']}: {rule['title']}.")
            joiners = compute_bet_game_joiners(state, p, variant)
            if not joiners:
                log_msg(state, f"Nobody joins {p['name']}'s bet game.")
                drain_queue(state)
                return
            participants = [p] + joiners
            log_msg(state, f"{', '.join(x['name'] for x in participants)} play a bet game.")
            start_bet_game(state, nxt['tile'], participants)
            return

        state['activeRule'] = nxt
        log_msg(state, f"📋 {p['name'] if p else 'Player'} — tile {nxt['tile']}: "
                       f"{rule['title']}. {rule['text']}")

        if p and is_buyout:
            state['activeRule']['buyout'] = {
                'phase': 'choosing',
                'cost': abs(gold_val),
                'tokenIndicators': rule.get('tokenIndicators'),
                'playerId': p['id'],
                'choice': None,
            }
            log_msg(state, f"💸 Buy-out available for {abs(gold_val)} gold.")
            return

        if mg == 'gamble':
            state['activeRule']['gamble'] = {
                'phase': 'choosing', 'chosen': None, 'die': None, 'outcome': None,
                'goldDelta': 0, 'sipsDelta': 0,
            }
            log_msg(state, "🎲 Gamble: waiting for choice 1-5.")
        elif mg == 'makerule':
            r = roll_die()
            is_odd = r % 2 == 1
            state['activeRule']['makerule'] = {
                'roll': r,
                'isOdd': is_odd,
                'phase': 'choosing' if is_odd else 'resolved',
                'submittedText': None,
            }
            if is_odd:
                log_msg(state, f"🎲 Make a Rule: rolled {r} → make a rule! Waiting for the rule text.")
            else:
                log_msg(state, f"🎲 Make a Rule: rolled {r} → even, drink 3 sips.")
                add_sips(state, p, 3)
        elif mg == 'odd-or-even':
            r = roll_die()
            is_even = (r % 2 == 0)
            tokens = rule.get('tokenIndicators')
            sips = rule.get('sips') or 0
            applied_tokens = None
            if is_even and tokens and p:
                apply_tokens(state, p, tokens)
                applied_tokens = tokens
            state['activeRule']['oddEven'] = {
                'roll': r,
                'isEven': is_even,
                'tokens': applied_tokens,
                'sips': sips if is_even else 0,
            }
            if is_even:
                log_msg(state, f"🎲 Odd or Even: {p['name'] if p else '?'} rolls {r} → EVEN. "
                               f"{(tokens or 'no token')} applied, drinks {sips} sips.")
                add_sips(state, p, sips)
            else:
                log_msg(state, f"🎲 Odd or Even: {p['name'] if p else '?'} rolls {r} → ODD. "
                               f"Nothing happens.")
        elif mg == 'jizz-die':
            r = roll_die()
            state['activeRule']['jizzDie'] = {'roll': r}
            log_msg(state, f"🎲 Die and Jizz: {p['name'] if p else '?'} rolls {r}. "
                           f"Loser of the Jizz game drinks {r} sips.")
        elif mg == 'drinking-buddy':
            lander = p
            if not lander:
                log_msg(state, "🤝 Drinking Buddy skipped — no lander.")
                state['activeRule'] = None
                drain_queue(state)
                return
            participants = [pp['id'] for pp in state['players']
                            if not pp['finished'] and pp['id'] != lander['id']]
            if not participants:
                log_msg(state, "🤝 Drinking Buddy: no other players to pair with.")
                state['activeRule']['drinkingBuddy'] = {
                    'phase': 'done',
                    'landerId': lander['id'],
                    'participants': [],
                    'buddyId': None,
                }
            else:
                state['activeRule']['drinkingBuddy'] = {
                    'phase': 'picking',
                    'landerId': lander['id'],
                    'participants': participants,
                    'buddyId': None,
                }
                log_msg(state, f"🤝 {lander['name']} is choosing a drinking buddy…")
        elif mg == 'swap-seats':
            result = resolve_swap_seats(state, p, nxt['tile'])
            state['activeRule']['swapSeats'] = result
            if not result['ok']:
                log_msg(state, f"🪑 Swap Seats: no swap — {result.get('reason', 'nothing happens')}.")
        elif mg == 'viking':
            state['activeRule']['viking'] = {
                'maxRounds': 5,
                'sipsPerLoss': 3,
                'history': [],
                'phase': 'picking',
            }
            log_msg(state, "🛡 Viking: 5 rounds. Pick the loser each round — 3 sips per loss.")
        elif mg == 'straw':
            state['activeRule']['straw'] = {
                'phase': 'idle',
                'durationMs': 60000,
                'startedAt': None,
                'finishedAt': None,
            }
            log_msg(state, "🥤 Straw Transfer: press Start when ready. 1-minute timer.")
        elif mg == 'whisper':
            w = start_whisper(state)
            if not w:
                log_msg(state, "🤫 Whisper skipped — not enough players.")
                state['activeRule'] = None
                drain_queue(state)
                return
            state['activeRule']['whisper'] = w
            log_msg(state, f"🤫 Whisper: {len(w['participants'])} players, 2 rounds. "
                           "Each player submits the question their right neighbour asked them.")
        elif mg == 'auction':
            a = start_auction(state)
            if not a:
                log_msg(state, "🔨 Auction skipped — not enough players.")
                state['activeRule'] = None
                drain_queue(state)
                return
            state['activeRule']['auction'] = a
            log_msg(state, f"🔨 Auction: {a['auctioneerName']} is the auctioneer. "
                           f"Bidders (poorest first): {', '.join(a['biddersNames'])}. "
                           f"Reverse auction — lowest bid wins and drinks.")
        elif mg == 'waterfall':
            state['activeRule']['waterfall'] = {'active': True}
            log_msg(state, "🌊 Waterfall started.")
        elif mg == 'medusa':
            participants = [pp['id'] for pp in state['players'] if not pp['finished']]
            if len(participants) < 2:
                log_msg(state, "🐍 Medusa skipped — not enough players.")
                state['activeRule'] = None
                drain_queue(state)
                return
            state['activeRule']['medusa'] = {
                'phase': 'picking', 'round': 1,
                'shotsRemaining': 5, 'shotsTotal': 5,
                'participants': participants, 'picks': {}, 'lastReveal': None,
            }
            log_msg(state, f"🐍 Medusa round 1: {len(participants)} players pick a target. "
                           "5 shots on the table.")
        return

    if kind == 'bet':
        participants = [next((p for p in state['players'] if p['id'] == pid), None)
                        for pid in nxt['playerIds']]
        participants = [p for p in participants if p]
        start_bet_game(state, nxt['tile'], participants)
        return

    if kind == 'step':
        p = next((pp for pp in state['players'] if pp['id'] == nxt['playerId']), None)
        if not p or p['finished']:
            drain_queue(state)
            return
        move_and_land(state, p, nxt['delta'])
        drain_queue(state)
        return

    if kind == 'move':
        p = next((pp for pp in state['players'] if pp['id'] == nxt['playerId']), None)
        if not p or p['finished']:
            drain_queue(state)
            return
        if nxt['delta'] < 0 and p['position'] >= ENDGAME_FIRST:
            log_msg(state, f"{p['name']} stays in the endgame zone.")
            drain_queue(state)
            return
        was_on_break = state['breakLock'] and p['position'] == state['breakLock']['tile']
        apply_move(p, nxt['delta'])
        if was_on_break and state['breakLock'] and p['position'] != state['breakLock']['tile']:
            if p['id'] in state['breakLock']['arrived']:
                state['breakLock']['arrived'].remove(p['id'])
            p['onBreakTile'] = False
        log_msg(state, f"{p['name']} returns to tile {p['position']}.")
        drain_queue(state)
        return

    drain_queue(state)


def resolve_rule(state):
    if not state['activeRule']:
        return
    ar = state['activeRule']
    if 'gamble' in ar and ar['gamble']['phase'] == 'choosing':
        return
    if 'medusa' in ar and ar['medusa']['phase'] != 'done':
        return
    if 'buyout' in ar and ar['buyout']['phase'] != 'done':
        return
    if 'makerule' in ar and ar['makerule'].get('phase') == 'choosing':
        return
    if 'viking' in ar and ar['viking'].get('phase') != 'done':
        return
    if 'drinkingBuddy' in ar and ar['drinkingBuddy'].get('phase') == 'picking':
        return
    if 'whisper' in ar and ar['whisper'].get('phase') != 'done':
        return
    if 'rps' in ar:
        return
    if 'jizz' in ar:
        return
    if 'song' in ar:
        return
    state['activeRule'] = None
    drain_queue(state)


def start_bet_game(state, tile, players):
    stake = roll_die()
    if stake <= 2:
        shots = 0.5
    elif stake <= 4:
        shots = 1
    else:
        shots = 2
    state['betGame'] = {
        'tile': tile,
        'playerIds': [p['id'] for p in players],
        'stakeRoll': stake,
        'shots': shots,
        'phase': 'bidding',
        'bids': {},
    }
    log_msg(state, f"🎲 Bet game on tile {tile}: stake = {shots} shot(s). "
                   "Bids 10–100% (multiples of 10%).")


def resolve_bet_game(state):
    bg = state['betGame']
    if not bg:
        return
    entries = []
    for pid in bg['playerIds']:
        p = next((pp for pp in state['players'] if pp['id'] == pid), None)
        if p:
            entries.append({'id': pid, 'bid': bg['bids'].get(pid, 10), 'player': p})
    if not entries:
        state['betGame'] = None
        drain_queue(state)
        return

    unique_bids = set(e['bid'] for e in entries)
    lines = []
    half_stake = max(0.5, bg['shots'] / 2)

    if len(unique_bids) == 1:
        lines.append(f"All bids equal ({entries[0]['bid']}%) — no gold exchanged.")
        if len(entries) == 1:
            lines.append(f"{entries[0]['player']['name']} drinks {half_stake} shot(s).")
        else:
            lines.append(f"Everyone drinks {half_stake} shot(s).")
        for e in entries:
            add_sips(state, e['player'], HALF_SHOT_SIPS * 2 * (half_stake / 1.0 if half_stake else 0))
        log_msg(state, f"Bet game resolved: {' '.join(lines)}")
        state['betGame'] = None
        drain_queue(state)
        return

    max_bid = max(e['bid'] for e in entries)
    min_bid = min(e['bid'] for e in entries)
    top = [e for e in entries if e['bid'] == max_bid]
    bottom = [e for e in entries if e['bid'] == min_bid]
    avg = (max_bid + min_bid) / 2

    pool = 0
    for t in top:
        pay = ceil_half(t['player']['gold'] * (t['bid'] / 100))
        t['player']['gold'] = max(0, t['player']['gold'] - pay)
        pool += pay
    per_bottom = round_half((pool / len(bottom)) * 2) / 2
    for b in bottom:
        b['player']['gold'] += per_bottom

    top_names = ', '.join(f"{t['player']['name']} ({t['bid']}%)" for t in top)
    bottom_names = ', '.join(b['player']['name'] for b in bottom)
    is_top_tie = len(top) > 1
    is_bottom_tie = len(bottom) > 1

    lines.append(f"{top_names} pay{'s' if not is_top_tie else ''} {pool} gold total → "
                 f"{bottom_names} ({len(bottom)}-way split, {per_bottom} gold each).")
    if is_bottom_tie:
        lines.append(f"{bottom_names} each drink {bg['shots']} shot(s).")
    else:
        lines.append(f"{bottom_names} drinks {bg['shots']} shot(s).")

    for b in bottom:
        add_sips(state, b['player'], float(bg['shots']) * SHOT_SIPS)

    for e in entries:
        if e['bid'] in (max_bid, min_bid):
            continue
        if e['bid'] < avg:
            lines.append(f"{e['player']['name']} ({e['bid']}%) drinks {half_stake} shot(s).")
            add_sips(state, e['player'], HALF_SHOT_SIPS)

    for e in entries:
        if e['player']['gold'] <= 0 and len(entries) > 1:
            collected = 0
            for o in entries:
                if o['id'] == e['id']:
                    continue
                amt = ceil_half(o['player']['gold'] * 0.15)
                o['player']['gold'] = max(0, o['player']['gold'] - amt)
                collected += amt
            e['player']['gold'] += collected
            lines.append(f"{e['player']['name']} had 0 gold — auto-lose, "
                         f"receives 15% ({collected} gold).")

    log_msg(state, f"Bet game resolved: {' '.join(lines)}")
    state['betGame'] = None
    drain_queue(state)


def should_skip_player(state, player):
    if not player:
        return True
    if player['finished']:
        return True
    if state['breakLock'] and player['position'] == state['breakLock']['tile']:
        return True
    return False


def seek_playable_turn(state):
    if not state['turnOrder']:
        return
    guard = 0
    n = len(state['turnOrder'])
    while should_skip_player(state, current_player(state)) and guard <= n:
        state['currentTurnIndex'] = (state['currentTurnIndex'] + 1) % n
        guard += 1


def start_turn(state):
    p = current_player(state)
    if not p:
        return

    if should_skip_player(state, p):
        advance_turn(state)
        return
    if p['skipNextTurn']:
        p['skipNextTurn'] = False
        if 'tokens' in p and 'skip-turn' in p['tokens']:
            p['tokens'].remove('skip-turn')
        log_msg(state, f"{p['name']} skips their turn.")
        advance_turn(state)
        return
    if in_endgame_zone(p):
        state['turnEndsAt'] = None
        log_msg(state, f"▶ {p['name']}'s turn — endgame tile {p['position']}.")
        return
    if state['settings']['turnTimer'] > 0:
        state['turnEndsAt'] = int((time.time() + state['settings']['turnTimer']) * 1000)
    else:
        state['turnEndsAt'] = None
    log_msg(state, f"▶ {p['name']}'s turn.")


def advance_turn(state):
    if not state['turnOrder']:
        return
    wrapped = False
    attempts = 0
    n = len(state['turnOrder'])
    while True:
        state['currentTurnIndex'] += 1
        if state['currentTurnIndex'] >= n:
            state['currentTurnIndex'] = 0
            wrapped = True
        attempts += 1
        if attempts > n + 1:
            break
        if not should_skip_player(state, current_player(state)):
            break
    if wrapped:
        end_round(state)
    else:
        start_turn(state)


def determine_richest(state):
    active = [p for p in state['players'] if not p['finished']]
    if not active:
        return None
    return sorted(active, key=lambda p: -p['gold'])[0]


def end_round(state):
    resolve_marine_pirate(state)

    state['round'] += 1
    for p in state['players']:
        p['onBreakTile'] = False
    richest = determine_richest(state)
    if richest:
        state['orderChooserId'] = richest['id']
        state['roundPhase'] = 'order-selection'
        log_msg(state, f"— Round {state['round'] - 1} complete. Round {state['round']} "
                       f"begins. Richest ({richest['name']}) chooses first or last. —")
    else:
        state['roundPhase'] = 'playing'
        log_msg(state, f"— Round {state['round'] - 1} complete. Round {state['round']} begins. —")


def resolve_roll_off(state):
    candidates = state.get('rollOffCandidates') or [p['id'] for p in state['players']]
    entries = [(pid, state['rollOff'][pid]) for pid in candidates if pid in state['rollOff']]
    if not entries:
        return
    max_val = max(v for _, v in entries)
    top = [e for e in entries if e[1] == max_val]

    if len(top) == 1:
        winner_id = top[0][0]
        winner = next((p for p in state['players'] if p['id'] == winner_id), None)
        state['orderChooserId'] = winner_id
        state['roundPhase'] = 'order-selection'
        state['rollOffCandidates'] = None
        state['rollOff'] = {}
        log_msg(state, f"🎯 {winner['name']} wins roll-off with {max_val} and now chooses "
                       "first or last.")
        return

    # Tie: only the tied players continue; everyone else is eliminated.
    tied_ids = {t[0] for t in top}
    tied_names, elim_names = [], []
    for pid, _ in entries:
        p = next((pp for pp in state['players'] if pp['id'] == pid), None)
        name = p['name'] if p else '?'
        (tied_names if pid in tied_ids else elim_names).append(name)

    if elim_names:
        log_msg(state, f"Tie at {max_val} — {', '.join(elim_names)} eliminated. "
                       f"Re-roll among {', '.join(tied_names)}.")
    else:
        log_msg(state, f"Tie at {max_val} — re-roll among {', '.join(tied_names)}.")

    state['rollOffCandidates'] = list(tied_ids)
    state['rollOff'] = {}


def take_forced_roll(state):
    if not state.get('playtest', {}).get('enabled'):
        return None
    val = state['playtest'].get('forcedRoll')
    if val is None:
        return None
    state['playtest']['forcedRoll'] = None
    return val


@socketio.on('connect')
def on_connect():
    print(f'[connect] {request.sid}')


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    print(f'[disconnect] {sid}')
    info = client_info.pop(sid, None)
    if not info:
        return
    code = info.get('roomCode')
    if not code:
        return
    state = rooms.get(code)
    if not state:
        return
    player_id = info.get('playerId')
    p = next((pp for pp in state['players'] if pp['id'] == player_id), None)
    if not p:
        return
    if p.get('sid') != sid:
        return
    p['connected'] = False
    log_msg(state, f"{p['name']} disconnected.")
    broadcast(code)


@socketio.on('host:create')
def host_create():
    sid = request.sid
    print(f'[host:create] {sid}')
    state = create_room(sid)
    join_room(state['code'])
    emit('rules', TILE_RULES)
    emit('host:created', {'code': state['code']})
    broadcast(state['code'])


@socketio.on('local:create')
def local_create(data):
    sid = request.sid
    print(f'[local:create] {sid} data={data}')
    try:
        player_count = max(2, min(12, int((data or {}).get('playerCount') or 4)))
    except (TypeError, ValueError):
        player_count = 4
    names = (data or {}).get('names') or []
    state = create_room(sid)
    join_room(state['code'])
    for i in range(player_count):
        nm = names[i] if i < len(names) and names[i] else f"P{i + 1}"
        add_player(state, f"virtual-{state['code']}-{i}", nm, is_virtual=True)
    log_msg(state, f"Local game created with {player_count} virtual players.")
    emit('rules', TILE_RULES)
    emit('local:created', {'code': state['code']})
    broadcast(state['code'])


@socketio.on('player:join')
def player_join(data):
    sid = request.sid
    code = ((data or {}).get('code') or '').upper()
    name = ((data or {}).get('name') or '').strip() or 'Player'
    player_id = ((data or {}).get('playerId') or '').strip()
    password = ((data or {}).get('password') or '')
    print(f'[player:join] sid={sid} code={code} name={name} playerId={player_id}')

    state = rooms.get(code)
    if not state:
        emit('player:joinResult', {'error': 'Room not found'})
        return

    if not player_id:
        player_id = str(uuid.uuid4())

    existing = next((p for p in state['players'] if p['id'] == player_id), None)

    if existing:
        # Reconnect: bypass the password check so a mid-game network blip or
        # a host password change doesn't lock existing players out.
        existing['sid'] = sid
        existing['connected'] = True
        if name:
            existing['name'] = name
        join_room(code)
        client_info[sid] = {'roomCode': code, 'playerId': player_id}
        log_msg(state, f"{existing['name']} reconnected.")
        emit('player:joinResult', {'playerId': player_id})
        broadcast(code)
        return

    # New join: enforce the room password if one is set.
    if state.get('password'):
        if password != state['password']:
            emit('player:joinResult', {'error': 'Wrong password'})
            return

    result = add_player(state, player_id, name, sid=sid)
    if 'error' in result:
        emit('player:joinResult', {'error': result['error']})
        return
    join_room(code)
    client_info[sid] = {'roomCode': code, 'playerId': player_id}
    log_msg(state, f"{result['player']['name']} joined.")
    emit('player:joinResult', {'playerId': player_id})
    broadcast(code)


@socketio.on('host:settings')
def host_settings(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    state['settings'].update((data or {}).get('settings') or {})
    log_msg(state, "Settings updated.")
    broadcast(state['code'])


@socketio.on('host:setPassword')
def host_set_password(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    pw = ((data or {}).get('password') or '').strip()
    if not pw:
        state['password'] = None
        log_msg(state, "🔓 Room password cleared.")
    else:
        if len(pw) > 32:
            pw = pw[:32]
        state['password'] = pw
        log_msg(state, "🔒 Room password set.")
    broadcast(state['code'])


@socketio.on('host:getRules')
def host_get_rules(data):
    emit('rules', TILE_RULES)


@socketio.on('host:reloadRules')
def host_reload_rules(data):
    code = (data or {}).get('code')
    state = rooms.get(code) if code else None
    reload_rules()
    if state:
        log_msg(state, f"📄 Rules reloaded ({len(TILE_RULES)} tiles).")
        state['endgameMinigames'] = {
            t: (TILE_RULES.get(t) or {}).get('minigame') for t in ENDGAME_TILES
        }
    emit('rules', TILE_RULES)
    if state:
        broadcast(code)


@socketio.on('host:start')
def host_start(data):
    code = (data or {}).get('code')
    state = rooms.get(code)
    if not state:
        return
    if len(state['players']) < state['settings']['minPlayers']:
        return
    reload_rules()
    state['roundPhase'] = 'roll-off'
    state['rollOff'] = {}
    state['rollOffCandidates'] = [p['id'] for p in state['players']]
    state['phase'] = 1
    state['breakLock'] = {'tile': BREAK_TILES[0], 'arrived': []}
    state['orderChooserId'] = None
    state['activeRule'] = None
    state['pendingQueue'] = []
    state['betGame'] = None
    state['makerules'] = []
    state['endgameMinigames'] = {
        t: (TILE_RULES.get(t) or {}).get('minigame') for t in ENDGAME_TILES
    }
    state['playtest']['forcedRoll'] = None
    for p in state['players']:
        p['onBreakTile'] = False
        p['finished'] = False
        p['finishRank'] = None
        p['position'] = 0
        p['gold'] = state['settings']['startGold']
        p['tokens'] = []
        p['totalSips'] = 0.0
    log_msg(state, f"Game started. Round 1 roll-off. Break tiles: {BREAK_TILES}.")
    emit('rules', TILE_RULES)
    broadcast(code)


@socketio.on('host:pause')
def host_pause(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    state['paused'] = True
    state['pauseReason'] = (data or {}).get('reason') or 'Paused'
    log_msg(state, f"⏸ Paused: {state['pauseReason']}")
    broadcast(state['code'])


@socketio.on('host:resume')
def host_resume(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    state['paused'] = False
    state['pauseReason'] = None
    log_msg(state, "▶ Resumed.")
    broadcast(state['code'])


@socketio.on('host:skipTurn')
def host_skip(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    advance_turn(state)
    broadcast(state['code'])


@socketio.on('host:setTimerNow')
def host_set_timer(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    secs = int((data or {}).get('seconds') or 0)
    state['settings']['turnTimer'] = secs
    state['turnEndsAt'] = int((time.time() + secs) * 1000) if secs > 0 else None
    broadcast(state['code'])


@socketio.on('host:resolveRule')
def host_resolve_rule(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule']:
        return
    resolve_rule(state)
    broadcast(state['code'])


@socketio.on('player:resolveRule')
def player_resolve_rule(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule']:
        return
    resolve_rule(state)
    broadcast(state['code'])


# ---------------- Straw Transfer timer ----------------

@socketio.on('player:strawStart')
def player_straw_start(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule'] or 'straw' not in state['activeRule']:
        return
    s = state['activeRule']['straw']
    s['phase'] = 'running'
    s['startedAt'] = int(time.time() * 1000)
    s['finishedAt'] = None
    log_msg(state, "⏱ Straw Transfer: 60s timer started.")
    broadcast(state['code'])


@socketio.on('player:strawReset')
def player_straw_reset(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule'] or 'straw' not in state['activeRule']:
        return
    s = state['activeRule']['straw']
    s['phase'] = 'idle'
    s['startedAt'] = None
    s['finishedAt'] = None
    log_msg(state, "⏱ Straw Transfer: timer reset.")
    broadcast(state['code'])

# ---------------- Whisper ----------------

@socketio.on('player:whisperSubmit')
def player_whisper_submit(data):
    state = rooms.get((data or {}).get('code'))
    if not state: return
    ar = state['activeRule']
    if not ar or 'whisper' not in ar: return
    w = ar['whisper']
    if w['phase'] not in ('r1', 'r2'): return
    player_id = (data or {}).get('playerId')
    if player_id not in w['participants']: return
    if w['questions'][player_id][w['phase']] is not None: return
    text = ((data or {}).get('text') or '').strip()
    if not text: return
    if len(text) > 300: text = text[:300]
    w['questions'][player_id][w['phase']] = text
    p = next((pp for pp in state['players'] if pp['id'] == player_id), None)
    log_msg(state, f"🤫 {p['name'] if p else '?'} submitted a question (round {w['phase']}).")
    whisper_check_advance(state)
    broadcast(state['code'])


@socketio.on('host:whisperForceAdvance')
def host_whisper_force(data):
    state = rooms.get((data or {}).get('code'))
    if not state: return
    ar = state['activeRule']
    if not ar or 'whisper' not in ar: return
    w = ar['whisper']
    if w['phase'] == 'r1':
        for pid in w['participants']:
            if w['questions'][pid]['r1'] is None:
                w['questions'][pid]['r1'] = '(skipped)'
        w['phase'] = 'r2'
        log_msg(state, "🤫 Host force-advanced Whisper to round 2.")
    elif w['phase'] == 'r2':
        for pid in w['participants']:
            if w['questions'][pid]['r2'] is None:
                w['questions'][pid]['r2'] = '(skipped)'
        w['phase'] = 'done'
        log_msg(state, "🤫 Host force-completed Whisper.")
    broadcast(state['code'])


# ---------------- Auction (reverse) ----------------

@socketio.on('player:auctionBid')
def player_auction_bid(data):
    state = rooms.get((data or {}).get('code'))
    if not state: return
    ar = state['activeRule']
    if not ar or 'auction' not in ar: return
    a = ar['auction']
    if a['phase'] != 'bidding': return
    if not a['bidders']: return
    player_id = (data or {}).get('playerId')
    if a['bidders'][a['turnIndex']] != player_id: return
    if player_id in a['passed']: return
    try:
        bid = float((data or {}).get('bid') or 0)
    except (TypeError, ValueError):
        return
    if round(bid * 2) != bid * 2: return
    if bid >= a['currentBid']: return
    if bid < 0.5: return

    a['currentBid'] = bid
    a['currentWinner'] = player_id
    p = next((pp for pp in state['players'] if pp['id'] == player_id), None)
    log_msg(state, f"🔨 {p['name'] if p else '?'} bids {bid} gold.")

    if bid <= 0.5:
        resolve_auction_shot(state, bet_game_triggered=True)
    else:
        advance_auction_turn(a)
        check_auction_end(state)
    broadcast(state['code'])


@socketio.on('player:auctionPass')
def player_auction_pass(data):
    state = rooms.get((data or {}).get('code'))
    if not state: return
    ar = state['activeRule']
    if not ar or 'auction' not in ar: return
    a = ar['auction']
    if a['phase'] != 'bidding': return
    if not a['bidders']: return
    player_id = (data or {}).get('playerId')
    if a['bidders'][a['turnIndex']] != player_id: return
    if player_id in a['passed']: return
    a['passed'].append(player_id)
    p = next((pp for pp in state['players'] if pp['id'] == player_id), None)
    log_msg(state, f"🔨 {p['name'] if p else '?'} passes.")
    check_auction_end(state)
    if a['phase'] == 'bidding':
        advance_auction_turn(a)
    broadcast(state['code'])


# ---------------- Drinking Buddy picker ----------------

@socketio.on('player:drinkingBuddyPick')
def player_drinking_buddy_pick(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule']:
        return
    ar = state['activeRule']
    if 'drinkingBuddy' not in ar:
        return
    db = ar['drinkingBuddy']
    if db['phase'] != 'picking':
        return
    if db['landerId'] != (data or {}).get('playerId'):
        return
    buddy_id = (data or {}).get('buddyId')
    if buddy_id not in db['participants']:
        return
    lander = next((p for p in state['players'] if p['id'] == db['landerId']), None)
    buddy  = next((p for p in state['players'] if p['id'] == buddy_id), None)
    if not lander or not buddy:
        return
    apply_drinking_buddy(state, lander, buddy)
    db['buddyId'] = buddy_id
    db['phase'] = 'done'
    broadcast(state['code'])


# ---------------- Play-test ----------------

@socketio.on('host:enablePlaytest')
def host_enable_playtest(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    pw = ((data or {}).get('password') or '').strip()
    if pw != PLAYTEST_PASSWORD:
        emit('playtest:result', {'ok': False, 'reason': 'Wrong password'})
        return
    state['playtest']['enabled'] = True
    log_msg(state, "🧪 Play-test mode ENABLED.")
    emit('playtest:result', {'ok': True})
    broadcast(state['code'])


@socketio.on('host:disablePlaytest')
def host_disable_playtest(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    state['playtest']['enabled'] = False
    state['playtest']['forcedRoll'] = None
    log_msg(state, "🧪 Play-test mode DISABLED.")
    broadcast(state['code'])


@socketio.on('host:forceRoll')
def host_force_roll(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['playtest']['enabled']:
        return
    raw = (data or {}).get('value')
    if raw is None or raw == 'clear' or raw == 0:
        state['playtest']['forcedRoll'] = None
        log_msg(state, "🧪 Forced roll cleared.")
    else:
        try:
            val = int(raw)
        except (TypeError, ValueError):
            return
        if val < 1 or val > 6:
            return
        state['playtest']['forcedRoll'] = val
        log_msg(state, f"🧪 Next roll is forced to {val}.")
    broadcast(state['code'])


@socketio.on('host:setPosition')
def host_set_position(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['playtest']['enabled']:
        return
    player = next((p for p in state['players'] if p['id'] == (data or {}).get('playerId')), None)
    if not player:
        return
    try:
        pos = int((data or {}).get('position'))
    except (TypeError, ValueError):
        return
    if pos < 0 or pos > 100:
        return
    player['position'] = pos
    player['finished'] = (pos == FINISH_TILE)
    log_msg(state, f"🧪 {player['name']} teleported to tile {pos}.")

    lock = state['breakLock']
    if lock:
        if pos == lock['tile'] and player['id'] not in lock['arrived']:
            lock['arrived'].append(player['id'])
            player['onBreakTile'] = True
            active_count = len([p for p in state['players'] if not p['finished']])
            log_msg(state, f"🛑 {player['name']} marked as arrived at break tile "
                           f"{lock['tile']} ({len(lock['arrived'])}/{active_count}).")
            try_clear_break_lock(state, player)
        elif pos != lock['tile'] and player['id'] in lock['arrived']:
            lock['arrived'].remove(player['id'])
            player['onBreakTile'] = False
    else:
        player['onBreakTile'] = False

    broadcast(state['code'])


@socketio.on('host:setPhase')
def host_set_phase(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['playtest']['enabled']:
        return
    try:
        ph = int((data or {}).get('phase'))
    except (TypeError, ValueError):
        return
    if ph < 1 or ph > 6:
        return
    state['phase'] = ph
    if ph <= 5:
        state['breakLock'] = {'tile': BREAK_TILES[ph - 1], 'arrived': []}
        for p in state['players']:
            p['onBreakTile'] = False
        log_msg(state, f"🧪 Phase set to {ph} — break lock reset to tile {BREAK_TILES[ph-1]}.")
    else:
        state['breakLock'] = None
        for p in state['players']:
            p['onBreakTile'] = False
        log_msg(state, f"🧪 Phase set to {ph} — endgame unlocked (no break lock).")
    broadcast(state['code'])


# ---------------- Other minigames ----------------

@socketio.on('host:medusaEnd')
def host_medusa_end(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule'] or 'medusa' not in state['activeRule']:
        return
    state['activeRule']['medusa']['phase'] = 'done'
    log_msg(state, "🐍 Host ended Medusa.")
    broadcast(state['code'])


@socketio.on('player:medusaPick')
def player_medusa_pick(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule'] or 'medusa' not in state['activeRule']:
        return
    m = state['activeRule']['medusa']
    if m['phase'] != 'picking':
        return
    player_id = (data or {}).get('playerId')
    target_id = (data or {}).get('targetId')
    if player_id not in m['participants'] or target_id not in m['participants']:
        return
    if player_id == target_id:
        return
    if player_id in m['picks']:
        return
    m['picks'][player_id] = target_id
    p = next((pp for pp in state['players'] if pp['id'] == player_id), None)
    t = next((pp for pp in state['players'] if pp['id'] == target_id), None)
    if p and t:
        log_msg(state, f"👁 {p['name']} → {t['name']}.")
    if all(pid in m['picks'] for pid in m['participants']):
        resolve_medusa_round(state)
    broadcast(state['code'])


@socketio.on('player:medusaNext')
def player_medusa_next(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    start_next_medusa_round(state)
    broadcast(state['code'])


@socketio.on('player:vikingLoser')
def player_viking_loser(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule'] or 'viking' not in state['activeRule']:
        return
    v = state['activeRule']['viking']
    if v.get('phase') != 'picking':
        return
    if len(v['history']) >= v['maxRounds']:
        return
    loser_id = (data or {}).get('loserId')
    loser = next((p for p in state['players'] if p['id'] == loser_id), None)
    if not loser:
        return
    round_num = len(v['history']) + 1
    v['history'].append({
        'round': round_num,
        'loserId': loser_id,
        'loserName': loser['name'],
    })
    add_sips(state, loser, v['sipsPerLoss'])
    log_msg(state, f"🛡 Viking round {round_num}/{v['maxRounds']}: "
                   f"{loser['name']} loses — drinks {v['sipsPerLoss']} sips.")
    if len(v['history']) >= v['maxRounds']:
        v['phase'] = 'done'
        summary = viking_summary(v)
        summary_str = ', '.join(f"{name}: {sips} sips" for name, _, sips in summary)
        log_msg(state, f"🛡 Viking complete. Total drinks — {summary_str}.")
    broadcast(state['code'])


@socketio.on('player:jizzLoser')
def player_jizz_loser(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule']:
        return
    ar = state['activeRule']
    if 'jizz' not in ar:
        return
    j = ar['jizz']
    if j['phase'] != 'picking':
        return
    loser_id = (data or {}).get('loserId')
    if loser_id not in j['active']:
        return
    loser = next((p for p in state['players'] if p['id'] == loser_id), None)
    if not loser:
        return

    round_num = len(j['history']) + 1
    is_finale = (round_num >= j['maxRounds'])
    sips = j['finaleLossSips'] if is_finale else j['sipsPerLoss']

    j['history'].append({
        'round': round_num,
        'loserId': loser_id,
        'loserName': loser['name'],
        'sips': sips,
        'isFinale': is_finale,
    })
    if loser_id in j['active']:
        j['active'].remove(loser_id)

    add_sips(state, loser, sips)

    if is_finale:
        log_msg(state, f"🎵 Jizz Finale: {loser['name']} loses — drinks a shot ({sips} sips).")
    else:
        log_msg(state, f"🎵 Jizz Round {round_num}/{j['maxRounds']}: "
                       f"{loser['name']} eliminated — drinks {sips} sips.")

    if round_num >= j['maxRounds']:
        j['phase'] = 'done'
        winner_id = j['active'][0] if j['active'] else None
        winner_name = next((p['name'] for p in state['players'] if p['id'] == winner_id), '?')
        log_msg(state, f"🏆 Jizz Tournament complete. Winner: {winner_name}.")
    broadcast(state['code'])


@socketio.on('player:buyoutChoice')
def player_buyout_choice(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule']:
        return
    ar = state['activeRule']
    if 'buyout' not in ar or ar['buyout']['phase'] != 'choosing':
        return
    if ar['buyout']['playerId'] != (data or {}).get('playerId'):
        return
    choice = (data or {}).get('choice')
    p = next((pp for pp in state['players'] if pp['id'] == ar['buyout']['playerId']), None)
    if not p:
        return
    cost = ar['buyout']['cost']
    if choice == 'buyout':
        if p['gold'] < cost:
            return
        p['gold'] -= cost
        ar['buyout']['choice'] = 'buyout'
        ar['buyout']['phase'] = 'done'
        log_msg(state, f"💸 {p['name']} bought out for {cost} gold.")
    elif choice == 'accept':
        tokens = ar['buyout'].get('tokenIndicators')
        if tokens:
            apply_tokens(state, p, tokens)
        sips_val = ar.get('rule', {}).get('sips')
        if isinstance(sips_val, (int, float)) and sips_val > 0:
            add_sips(state, p, sips_val)
        ar['buyout']['choice'] = 'accept'
        ar['buyout']['phase'] = 'done'
        log_msg(state, f"😈 {p['name']} accepted the punishment.")
    else:
        return
    broadcast(state['code'])


@socketio.on('player:makeruleSubmit')
def player_makerule_submit(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule']:
        return
    ar = state['activeRule']
    if 'makerule' not in ar:
        return
    m = ar['makerule']
    if m.get('phase') != 'choosing':
        return
    if ar['playerId'] != (data or {}).get('playerId'):
        return
    text = ((data or {}).get('text') or '').strip()
    if not text:
        return
    if len(text) > 200:
        text = text[:200]
    p = next((pp for pp in state['players'] if pp['id'] == ar['playerId']), None)
    m['submittedText'] = text
    m['phase'] = 'resolved'
    state['makerules'].append({
        'text': text,
        'by': p['name'] if p else '?',
        'byId': ar['playerId'],
        'at': int(time.time() * 1000),
    })
    log_msg(state, f"📜 {p['name'] if p else '?'} made a rule: \"{text}\"")
    resolve_rule(state)
    broadcast(state['code'])


@socketio.on('player:rpsPick')
def player_rps_pick(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule'] or 'rps' not in state['activeRule']:
        return
    r = state['activeRule']['rps']
    if r['phase'] != 'picking':
        return
    pid = (data or {}).get('playerId')
    throw = (data or {}).get('throw')
    if pid not in r['participants']:
        return
    if throw not in ('rock', 'paper', 'scissors'):
        return
    if pid in r['picks']:
        return
    r['picks'][pid] = throw
    p = next((pp for pp in state['players'] if pp['id'] == pid), None)
    if p:
        log_msg(state, f"⚔️ {p['name']} has picked.")
    if all(pid in r['picks'] for pid in r['participants']):
        resolve_rps_round(state)
    broadcast(state['code'])


@socketio.on('player:endgameAction')
def player_endgame_action(data):
    code = (data or {}).get('code')
    state = rooms.get(code)
    if not state or state['paused'] or state['betGame']:
        return
    if state['roundPhase'] != 'playing':
        return

    action = (data or {}).get('action')
    sid = (data or {}).get('playerId')

    if action == 'rps-done':
        ar = state['activeRule']
        if not ar or 'rps' not in ar:
            return
        r = ar['rps']
        if r['phase'] != 'resolved':
            return
        if ar['playerId'] != sid:
            return
        cp = current_player(state)
        if not cp or cp['id'] != sid:
            return
        p = cp
        result = r['result']
        tile = ar['tile']

        if result['success']:
            next_tile = tile + 1
            p['position'] = next_tile
            special = SPECIAL_TILES.get(next_tile)
            if special and p['id'] not in state['specialArrivals'][next_tile]:
                state['specialArrivals'][next_tile].append(p['id'])
                order = len(state['specialArrivals'][next_tile])
                reward = max(0, 5 - (order - 1))
                p['gold'] += reward
                log_msg(state, f"{p['name']} → Special {special['id']} "
                               f"(tile {next_tile}). Reward {reward} gold.")
            state['activeRule'] = None
            log_msg(state, f"⚔️ {p['name']} advances to tile {next_tile} — turn ends.")
            advance_turn(state)
            broadcast(code)
            return
        else:
            state['activeRule'] = None
            log_msg(state, f"⚔️ {p['name']} stays on tile {tile} — turn ends.")
            advance_turn(state)
            broadcast(code)
            return

    if action == 'jizz-done':
        ar = state['activeRule']
        if not ar or 'jizz' not in ar:
            return
        j = ar['jizz']
        if j['phase'] != 'done':
            return
        if ar['playerId'] != sid:
            return
        cp = current_player(state)
        if not cp or cp['id'] != sid:
            return
        p = cp
        tile = ar['tile']

        eliminated_early = any(
            h['loserId'] == sid and not h['isFinale'] for h in j['history']
        )

        state['activeRule'] = None

        if not eliminated_early:
            next_tile = tile + 1
            p['position'] = next_tile
            log_msg(state, f"🏆 {p['name']} made top 2 — advances to tile {next_tile} — turn ends.")
            special = SPECIAL_TILES.get(next_tile)
            if special and p['id'] not in state['specialArrivals'][next_tile]:
                state['specialArrivals'][next_tile].append(p['id'])
                order = len(state['specialArrivals'][next_tile])
                reward = max(0, 5 - (order - 1))
                p['gold'] += reward
                log_msg(state, f"{p['name']} → Special {special['id']} "
                               f"(tile {next_tile}). Reward {reward} gold.")
            advance_turn(state)
            broadcast(code)
            return
        else:
            log_msg(state, f"😢 {p['name']} was eliminated before the finale — "
                           f"stays on tile {tile} — turn ends.")
            advance_turn(state)
            broadcast(code)
            return

    if action == 'song-wrong':
        ar = state['activeRule']
        if not ar or 'song' not in ar:
            return
        if ar['playerId'] != sid:
            return
        s = ar['song']
        if s['phase'] != 'guessing':
            return
        p = next((pp for pp in state['players'] if pp['id'] == sid), None)
        s['wrongGuesses'] += 1
        add_sips(state, p, HALF_SHOT_SIPS)
        log_msg(state, f"🎵 Wrong guess ({s['wrongGuesses']}/{s['maxGuesses']}) — "
                       f"{p['name'] if p else '?'} drinks half a shot.")
        if s['wrongGuesses'] >= s['maxGuesses']:
            log_msg(state, f"❌ {p['name'] if p else '?'} used all 3 guesses — "
                           f"stays on tile {ar['tile']} — turn ends.")
            state['activeRule'] = None
            advance_turn(state)
        broadcast(code)
        return

    if action == 'song-correct':
        ar = state['activeRule']
        if not ar or 'song' not in ar:
            return
        if ar['playerId'] != sid:
            return
        s = ar['song']
        if s['phase'] != 'guessing':
            return
        cp = current_player(state)
        if not cp or cp['id'] != sid:
            return
        p = cp
        next_tile = ar['tile'] + 1
        p['position'] = next_tile
        log_msg(state, f"✅ {p['name']} guessed the song correctly — advances to tile {next_tile} — turn ends.")
        special = SPECIAL_TILES.get(next_tile)
        if special and p['id'] not in state['specialArrivals'][next_tile]:
            state['specialArrivals'][next_tile].append(p['id'])
            order = len(state['specialArrivals'][next_tile])
            reward = max(0, 5 - (order - 1))
            p['gold'] += reward
            log_msg(state, f"{p['name']} → Special {special['id']} "
                           f"(tile {next_tile}). Reward {reward} gold.")
        state['activeRule'] = None
        advance_turn(state)
        broadcast(code)
        return

    if state['activeRule']:
        ar = state['activeRule']
        cp_check = current_player(state)
        is_own_endgame_info = (
            cp_check and cp_check['id'] == sid
            and ar.get('tile') == cp_check['position']
            and ar.get('tile') in ENDGAME_TILES
            and 'rps' not in ar and 'jizz' not in ar and 'song' not in ar
        )
        if not is_own_endgame_info:
            return

    cp = current_player(state)
    if not cp or cp['id'] != sid:
        return
    p = cp
    if p['finished']:
        return
    tile = p['position']
    if tile < ENDGAME_FIRST or tile > 99:
        return

    if action == 'rps-start':
        rule = TILE_RULES.get(tile)
        if not rule or rule.get('minigame') != 'rps':
            return
        participants = [pp['id'] for pp in state['players'] if not pp['finished']]
        if len(participants) < 2:
            next_tile = tile + 1
            p['position'] = next_tile
            log_msg(state, f"⚔️ RPS: no opponents, {p['name']} advances to tile {next_tile} — turn ends.")
            special = SPECIAL_TILES.get(next_tile)
            if special and p['id'] not in state['specialArrivals'][next_tile]:
                state['specialArrivals'][next_tile].append(p['id'])
                order = len(state['specialArrivals'][next_tile])
                reward = max(0, 5 - (order - 1))
                p['gold'] += reward
                log_msg(state, f"{p['name']} → Special {special['id']} "
                               f"(tile {next_tile}). Reward {reward} gold.")
            state['activeRule'] = None
            advance_turn(state)
            broadcast(code)
            return

        state['activeRule'] = {
            'kind': 'rps',
            'playerId': p['id'],
            'tile': tile,
            'rule': rule,
            'rps': {
                'phase': 'picking',
                'landerId': p['id'],
                'participants': participants,
                'picks': {},
                'result': None,
            },
        }
        log_msg(state, f"⚔️ RPS started — {p['name']} challenges "
                       f"{len(participants) - 1} opponent(s).")
        broadcast(code)
        return

    if action == 'jizz-start':
        rule = TILE_RULES.get(tile)
        if not rule or rule.get('minigame') != 'jizz':
            return
        participants = [pp['id'] for pp in state['players'] if not pp['finished']]
        if len(participants) < 2:
            next_tile = tile + 1
            p['position'] = next_tile
            log_msg(state, f"🎵 Jizz Tournament skipped — {p['name']} advances to tile {next_tile} — turn ends.")
            special = SPECIAL_TILES.get(next_tile)
            if special and p['id'] not in state['specialArrivals'][next_tile]:
                state['specialArrivals'][next_tile].append(p['id'])
                order = len(state['specialArrivals'][next_tile])
                reward = max(0, 5 - (order - 1))
                p['gold'] += reward
                log_msg(state, f"{p['name']} → Special {special['id']} "
                               f"(tile {next_tile}). Reward {reward} gold.")
            state['activeRule'] = None
            advance_turn(state)
            broadcast(code)
            return

        max_rounds = len(participants) - 1
        state['activeRule'] = {
            'kind': 'jizz',
            'playerId': p['id'],
            'tile': tile,
            'rule': rule,
            'jizz': {
                'phase': 'picking',
                'maxRounds': max_rounds,
                'participants': list(participants),
                'active': list(participants),
                'history': [],
                'sipsPerLoss': 3,
                'finaleLossSips': 7,
                'landerId': p['id'],
            },
        }
        log_msg(state, f"🎵 Jizz Tournament started — {len(participants)} players, "
                       f"{max_rounds} round(s). Lander: {p['name']}.")
        broadcast(code)
        return

    if action == 'song-start':
        rule = TILE_RULES.get(tile)
        if not rule or rule.get('minigame') != 'song':
            return
        state['activeRule'] = {
            'kind': 'song',
            'playerId': p['id'],
            'tile': tile,
            'rule': rule,
            'song': {
                'phase': 'guessing',
                'wrongGuesses': 0,
                'maxGuesses': 3,
            },
        }
        log_msg(state, f"🎵 Guess the Song started — {p['name']} has 3 guesses.")
        broadcast(code)
        return

    if tile == 99:
        if action != 'roll':
            return
        die = roll_die()
        log_msg(state, f"🎲 Endgame: {p['name']} at 99 rolls {die}.")
        state['lastRoll'] = {'playerId': p['id'], 'rolls': [die], 'total': die,
                             'at': int(time.time() * 1000), 'endgame99': True}
        if die == 6:
            p['position'] = FINISH_TILE
            p['finished'] = True
            p['finishRank'] = len([pp for pp in state['players'] if pp['finished']])
            log_msg(state, f"🏆 {p['name']} reached FINISH! Rank #{p['finishRank']}")
            if not state['winner']:
                state['winner'] = p['id']
        else:
            add_sips(state, p, die)
            log_msg(state, f"{p['name']} drinks {die} sip(s) and stays on tile 99.")
        advance_turn(state)
        broadcast(code)
        return

    if action == 'success':
        nxt = tile + 1
        p['position'] = nxt
        log_msg(state, f"✅ Endgame: {p['name']} succeeds at tile {tile} → tile {nxt} — turn ends.")
        special = SPECIAL_TILES.get(nxt)
        if special and p['id'] not in state['specialArrivals'][nxt]:
            state['specialArrivals'][nxt].append(p['id'])
            order = len(state['specialArrivals'][nxt])
            reward = max(0, 5 - (order - 1))
            p['gold'] += reward
            log_msg(state, f"{p['name']} → Special {special['id']} (tile {nxt}). "
                           f"Reward {reward} gold.")
        state['activeRule'] = None
        advance_turn(state)
        broadcast(code)
        return

    if action == 'fail':
        log_msg(state, f"❌ Endgame: {p['name']} fails at tile {tile} — drinks. "
                       f"Stays on tile {tile} — turn ends.")
        state['activeRule'] = None
        advance_turn(state)
        broadcast(code)
        return


@socketio.on('player:gambleChoice')
def player_gamble_choice(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['activeRule']:
        return
    ar = state['activeRule']
    if 'gamble' not in ar or ar['gamble']['phase'] != 'choosing':
        return
    if ar['playerId'] != (data or {}).get('playerId'):
        return
    try:
        n = int((data or {}).get('choice'))
    except (TypeError, ValueError):
        return
    if n < 1 or n > 5:
        return
    p = next((pp for pp in state['players'] if pp['id'] == ar['playerId']), None)
    if not p:
        return
    die = roll_die()
    ar['gamble']['chosen'] = n
    ar['gamble']['die'] = die
    if die > n:
        gold = round_half((n / 2) * 2) / 2
        p['gold'] += gold
        ar['gamble']['outcome'] = 'win'
        ar['gamble']['goldDelta'] = gold
        ar['gamble']['sipsDelta'] = 0
        log_msg(state, f"🎲 Gamble: {p['name']} chose {n}, rolled {die} → WIN +{gold} gold.")
    elif die < n:
        sips = n * 2
        ar['gamble']['outcome'] = 'lose'
        ar['gamble']['goldDelta'] = 0
        ar['gamble']['sipsDelta'] = sips
        add_sips(state, p, sips)
        log_msg(state, f"🎲 Gamble: {p['name']} chose {n}, rolled {die} → LOSE, "
                       f"drinks {sips} sips.")
    else:
        sips = n * 2
        ar['gamble']['outcome'] = 'tie'
        ar['gamble']['goldDelta'] = 0
        ar['gamble']['sipsDelta'] = sips
        add_sips(state, p, sips)
        log_msg(state, f"🎲 Gamble: {p['name']} chose {n}, rolled {die} → tie, "
                       f"still drinks {sips} sips.")
    ar['gamble']['phase'] = 'resolved'
    broadcast(state['code'])


@socketio.on('player:rollOff')
def player_roll_off(data):
    state = rooms.get((data or {}).get('code'))
    if not state or state['roundPhase'] != 'roll-off':
        return
    pid = (data or {}).get('playerId')
    p = next((pp for pp in state['players'] if pp['id'] == pid), None)
    if not p:
        return

    candidates = state.get('rollOffCandidates') or [pp['id'] for pp in state['players']]
    if pid not in candidates:
        return
    if pid in state['rollOff']:
        return

    v = roll_die()
    state['rollOff'][pid] = v
    log_msg(state, f"{p['name']} roll-off: {v}.")

    if all(cid in state['rollOff'] for cid in candidates):
        resolve_roll_off(state)
    broadcast(state['code'])


@socketio.on('player:roll')
def player_roll(data):
    state = rooms.get((data or {}).get('code'))
    if not state or state['paused'] or state['betGame'] or state['activeRule']:
        return
    if state['roundPhase'] != 'playing':
        return
    cp = current_player(state)
    if not cp or cp['id'] != (data or {}).get('playerId'):
        return
    p = cp
    if p['finished']:
        return
    if in_endgame_zone(p):
        log_msg(state, f"{p['name']} is in endgame (tile {p['position']}) — use the endgame action.")
        broadcast(state['code'])
        return

    forced = take_forced_roll(state)
    r = roll_turn(forced_first=forced)
    if forced is not None:
        log_msg(state, f"🧪 {p['name']} forced first roll = {forced} "
                       f"[full: {', '.join(map(str, r['rolls']))}] → net {r['total']}.")
    else:
        log_msg(state, f"{p['name']} rolls [{', '.join(map(str, r['rolls']))}] → net {r['total']}.")
    if r['events']:
        log_msg(state, ' '.join(r['events']))
    if r['sips'] > 0:
        log_msg(state, f"{p['name']} must give {r['sips']} sips (player chooses).")
    if r['goldFromRoll']:
        p['gold'] += r['goldFromRoll']
    if r['skipNext']:
        p['skipNextTurn'] = True

    state['lastRoll'] = {'playerId': p['id'], 'rolls': r['rolls'],
                          'total': r['total'], 'at': int(time.time() * 1000)}
    state['turnEndsAt'] = None

    for m in r['moves']:
        if m.get('noLand'):
            state['pendingQueue'].append({'kind': 'move', 'playerId': p['id'], 'delta': m['delta']})
        else:
            state['pendingQueue'].append({'kind': 'step', 'playerId': p['id'], 'delta': m['delta']})

    drain_queue(state)
    broadcast(state['code'])


@socketio.on('bet:bid')
def bet_bid(data):
    state = rooms.get((data or {}).get('code'))
    if not state or not state['betGame']:
        return
    pid = (data or {}).get('playerId')
    if pid not in state['betGame']['playerIds']:
        return
    try:
        raw = float((data or {}).get('bid') or 0)
    except (TypeError, ValueError):
        raw = 0
    rounded = int(round(raw / 10.0)) * 10
    rounded = max(10, min(100, rounded))
    state['betGame']['bids'][pid] = rounded
    if all(i in state['betGame']['bids'] for i in state['betGame']['playerIds']):
        resolve_bet_game(state)
    broadcast(state['code'])


@socketio.on('player:buy')
def player_buy(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    buyer = next((p for p in state['players'] if p['id'] == (data or {}).get('buyerId')), None)
    target = next((p for p in state['players'] if p['id'] == (data or {}).get('targetId')), None)
    if not buyer or not target:
        return
    prices = {'sips2': 1, 'halfShot': 2, 'shot': 3, 'chosenShot': 4, 'toiletCard': 3}
    item = (data or {}).get('item')
    cost = prices.get(item)
    if cost is None or buyer['gold'] < cost:
        return
    buyer['gold'] -= cost
    if item == 'toiletCard':
        buyer['toiletCards'] += 1
        log_msg(state, f"{buyer['name']} bought a toilet card ({cost} gold).")
    else:
        # Sips are only credited when the target actually presses Drink.
        target['pendingDrink'].append({'item': item, 'from': buyer['name'], 'cost': cost})
        log_msg(state, f"{buyer['name']} bought {item} for {target['name']} ({cost} gold).")
    broadcast(state['code'])


@socketio.on('player:acceptDrink')
def player_accept_drink(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    p = next((pp for pp in state['players'] if pp['id'] == (data or {}).get('playerId')), None)
    if not p:
        return
    idx = int((data or {}).get('index', -1))
    if idx < 0 or idx >= len(p['pendingDrink']):
        return
    drink = p['pendingDrink'][idx]
    item_sips = {'sips2': 2, 'halfShot': HALF_SHOT_SIPS, 'shot': SHOT_SIPS, 'chosenShot': SHOT_SIPS}
    add_sips(state, p, item_sips.get(drink['item'], 0))
    p['pendingDrink'].pop(idx)
    log_msg(state, f"{p['name']} drank {drink['item']} from {drink['from']}.")
    broadcast(state['code'])


@socketio.on('player:refuseDrink')
def player_refuse_drink(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    p = next((pp for pp in state['players'] if pp['id'] == (data or {}).get('playerId')), None)
    if not p:
        return
    idx = int((data or {}).get('index', -1))
    if idx < 0 or idx >= len(p['pendingDrink']):
        return
    drink = p['pendingDrink'][idx]
    refund = ceil_half(drink['cost'] / 2)
    if p['gold'] < refund:
        return
    # Refuser pays half of the price; that half goes to the buyer (not the bank),
    # and the buyer is only refunded that same half (both net-lose half).
    p['gold'] -= refund
    buyer = next((pp for pp in state['players'] if pp['name'] == drink['from']), None)
    if buyer:
        buyer['gold'] += refund
    p['pendingDrink'].pop(idx)
    log_msg(state, f"{p['name']} refused — paid {refund} gold to {drink['from']} "
                   f"(both lose half).")
    broadcast(state['code'])


@socketio.on('player:useToilet')
def player_use_toilet(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    p = next((pp for pp in state['players'] if pp['id'] == (data or {}).get('playerId')), None)
    if not p or p['toiletCards'] <= 0:
        return
    p['toiletCards'] -= 1
    state['paused'] = True
    state['pauseReason'] = f"{p['name']} is on a toilet break."
    log_msg(state, f"{p['name']} used a toilet card — game paused.")
    broadcast(state['code'])


@socketio.on('player:adjustSips')
def player_adjust_sips(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    pid = (data or {}).get('playerId')
    p = next((pp for pp in state['players'] if pp['id'] == pid), None)
    if not p:
        return
    try:
        delta = float((data or {}).get('delta') or 0)
    except (TypeError, ValueError):
        return
    if delta == 0:
        return
    old = float(p.get('totalSips', 0))
    new = max(0.0, old + delta)
    p['totalSips'] = new
    sign = '+' if delta > 0 else ''
    log_msg(state, f"🧪 {p['name']} sips adjusted: {sign}{delta} (now {new}).")
    broadcast(state['code'])


@socketio.on('player:chooseOrder')
def player_choose_order(data):
    state = rooms.get((data or {}).get('code'))
    if not state:
        return
    if state['orderChooserId'] != (data or {}).get('playerId'):
        return
    chooser = next((p for p in state['players'] if p['id'] == (data or {}).get('playerId')), None)
    if not chooser:
        return
    starting = chooser['id']
    if (data or {}).get('choice') == 'last':
        ids = [p['id'] for p in state['players']]
        idx = ids.index(chooser['id'])
        starting = state['players'][(idx + 1) % len(state['players'])]['id']
    build_turn_order(state, starting)
    state['roundPhase'] = 'playing'
    state['orderChooserId'] = None
    seek_playable_turn(state)
    log_msg(state, f"{chooser['name']} chose to go {(data or {}).get('choice')}. Turn order set.")
    start_turn(state)
    broadcast(state['code'])


def timer_loop():
    while True:
        time.sleep(1)
        try:
            with state_lock:
                for code in list(rooms.keys()):
                    state = rooms.get(code)
                    if not state:
                        continue

                    ar = state.get('activeRule')
                    if ar and 'straw' in ar:
                        s = ar['straw']
                        if s.get('phase') == 'running' and s.get('startedAt'):
                            elapsed = int(time.time() * 1000) - s['startedAt']
                            if elapsed >= s.get('durationMs', 60000):
                                s['phase'] = 'done'
                                s['finishedAt'] = int(time.time() * 1000)
                                log_msg(state, "⏱ Straw Transfer: time's up!")
                                broadcast(code)

                    if state['paused'] or not state['turnEndsAt']:
                        continue
                    if state['roundPhase'] != 'playing':
                        continue
                    if state['activeRule'] or state['betGame']:
                        continue
                    if time.time() * 1000 < state['turnEndsAt']:
                        continue
                    cp = current_player(state)
                    if not cp or in_endgame_zone(cp):
                        continue
                    state['turnEndsAt'] = None
                    action = state['settings']['timerAction']
                    log_msg(state, f"⏰ Timer expired for {cp['name']} — action: {action}.")
                    if action == 'auto-roll':
                        forced = take_forced_roll(state)
                        r = roll_turn(forced_first=forced)
                        if forced is not None:
                            log_msg(state, f"🧪 {cp['name']} forced first roll = {forced} "
                                           f"[full: {', '.join(map(str, r['rolls']))}] → net {r['total']}.")
                        else:
                            log_msg(state, f"{cp['name']} auto-rolls "
                                           f"[{', '.join(map(str, r['rolls']))}] → net {r['total']}.")
                        if r['goldFromRoll']:
                            cp['gold'] += r['goldFromRoll']
                        if r['skipNext']:
                            cp['skipNextTurn'] = True
                        for m in r['moves']:
                            if m.get('noLand'):
                                state['pendingQueue'].append({'kind': 'move', 'playerId': cp['id'],
                                                              'delta': m['delta']})
                            else:
                                state['pendingQueue'].append({'kind': 'step', 'playerId': cp['id'],
                                                              'delta': m['delta']})
                        drain_queue(state)
                    elif action == 'auto-pass':
                        advance_turn(state)
                    elif action == 'lose-turn':
                        cp['skipNextTurn'] = True
                        advance_turn(state)
                    broadcast(code)
        except Exception:
            print('[timer] error:')
            traceback.print_exc()


def get_lan_ips():
    ips = set()
    try:
        s = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        host = _socket.gethostname()
        for ip in _socket.gethostbyname_ex(host)[2]:
            if not ip.startswith('127.'):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


# Start the background timer thread as soon as the module loads, so it runs
# under gunicorn too (where __name__ != '__main__').
threading.Thread(target=timer_loop, daemon=True).start()


if __name__ == '__main__':
    PORT = int(os.environ.get('PORT', 3000))

    print()
    print("Drink Board Game server running (Python).")
    print(f"Host:  http://localhost:{PORT}/host.html")
    print(f"Local: http://localhost:{PORT}/local.html")
    print(f"Play:  http://localhost:{PORT}/play.html")
    ips = get_lan_ips()
    if ips:
        print("\nOn your LAN (phones):")
        for ip in ips:
            print(f"  http://{ip}:{PORT}/play.html")
    print()
    print("Diagnostics: http://localhost:{}/debug".format(PORT))
    print()

    socketio.run(app, host='0.0.0.0', port=PORT, allow_unsafe_werkzeug=True)