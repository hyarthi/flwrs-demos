(function () {
'use strict';
// A small Spriter (.scml) player: bones, timelines, z-order, pivots,
// linear / instant / quadratic / cubic / bezier curves and spin, drawn on a
// 2D canvas from the body-part images. Enough for files exported by Spriter
// r11 (one entity, no character maps, sounds, tags or variables).

const num = (el, name, dflt) => {
  const v = el.getAttribute(name);
  return v === null ? dflt : parseFloat(v);
};

function children(el, tag) {
  return Array.from(el.children).filter((c) => c.tagName === tag);
}

function readSpatial(el, isBone) {
  return {
    x: num(el, 'x', 0),
    y: num(el, 'y', 0),
    angle: num(el, 'angle', 0),
    scaleX: num(el, 'scale_x', 1),
    scaleY: num(el, 'scale_y', 1),
    a: num(el, 'a', 1),
    folder: isBone ? null : num(el, 'folder', 0),
    file: isBone ? null : num(el, 'file', 0),
    pivotX: isBone ? null : num(el, 'pivot_x', NaN),
    pivotY: isBone ? null : num(el, 'pivot_y', NaN),
  };
}

function readCurve(el) {
  return {
    type: el.getAttribute('curve_type') || 'linear',
    c: [num(el, 'c1', 0), num(el, 'c2', 0), num(el, 'c3', 0), num(el, 'c4', 0)],
  };
}

/** Parses an .scml document into plain data. */
function parseScml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const root = doc.documentElement;
  if (root.tagName !== 'spriter_data') throw new Error('not a Spriter file');
  const folders = {};
  for (const f of children(root, 'folder')) {
    const files = {};
    for (const file of children(f, 'file')) {
      files[num(file, 'id')] = {
        name: file.getAttribute('name'),
        width: num(file, 'width', 0),
        height: num(file, 'height', 0),
        pivotX: num(file, 'pivot_x', 0),
        pivotY: num(file, 'pivot_y', 1),
      };
    }
    folders[num(f, 'id')] = files;
  }
  const entity = children(root, 'entity')[0];
  const animations = {};
  for (const an of children(entity, 'animation')) {
    const mainline = children(children(an, 'mainline')[0], 'key').map((k) => ({
      time: num(k, 'time', 0),
      curve: readCurve(k),
      bones: children(k, 'bone_ref').map((r) => ({
        id: num(r, 'id'),
        parent: num(r, 'parent', -1),
        timeline: num(r, 'timeline'),
        key: num(r, 'key'),
      })),
      objects: children(k, 'object_ref').map((r) => ({
        id: num(r, 'id'),
        parent: num(r, 'parent', -1),
        timeline: num(r, 'timeline'),
        key: num(r, 'key'),
        z: num(r, 'z_index', 0),
      })),
    }));
    const timelines = {};
    for (const tl of children(an, 'timeline')) {
      const keys = children(tl, 'key').map((k) => {
        const bone = children(k, 'bone')[0];
        const obj = children(k, 'object')[0];
        return {
          time: num(k, 'time', 0),
          spin: num(k, 'spin', 1),
          curve: readCurve(k),
          info: readSpatial(bone || obj, !!bone),
        };
      });
      timelines[num(tl, 'id')] = { name: tl.getAttribute('name'), keys };
    }
    const looping = an.getAttribute('looping');
    animations[an.getAttribute('name')] = {
      name: an.getAttribute('name'),
      length: num(an, 'length', 0),
      interval: num(an, 'interval', 100),
      looping: looping === null ? true : looping !== 'false',
      mainline,
      timelines,
    };
  }
  return { folders, animations };
}

const lerp = (a, b, t) => a + (b - a) * t;
const quad = (a, b, c, t) => lerp(lerp(a, b, t), lerp(b, c, t), t);
const cubic = (a, b, c, d, t) => lerp(quad(a, b, c, t), quad(b, c, d, t), t);

function bezier(x1, y1, x2, y2, t) {
  // Solve x(s) = t for s (Newton, then bisection), return y(s).
  const bx = (s) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 20; i++) {
    const x = bx(s);
    if (Math.abs(x - t) < 1e-5) break;
    if (x < t) lo = s; else hi = s;
    s = (lo + hi) / 2;
  }
  return by(s);
}

function applyCurve(curve, t) {
  const [c1, c2, c3, c4] = curve.c;
  switch (curve.type) {
    case 'instant': return 0;
    case 'quadratic': return quad(0, c1, 1, t);
    case 'cubic': return cubic(0, c1, c2, 1, t);
    case 'quartic': return lerp(cubic(0, c1, c2, c3, t), cubic(c1, c2, c3, 1, t), t);
    case 'quintic': {
      const a = lerp(cubic(0, c1, c2, c3, t), cubic(c1, c2, c3, c4, t), t);
      const b = lerp(cubic(c1, c2, c3, c4, t), cubic(c2, c3, c4, 1, t), t);
      return lerp(a, b, t);
    }
    case 'bezier': return bezier(c1, c2, c3, c4, t);
    default: return t;
  }
}

function angleLerp(a, b, spin, t) {
  if (spin === 0) return a;
  if (spin > 0 && b - a < 0) b += 360;
  else if (spin < 0 && b - a > 0) b -= 360;
  return lerp(a, b, t);
}

