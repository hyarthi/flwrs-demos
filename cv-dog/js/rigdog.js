// Draws the purchased dog's Spriter rig on a canvas at any size.
(function () {
  'use strict';

  class RigDog {
    constructor(stage, rig) {
      this.rig = rig;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'rig-dog';
      stage.append(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.measure();
    }

    length(anim) {
      return this.rig.length(anim);
    }

    // The standing dog's visible extent (Spriter units), measured once from
    // pixels: the image bounds include transparent margins.
    measure() {
      const s = 0.25, W = 1200, H = 900, ox = 600, oy = 700;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.translate(ox, oy); ctx.scale(s, s);
      this.rig.draw(ctx, 'idle', 0);
      const d = ctx.getImageData(0, 0, W, H).data;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] > 32) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      this.box = {
        cx: ((x0 + x1) / 2 - ox) / s, // centre, Spriter x
        feet: (oy - y1) / s, // lowest point, Spriter y (up)
        height: (y1 - y0) / s,
        width: (x1 - x0) / s,
      };
      this.measureGround();
    }

    // The lowest visible point of every animation frame (Spriter y), so a
    // pose that reaches below the standing feet (lying down) is lifted onto
    // the floor instead of sinking into it. Measured once, at a small scale.
    measureGround() {
      const s = 0.1, W = 400, H = 300, ox = 200, oy = 220;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      this.ground = {};
      for (const [name, anim] of Object.entries(this.rig.data.animations)) {
        const step = anim.interval || 100;
        const lows = [];
        for (let t = 0; t <= anim.length; t += step) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, W, H);
          ctx.translate(ox, oy); ctx.scale(s, s);
          this.rig.draw(ctx, name, Math.min(t, anim.length - 1));
          const d = ctx.getImageData(0, 0, W, H).data;
          let low = -1;
          for (let y = H - 1; y >= 0 && low < 0; y--) {
            for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 32) { low = y; break; }
          }
          lows.push(low < 0 ? this.box.feet : (oy - low) / s);
        }
        this.ground[name] = { step, lows };
      }
    }

    /** How far to lift a frame so nothing is below the standing feet. */
    lift(anim, time) {
      const g = this.ground && this.ground[anim];
      if (!g) return 0;
      const i = Math.max(0, time / g.step);
      const a = g.lows[Math.min(g.lows.length - 1, Math.floor(i))];
      const b = g.lows[Math.min(g.lows.length - 1, Math.floor(i) + 1)];
      const low = a + (b - a) * (i - Math.floor(i));
      // Below a small threshold it's measuring noise: standing poses never bob.
      const below = this.box.feet - low;
      return below > this.box.height * 0.02 ? below : 0;
    }

    draw(view, size) {
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
      if (this.canvas.width !== W || this.canvas.height !== H) {
        this.canvas.width = W; this.canvas.height = H;
      }
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingQuality = 'high';
      // The standing dog is about 45% of the stage's height, or fits its width.
      const scale = Math.min((H * 0.45) / this.box.height, (W * 0.5) / this.box.width);
      const floor = H * 0.8;
      // Shadow
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.beginPath();
      const sw = this.box.width * scale * 0.42 * (1 - view.hop * 2);
      ctx.ellipse(view.x * W, floor, Math.max(10, sw), Math.max(4, sw * 0.08), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.translate(view.x * W, floor - view.hop * H);
      ctx.scale(view.flip * scale, view.squash * scale);
      // Feet on the floor, centred; lying poses lifted to rest on it.
      ctx.translate(-this.box.cx, this.box.feet - this.lift(view.anim, view.time));
      this.rig.draw(ctx, view.anim, view.time);
    }

    clear() {
      this.canvas.remove();
    }
  }

  const ns = (window.CvDog = window.CvDog || {});
  ns.RigDog = RigDog;
})();
