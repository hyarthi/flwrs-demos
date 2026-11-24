// Wires the page: config, the renderer (rig or text), the dog, the feed,
// keyboard shortcuts and the debug panel.
(function () {
  'use strict';
  const ns = window.CvDog;

  function config() {
    const c = { ...(window.CVDOG_CONFIG || {}) };
    const q = new URLSearchParams(location.search);
    for (const [k, v] of q) {
      if (['mirror', 'debug', 'ascii', 'captions'].includes(k)) c[k] = v !== '0' && v !== 'false';
      else if (k === 'stale_ms') c[k] = Number(v);
      else c[k] = v;
    }
    c.streamUrl = c.stream || `${String(c.sink || '').replace(/\/$/, '')}/subscribe/${encodeURIComponent(c.channel || 'dog')}`;
    return c;
  }

  const KEYS = [
    ['W', 'wag', { command: 'wag' }],
    ['S', 'sit', { command: 'sit' }],
    ['A', 'stand up', { command: 'stand' }],
    ['B', 'paws up (beg)', { command: 'beg' }],
    ['K', 'bark', { command: 'bark' }],
    ['D', 'play dead', { command: 'play_dead' }],
    ['J', 'jump', { command: 'jump' }],
    ['T', 'turn around', { command: 'turn' }],
    ['←/→', 'walk', null],
    ['⇧←/→', 'run', null],
    ['Space', 'stop', { command: 'stop' }],
    ['I', 'idle', { command: 'idle' }],
    ['O', 'owner found', { command: 'owner', person: 'keyboard' }],
    ['L', 'owner lost', { command: 'owner_lost', person: 'keyboard' }],
    ['G', 'debug panel', null],
    ['H', 'this help', null],
  ];

  async function main() {
    const cfg = config();
    const stage = document.getElementById('stage');
    const debugEl = document.getElementById('debug');
    const helpEl = document.getElementById('help');
    const hintEl = document.getElementById('hint');

    let renderer = null, rendererName = 'ascii';
    if (!cfg.ascii) {
      try {
        const rig = await ns.loadSpriter(cfg.rig);
        renderer = new ns.RigDog(stage, rig);
        rendererName = 'rig';
      } catch (e) {
        console.info('cv-dog: the purchased dog art is not there, using the text dog', e.message || e);
      }
    }
    if (!renderer) renderer = new ns.AsciiDog(stage);
    document.body.dataset.renderer = rendererName;

    const dog = new ns.Dog((a) => renderer.length(a));
    const log = [];
    let owner = null, feedState = 'off', feedDetail = '';

    // A short caption for owner changes: fades in, stays a few seconds, fades out.
    const captionEl = document.getElementById('caption');
    let captionTimer = 0;
    const caption = (text) => {
      if (!cfg.captions) return;
      captionEl.textContent = text;
      captionEl.classList.add('on');
      clearTimeout(captionTimer);
      captionTimer = setTimeout(() => captionEl.classList.remove('on'), 3500);
    };

    const note = (text) => {
      log.unshift(`${new Date().toLocaleTimeString()} ${text}`);
      log.length = Math.min(log.length, 10);
    };

    const apply = (cmd, source) => {
      cmd = { ...cmd };
      if (cfg.mirror && (cmd.command === 'walk' || cmd.command === 'run')) {
        cmd.direction = cmd.direction === 'right' ? 'left' : 'right';
      }
      if (cmd.command === 'owner') {
        owner = cmd.person ?? owner;
        caption(owner === null || owner === undefined ? 'Following someone new' : `Following person #${owner}`);
      }
      if (cmd.command === 'owner_lost') {
        owner = null;
        caption('Owner left, waiting 5 s');
      }
      const extra = cmd.direction ? ` ${cmd.direction}` : '';
      const who = cmd.person !== undefined && cmd.person !== null ? ` #${cmd.person}` : '';
      note(`${source}: ${cmd.command}${extra}${who}`);
      dog.command(cmd);
    };

    const feed = new ns.Feed(cfg.streamUrl, {
      onCommand: apply,
      onState: (s, d) => { feedState = s; feedDetail = d || ''; },
      onLog: note,
      staleMs: cfg.stale_ms,
    });
    feed.start();

    // Help
    helpEl.innerHTML = '<h2>Keys</h2><table>' + KEYS.map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`).join('') + '</table>';
    let debugOn = !!cfg.debug;
    const toggle = (el, on) => el.classList.toggle('on', on);
    toggle(debugEl, debugOn);
    setTimeout(() => hintEl.classList.add('gone'), 4000);

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (k === 'ArrowLeft' || k === 'ArrowRight') {
        apply({ command: e.shiftKey ? 'run' : 'walk', direction: k === 'ArrowLeft' ? 'left' : 'right', person: 'keyboard' }, 'key');
        e.preventDefault();
        return;
      }
      if (k === 'G') { debugOn = !debugOn; toggle(debugEl, debugOn); return; }
      if (k === 'H' || k === '?') { helpEl.classList.toggle('on'); return; }
      if (k === 'Escape') { helpEl.classList.remove('on'); return; }
      const key = k === ' ' ? 'Space' : k;
      const hit = KEYS.find(([kk, , c]) => kk === key && c);
      if (hit) { apply({ person: 'keyboard', ...hit[2] }, 'key'); e.preventDefault(); }
    });

    const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    let lastDebug = 0;
    const renderDebug = (now) => {
      if (!debugOn || now - lastDebug < 200) return;
      lastDebug = now;
      const v = dog.view();
      debugEl.innerHTML =
        `<div><b>feed</b> <span class="feed-${feedState}">${feedState}</span> ${esc(feedDetail)}</div>` +
        `<div class="url">${esc(cfg.streamUrl)}</div>` +
        `<div><b>dog</b> ${rendererName} · ${esc(v.state)} · ${esc(v.anim)} · ${v.posture}${dog.moving ? ` · ${dog.moving.mode} ${dog.moving.dir}` : ''}</div>` +
        `<div><b>owner</b> ${owner === null ? '–' : '#' + esc(owner)}</div>` +
        `<ol>${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
    };

    // Expose a little for tests and the console.
    window.cvdog = { dog, apply, feed: () => ({ state: feedState, detail: feedDetail }), renderer: rendererName, owner: () => owner, log };

    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min(100, now - last);
      last = now;
      dog.update(dt);
      renderer.draw(dog.view(), { w: stage.clientWidth, h: stage.clientHeight });
      renderDebug(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  main();
})();