function tween(a, b, spin, t) {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    angle: angleLerp(a.angle, b.angle, spin, t),
    scaleX: lerp(a.scaleX, b.scaleX, t),
    scaleY: lerp(a.scaleY, b.scaleY, t),
    a: lerp(a.a, b.a, t),
    folder: a.folder,
    file: a.file,
    pivotX: a.pivotX,
    pivotY: a.pivotY,
  };
}

function toWorld(local, parent) {
  if (!parent) return { ...local };
  const flip = parent.scaleX * parent.scaleY < 0 ? -1 : 1;
  const px = local.x * parent.scaleX;
  const py = local.y * parent.scaleY;
  const r = (parent.angle * Math.PI) / 180;
  const s = Math.sin(r), c = Math.cos(r);
  return {
    ...local,
    x: parent.x + px * c - py * s,
    y: parent.y + px * s + py * c,
    angle: parent.angle + flip * local.angle,
    scaleX: parent.scaleX * local.scaleX,
    scaleY: parent.scaleY * local.scaleY,
    a: parent.a * local.a,
  };
}

/** The world-space pose of an animation at `time` (ms). */
function pose(anim, time) {
  const len = anim.length;
  if (anim.looping && len > 0) time = ((time % len) + len) % len;
  else time = Math.max(0, Math.min(time, len));
  let mk = anim.mainline[0];
  for (const k of anim.mainline) if (k.time <= time) mk = k;

  const sample = (ref) => {
    const tl = anim.timelines[ref.timeline];
    const keyA = tl.keys[ref.key];
    let keyB = tl.keys[ref.key + 1];
    let timeB;
    if (keyB) timeB = keyB.time;
    else if (anim.looping && tl.keys.length > 1) { keyB = tl.keys[0]; timeB = len + keyB.time; }
    else if (anim.looping) { keyB = keyA; timeB = len; }
    if (!keyB || keyB === keyA || timeB === keyA.time) return keyA.info;
    let t = (time - keyA.time) / (timeB - keyA.time);
    if (t < 0) t = 0;
    t = applyCurve(keyA.curve, Math.min(1, t));
    return tween(keyA.info, keyB.info, keyA.spin, t);
  };

  const bones = [];
  for (const ref of mk.bones) {
    bones[ref.id] = toWorld(sample(ref), ref.parent >= 0 ? bones[ref.parent] : null);
  }
  const objects = mk.objects
    .map((ref) => ({ z: ref.z, info: toWorld(sample(ref), ref.parent >= 0 ? bones[ref.parent] : null) }))
    .sort((p, q) => p.z - q.z)
    .map((o) => o.info);
  return { bones, objects };
}

/** Loads an .scml file and its images; returns a player. */
async function loadSpriter(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const data = parseScml(await res.text());
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const images = {};
  await Promise.all(
    Object.entries(data.folders).flatMap(([fid, files]) =>
      Object.entries(files).map(([id, f]) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { images[`${fid}/${id}`] = img; resolve(); };
        img.onerror = () => reject(new Error(`image ${f.name}`));
        img.src = base + f.name;
      })),
    ),
  );
  return new SpriterRig(data, images);
}

class SpriterRig {
  constructor(data, images) {
    this.data = data;
    this.images = images;
  }

  has(name) { return name in this.data.animations; }

  length(name) { return this.data.animations[name].length; }

  pose(name, time) { return pose(this.data.animations[name], time); }

  /** The pose's bounding box in Spriter units (y up). */
  bounds(name, time) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of this.pose(name, time).objects) {
      const f = this.data.folders[o.folder][o.file];
      const pvx = Number.isNaN(o.pivotX) ? f.pivotX : o.pivotX;
      const pvy = Number.isNaN(o.pivotY) ? f.pivotY : o.pivotY;
      const r = (o.angle * Math.PI) / 180, s = Math.sin(r), c = Math.cos(r);
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const lx = (u - pvx) * f.width * o.scaleX;
        const ly = (v - pvy) * f.height * o.scaleY;
        const x = o.x + lx * c - ly * s, y = o.y + lx * s + ly * c;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    return { minX, minY, maxX, maxY };
  }

  /** Draws a pose with the current canvas transform (Spriter units, y up). */
  draw(ctx, name, time) {
    for (const o of this.pose(name, time).objects) {
      const f = this.data.folders[o.folder][o.file];
      const img = this.images[`${o.folder}/${o.file}`];
      if (!img || o.a <= 0) continue;
      const pvx = Number.isNaN(o.pivotX) ? f.pivotX : o.pivotX;
      const pvy = Number.isNaN(o.pivotY) ? f.pivotY : o.pivotY;
      ctx.save();
      ctx.globalAlpha *= o.a;
      ctx.translate(o.x, -o.y);
      ctx.rotate((-o.angle * Math.PI) / 180);
      ctx.scale(o.scaleX, o.scaleY);
      ctx.drawImage(img, -pvx * f.width, -(1 - pvy) * f.height, f.width, f.height);
      ctx.restore();
    }
  }
}

const ns = (window.CvDog = window.CvDog || {});
ns.parseScml = parseScml;
ns.pose = pose;
ns.loadSpriter = loadSpriter;
ns.SpriterRig = SpriterRig;
})();
