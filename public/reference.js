window.GameReference = (function () {
  const commonRules = [
    {
      n: 1,
      title: 'Rounds & Phases',
      text:
        'The game is played in rounds and phases. Rounds go clockwise. The richest player chooses to go first or last each round (first round: everyone rolls, highest goes first; ties re-roll until a single highest). A round ends when everyone around the table has taken a turn. No interrupting, stalling, or hampering a round. An optional per-turn timer can be set on the host before the round starts and changed between rounds. There are 6 phases, each made up of as many rounds as necessary — see rule 4 on special tiles.',
    },
    {
      n: 2,
      title: 'Phone rule',
      text:
        "Don't minimize the game on your phone unless the game itself requires it. Doing so costs the punishment 'X' set by the host (customisable before the game or between rounds).",
    },
    {
      n: 3,
      title: 'Toilet breaks',
      text:
        'Press the toilet button on your phone to request a break. If you hold a toilet card, the game pauses for everyone as soon as the current round ends. You resume from your phone when you are back.',
    },
    {
      n: 4,
      title: 'Special tiles',
      text:
        '9 special tiles: 16, 32, 48, 64, 80, 96, 97, 98, 99 — yellow with red bold text, labelled "Special 1"…"Special 9". The first player to reach a special tile gains 5 gold; every subsequent arrival gains 1 gold less (minimum 0 — never negative). Tiles 16–80 end their phase: everyone must arrive before the next phase begins, and players already there are "on break" (they may toilet freely and are exempt from drinking, buying, and receiving drinks). Tiles 96–99 are endgame minigames.',
    },
    {
      n: 5,
      title: 'Landing on the same tile',
      text:
        'Landing on the same tile as another player (except special tiles) starts a Bet Game between everyone currently on that tile.',
    },
    {
      n: 6,
      title: 'Gold',
      text:
        'Everyone starts with 10 gold (host-configurable). All gold prices are rounded up in intervals of 0.5 gold.',
    },
    {
      n: 7,
      title: 'Buying drinks on your turn',
      text:
        'When it is your turn you may buy a drink for another player, paid at the end of the round: (a) 2 sips of their own drink — 1 gold; (b) half a shot of their choosing (min 25%) — 2 gold; (c) one shot of their choosing (min 25%) — 3 gold; (d) one shot of your choosing (max 55%) — 4 gold; (e) a toilet break card for yourself — 3 gold.',
    },
    {
      n: 8,
      title: 'Refusing a bought drink',
      text:
        'If you do not want to drink what was bought for you, pay the bank half of the original cost. The buyer is refunded in full.',
    },
    {
      n: 9,
      title: 'No mid-round quitting',
      text:
        'You cannot quit in the middle of a round. If you must leave, do it after the round ends. (This prevents screwing another player over and then quitting.)',
    },
    {
      n: 10,
      title: 'Rolling a 1',
      text:
        'Roll again. If it is another 1, roll again and give 2 sips. If it is a third 1, gain 2 gold, give 4 more sips, and skip your next turn.',
    },
    {
      n: 11,
      title: 'Rolling a 6',
      text:
        'Roll again. If it is another 6, move back 6 tiles — i.e. return to the tile you started this turn from.',
    },
    {
      n: 12,
      title: 'Sips & shots',
      text:
        '1 shot ≈ 6–8 sips ≈ 1 small beer bottle / glass. 1 sip ≈ 25–33 ml.',
    },
    {
      n: 13,
      title: 'Do not mention the game',
      text:
        'Mentioning the game in any way — even saying that you lost it — costs you 1 sip. ("You mentioned that which should not.")',
    },
  ];

  const minigames = [
    {
      key: 'betgame',
      icon: '🎲',
      title: 'Bet Game',
      text:
        'Roll a die for the stakes: 1–2 → half a shot, 3–4 → one shot, 5–6 → two shots. Everyone then secretly bids a multiple of 10% (entered on their phone, or written down in local mode). The bid is the share of your total gold you are willing to pay to NOT drink. The highest bidder pays their percentage of their total gold to the lowest bidder. The lowest bidder drinks the stake. Everyone who bid below the average of highest & lowest drinks half the stake. If there is no unique lowest bid, everyone drinks half. Players with 0 gold automatically lose and receive 15% of the gold of the other players on the tile.',
    },
    {
      key: 'thumbmaster',
      icon: '👍',
      title: 'Thumbmaster',
      text:
        'When others are not drinking, the Thumbmaster can place their thumb on the table. The last player to follow suit drinks 1 sip. The Thumbmaster can only be dethroned by a new Thumbmaster.',
    },
    {
      key: 'jizz',
      icon: '🎵',
      title: 'Jizz (-die)',
      text:
        'Count up from 1. On any multiple of 7, any number containing a 7, or any number with repeating digits (11, 22, 33, …), say "Jizz!" instead of the number. Examples: 7, 11, 14, 17, 21, 22, 28, 33, 35, 37, 42, 44, 47, 49. Wrong call = drink the agreed sip penalty. Jizz-die: roll a die first to set how many sips the loser of the Jizz game must drink.',
    },
  ];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderCommonRulesHTML() {
    return (
      '<ol class="ref-list">' +
      commonRules
        .map(
          (r) =>
            '<li class="ref-list-item">' +
            '<div class="ref-item-title">' +
            esc(r.title) +
            '</div>' +
            '<div class="ref-item-text">' +
            esc(r.text) +
            '</div>' +
            '</li>'
        )
        .join('') +
      '</ol>'
    );
  }

  function renderMinigamesHTML() {
    return (
      '<div class="ref-minigames">' +
      minigames
        .map(
          (m) =>
            '<div class="ref-minigame">' +
            '<div class="ref-item-title">' +
            m.icon +
            ' ' +
            esc(m.title) +
            '</div>' +
            '<div class="ref-item-text">' +
            esc(m.text) +
            '</div>' +
            '</div>'
        )
        .join('') +
      '</div>'
    );
  }

  return { commonRules, minigames, renderCommonRulesHTML, renderMinigamesHTML };
})();