// The placeholder dog, drawn in text (our own art), facing left like the
// purchased one. Same animation names and lengths as the rig, so the same
// state machine drives it.
(function () {
  'use strict';

  const HEAD = [
    String.raw`   ,/\_/\           `,
    String.raw`  /  o   \          `,
  ];
  const HEAD_BLINK = [
    String.raw`   ,/\_/\           `,
    String.raw`  /  -   \          `,
  ];
  const HEAD_TWITCH = [
    String.raw`   ,/\_/|           `,
    String.raw`  /  o   \          `,
  ];

  const body = (tail) => [
    String.raw` (_.      \_____________ `,
    String.raw`    \_____              \ `.trimEnd() + (tail[0] || ''),
    String.raw`          | |       | |  \ `.trimEnd() + (tail[1] || ''),
  ];

  const LEGS = {
    stand: [String.raw`          | |       | |`, String.raw`          "-"       "-"`],
    walkA: [String.raw`          | |       | |`, String.raw`          "-"       "-"`],
    walkB: [String.raw`         / /       / /`, String.raw`        "-"       "-"`],
    runA: [String.raw`        //           \\`, String.raw`       "'             '"`],
    runB: [String.raw`          \\       //`, String.raw`           '"     "'`],
    tucked: [String.raw`          \ \       \ \ `, String.raw`           ' '       ' '`],
  };

  const standing = (head, tail, legs) => [...head, ...body(tail), ...legs];

  const TAIL_DOWN = ['', '~'];
  const TAIL_UP = ['/', ''];
  const TAIL_MID = ['_', '~'];

  const SIT = [
    String.raw`   ,/\_/\           `,
    String.raw`  /  o   \          `,
    String.raw` (_.      \__       `,
    String.raw`    \_____   \      `,
    String.raw`       | |    \     `,
    String.raw`       | |  ___)_~  `,
    String.raw`       "-" (____)   `,
  ];
  const SIT_WAG = SIT.map((r, i) => (i === 5 ? String.raw`       | |  ___)_/  ` : r));
  const SIT_BLINK = SIT.map((r, i) => (i === 1 ? String.raw`  /  -   \          ` : r));

  const HALF = [
    String.raw`   ,/\_/\           `,
    String.raw`  /  o   \          `,
    String.raw` (_.      \________ `,
    String.raw`    \_____         \ `,
    String.raw`          | |    __ \~`,
    String.raw`          | |   (___)`,
    String.raw`          "-"        `,
  ];

  const BEG_UP = [
    String.raw`   ,/\_/\           `,
    String.raw`  /  o   \          `,
    String.raw` (_.      \__       `,
    String.raw` _  \_____   \      `,
    String.raw`(_)====.      \     `,
    String.raw`       | |  ___)_~  `,
    String.raw`       "-" (____)   `,
  ];
  const BEG_MID = [
    String.raw`   ,/\_/\           `,
    String.raw`  /  o   \          `,
    String.raw` (_.      \__       `,
    String.raw`    \_____   \      `,
    String.raw`   (_)==.     \     `,
    String.raw`       | |  ___)_~  `,
    String.raw`       "-" (____)   `,
  ];

  const BARK_OPEN = [
    String.raw`   ,/\_/\                 `,
    String.raw`  /  o   \                 `,
    String.raw` <        \_____________   `,
    String.raw` (_.-'_____              \~`,
    String.raw`          | |       | |  \ `,
    ...LEGS.stand,
  ];

  const DOWN = [
    String.raw`          | |       | |   `,
    String.raw`          | |       | |   `,
    String.raw`    ______|_|_______|_|__  `,
    String.raw`   /  x   ___            \~`,
    String.raw`  (_.____/   \___________/ `,
  ];
  const FALLING = [
    String.raw`   ,/\_/\                 `,
    String.raw`  /  x   \                 `,
    String.raw` (_.      \____________    `,
    String.raw`    \_____             \__~`,
    String.raw`          \ \      \ \     `,
    String.raw`           ' '      ' '    `,
  ];

  // Frames per animation; a clip shows them evenly over its length.
  const FRAMES = {
    idle: [standing(HEAD, TAIL_DOWN, LEGS.stand), standing(HEAD, TAIL_DOWN, LEGS.stand), standing(HEAD_TWITCH, TAIL_DOWN, LEGS.stand), standing(HEAD_BLINK, TAIL_DOWN, LEGS.stand)],
    tail_wag: [standing(HEAD, TAIL_UP, LEGS.stand), standing(HEAD, TAIL_MID, LEGS.stand)],
    bark: [standing(HEAD, TAIL_DOWN, LEGS.stand), BARK_OPEN],
    to_sit: [standing(HEAD, TAIL_DOWN, LEGS.stand), HALF, SIT],
    from_sit: [SIT, HALF, standing(HEAD, TAIL_DOWN, LEGS.stand)],
    sitting_idle: [SIT, SIT_WAG, SIT, SIT_BLINK],
    beg: [SIT, BEG_MID, BEG_UP, BEG_UP, BEG_MID, SIT],
    die: [standing(HEAD, TAIL_DOWN, LEGS.stand), FALLING, DOWN],
    jump: [standing(HEAD, TAIL_DOWN, LEGS.stand), standing(HEAD, TAIL_UP, LEGS.tucked), standing(HEAD, TAIL_UP, LEGS.tucked), standing(HEAD, TAIL_DOWN, LEGS.stand)],
    walk: [standing(HEAD, TAIL_DOWN, LEGS.walkA), standing(HEAD, TAIL_MID, LEGS.walkB)],
    run: [standing(HEAD, TAIL_UP, LEGS.runA), standing(HEAD, TAIL_UP, LEGS.runB)],
  };

  // The rig's lengths (ms), so both renderers behave alike.
  const LENGTHS = { idle: 2000, bark: 800, tail_wag: 800, to_sit: 600, sitting_idle: 2000, beg: 1400, from_sit: 600, jump: 1400, run: 800, walk: 800, die: 1000 };

  // Height above the floor during a jump, 0..1 of the clip.
  const jumpLift = (u) => (u < 0.2 || u > 0.85 ? 0 : Math.sin(((u - 0.2) / 0.65) * Math.PI));

  class AsciiDog {
    constructor(stage) {
      this.el = document.createElement('pre');
      this.el.className = 'ascii-dog';
      this.bubble = document.createElement('div');
      this.bubble.className = 'ascii-bubble';
      this.bubble.textContent = 'WOOF!';
      stage.append(this.el, this.bubble);
      this.last = '';
    }

    length(anim) {
      return LENGTHS[anim] || 1000;
    }

    frame(anim, time) {
      const frames = FRAMES[anim] || FRAMES.idle;
      const u = Math.max(0, Math.min(0.9999, time / this.length(anim)));
      return frames[Math.floor(u * frames.length)];
    }

    draw(view, size) {
      const rows = this.frame(view.anim, view.time);
      const text = rows.join('\n');
      if (text !== this.last) { this.el.textContent = text; this.last = text; }
      // Font size from the stage height: about 40% of it for 7 rows.
      const font = Math.max(10, Math.round(size.h * 0.4 / 7 / 1.15));
      this.el.style.fontSize = `${font}px`;
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      const lift = view.anim === 'jump' ? jumpLift(view.time / this.length('jump')) * 0.18 : 0;
      const floor = size.h * 0.8;
      const x = view.x * size.w - w / 2;
      const y = floor - h - (view.hop + lift) * size.h;
      this.el.style.transform = `translate(${x}px, ${y}px) scale(${view.flip}, ${view.squash})`;
      const barking = view.anim === 'bark';
      this.bubble.style.opacity = barking ? '1' : '0';
      this.bubble.style.fontSize = `${font * 1.4}px`;
      const headX = view.flip >= 0 ? x - font * 2 : x + w - font * 4;
      this.bubble.style.transform = `translate(${headX}px, ${y - font * 2.2}px)`;
    }

    clear() {
      this.el.remove();
      this.bubble.remove();
    }
  }

  const ns = (window.CvDog = window.CvDog || {});
  ns.AsciiDog = AsciiDog;
})();
