// The dog's behaviour: commands in, a clip (animation + time) and a stage
// placement out, for whichever renderer draws it.
(function () {
  'use strict';

  const TURN_MS = 550;
  const PLAY_DEAD_HOLD_MS = 4000;
  const EDGE = 0.12; // how close to the stage's sides the dog may walk
  const DEFAULT_SPEED = { walk: 0.12, run: 0.3 }; // stage widths per second
  const MIN_SPEED = { walk: 0.05, run: 0.15 };
  const MAX_SPEED = 0.8;

  // Commands that may cut the current plan at the end of its current clip,
  // instead of waiting for the whole plan to finish.
  const URGENT = new Set(['owner_lost', 'stop']);

  class Dog {
    /** @param {(anim: string) => number} length an animation's length in ms */
    constructor(length) {
      this.length = length;
      this.posture = 'stand'; // stand | sit | down
      this.facing = 'left'; // the art faces left
      this.x = 0.5; // the dog's centre, 0..1 of the stage width
      this.moving = null; // {mode: walk|run, dir: left|right, speed}
      this.plan = [];
      this.step = null;
      this.pending = null;
      this.cutAfterClip = false;
      this.state = 'idle';
      this.rest();
    }

    /** Takes a command (the contract's `data` object). */
    command(cmd) {
      const name = cmd && cmd.command;
      if (!name) return;
      if ((name === 'walk' || name === 'run') && this.moving && this.posture === 'stand' && !this.plan.length) {
        // Already on the move: change pace or direction without a new plan.
        if (this.dirOf(cmd) === this.moving.dir) {
          this.moving = this.movement(name, cmd);
          this.setState(name);
          this.rest();
          return;
        }
      }
      if (name === 'idle' && !this.moving) return; // nothing to do
      this.pending = cmd;
      if (URGENT.has(name)) this.cutAfterClip = true;
      if (this.step && this.step.interruptible) this.next();
    }

    dirOf(cmd) {
      return cmd.direction === 'right' ? 'right' : 'left';
    }

    movement(mode, cmd) {
      let speed = Number(cmd.speed);
      if (!Number.isFinite(speed) || speed <= 0) speed = DEFAULT_SPEED[mode];
      speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED[mode], speed));
      return { mode, dir: this.dirOf(cmd), speed };
    }

    // Steps that bring the dog to a posture from where it is now.
    toStand() {
      if (this.posture === 'sit') return [{ anim: 'from_sit', then: () => (this.posture = 'stand') }];
      if (this.posture === 'down') return [{ anim: 'die', reverse: true, then: () => (this.posture = 'stand') }];
      return [];
    }

    toSit() {
      const s = this.posture === 'down' ? this.toStand() : [];
      if (this.posture !== 'sit') s.push({ anim: 'to_sit', then: () => (this.posture = 'sit') });
      return s;
    }

    planFor(cmd) {
      const name = cmd.command;
      const stop = this.moving ? [{ call: () => (this.moving = null) }] : [];
      switch (name) {
        case 'idle':
        case 'stop':
          return stop;
        case 'wag':
        case 'owner':
          return [...stop, ...this.toStand(), { anim: 'tail_wag', loops: 3 }];
        case 'sit':
        case 'owner_lost':
          return [...stop, ...this.toSit()];
        case 'stand':
          return [...stop, ...this.toStand()];
        case 'beg':
          return [...stop, ...this.toSit(), { anim: 'beg' }];
        case 'bark':
          return [...stop, ...this.toStand(), { anim: 'bark', loops: 2 }];
        case 'jump':
          return [...stop, ...this.toStand(), { anim: 'jump' }];
        case 'play_dead':
          return [
            ...stop,
            ...this.toStand(),
            { anim: 'die', then: () => (this.posture = 'down') },
            { anim: 'die', hold: PLAY_DEAD_HOLD_MS, interruptible: true },
            { anim: 'die', reverse: true, then: () => (this.posture = 'stand') },
          ];
        case 'turn':
          return [...stop, ...this.toStand(), { turn: true }];
        case 'walk':
        case 'run': {
          const m = this.movement(name, cmd);
          const steps = [...this.toStand()];
          if (m.dir !== this.facing) steps.push({ turn: true });
          steps.push({ call: () => (this.moving = m) });
          return steps;
        }
        default:
          return null;
      }
    }

    setState(s) {
      this.state = s;
    }

    /** The resting loop for the current posture: interruptible. */
    rest() {
      let anim = 'idle';
      if (this.moving) anim = this.moving.mode;
      else if (this.posture === 'sit') anim = 'sitting_idle';
      else if (this.posture === 'down') anim = 'die';
      this.step = { anim, loops: Infinity, interruptible: true, hold: this.posture === 'down' ? Infinity : 0 };
      this.step.t = this.posture === 'down' && !this.moving ? this.length('die') : 0;
      if (!this.moving) this.setState(this.posture === 'sit' ? 'sitting' : this.posture === 'down' ? 'down' : 'idle');
    }

    /** Moves to the next step, picking up a pending command when free. */
    next() {
      if (this.pending && (!this.plan.length || this.cutAfterClip || (this.step && this.step.interruptible))) {
        const cmd = this.pending;
        this.pending = null;
        this.cutAfterClip = false;
        const plan = this.planFor(cmd);
        if (plan) {
          this.plan = plan;
          this.setState(cmd.command);
        }
      }
      while (this.plan.length) {
        const s = this.plan.shift();
        if (s.call) { s.call(); continue; }
        this.step = { ...s, t: 0, loop: 0 };
        if (s.reverse) this.step.t = this.length(s.anim);
        if (s.hold) this.step.t = this.length(s.anim);
        if (s.turn) this.step.anim = 'idle';
        return;
      }
      this.rest();
    }

    /** Advances by dt milliseconds. */
    update(dt) {
      const s = this.step;
      if (this.moving && !this.plan.length && s.interruptible) {
        const sign = this.moving.dir === 'right' ? 1 : -1;
        this.x += sign * this.moving.speed * (dt / 1000);
        if (this.x < EDGE || this.x > 1 - EDGE) {
          this.x = Math.min(1 - EDGE, Math.max(EDGE, this.x));
          this.moving = null; // the edge of the stage: stop there
          this.rest();
          return;
        }
      }
      if (s.turn) {
        s.turnT = (s.turnT || 0) + dt;
        s.t += dt;
        if (s.turnT >= TURN_MS) {
          this.facing = this.facing === 'left' ? 'right' : 'left';
          if (s.then) s.then();
          this.next();
        }
        return;
      }
      if (s.hold) {
        s.held = (s.held || 0) + dt;
        if (s.held >= s.hold) { if (s.then) s.then(); this.next(); }
        return;
      }
      const len = this.length(s.anim);
      s.t += s.reverse ? -dt : dt;
      const ended = s.reverse ? s.t <= 0 : s.t >= len;
      if (!ended) return;
      s.loop += 1;
      const loops = s.loops || 1;
      const cut = this.pending && (this.cutAfterClip || s.interruptible);
      if (s.loop < loops && !cut) {
        s.t = s.reverse ? s.t + len : s.t - len;
        return;
      }
      s.t = s.reverse ? 0 : len;
      if (s.then) s.then();
      this.next();
    }

    /** What to draw: the clip and the dog's placement on the stage. */
    view() {
      const s = this.step;
      const len = this.length(s.anim);
      // A one-shot clip's last frame is its end pose, not the loop's start.
      let time = s.t;
      if (!(s.loops === Infinity) && time >= len) time = len - 1;
      let flip = this.facing === 'left' ? 1 : -1;
      let hop = 0, squash = 1;
      if (s.turn) {
        const u = Math.min(1, (s.turnT || 0) / TURN_MS);
        flip *= Math.cos(Math.PI * u); // through zero to the other side
        hop = Math.sin(Math.PI * u) * 0.08;
        squash = 1 - 0.06 * Math.sin(Math.PI * u);
      }
      return { anim: s.anim, time: Math.max(0, time), x: this.x, flip, hop, squash, state: this.state, posture: this.posture };
    }
  }

  const ns = (window.CvDog = window.CvDog || {});
  ns.Dog = Dog;
})();
