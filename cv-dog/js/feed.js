// The command feed: an SSE stream from the flwrs HTTP push sink, read with
// fetch so every event is seen whatever its `event:` name, with reconnects.
(function () {
  'use strict';

  /** A command from one SSE event's data (json envelope or raw), or null. */
  function decode(text) {
    let v;
    try { v = JSON.parse(text); } catch { return null; }
    if (v && typeof v === 'object' && typeof v.command === 'string') return v;
    // The json envelope: {id, event?, content_type?, data, encoding?}.
    if (v && typeof v === 'object' && typeof v.data === 'string') {
      let inner = v.data;
      if (v.encoding === 'base64') {
        try { inner = new TextDecoder().decode(Uint8Array.from(atob(inner), (c) => c.charCodeAt(0))); } catch { return null; }
      }
      return decode(inner);
    }
    return null;
  }

  /** A command's `time` as epoch ms (number in s or ms, or a date string). */
  function timeOf(cmd) {
    const t = cmd.time;
    if (typeof t === 'number') return t > 1e12 ? t : t * 1000;
    if (typeof t === 'string') { const ms = Date.parse(t); return Number.isNaN(ms) ? null : ms; }
    return null;
  }

  class Feed {
    constructor(url, { onCommand, onState, onLog, staleMs }) {
      this.url = url;
      this.onCommand = onCommand;
      this.onState = onState || (() => {});
      this.onLog = onLog || (() => {});
      this.staleMs = staleMs;
      this.delay = 1000;
      this.stopped = false;
    }

    start() {
      this.connect();
    }

    stop() {
      this.stopped = true;
      if (this.abort) this.abort.abort();
    }

    setState(s, detail) {
      this.state = s;
      this.onState(s, detail);
    }

    async connect() {
      if (this.stopped) return;
      this.setState('connecting');
      this.abort = new AbortController();
      try {
        // No resume after a reconnect: old commands are stale for a live dog.
        const res = await fetch(this.url, { headers: { Accept: 'text/event-stream' }, cache: 'no-store', signal: this.abort.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        this.setState('live');
        this.delay = 1000;
        await this.read(res.body.getReader());
        throw new Error('stream ended');
      } catch (e) {
        if (this.stopped) return;
        this.setState('reconnecting', String(e.message || e));
        setTimeout(() => this.connect(), this.delay);
        this.delay = Math.min(10000, this.delay * 2);
      }
    }

    async read(reader) {
      const dec = new TextDecoder();
      let buf = '';
      let ev = { event: '', data: [], id: '' };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.search(/\r\n|\r|\n/)) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + (buf.startsWith('\r\n', nl) ? 2 : 1));
          if (line === '') { this.dispatch(ev); ev = { event: '', data: [], id: '' }; continue; }
          if (line.startsWith(':')) continue; // keep-alive comment
          const i = line.indexOf(':');
          const field = i < 0 ? line : line.slice(0, i);
          let val = i < 0 ? '' : line.slice(i + 1);
          if (val.startsWith(' ')) val = val.slice(1);
          if (field === 'data') ev.data.push(val);
          else if (field === 'event') ev.event = val;
          else if (field === 'id') ev.id = val;
        }
      }
    }

    dispatch(ev) {
      if (!ev.data.length) return;
      if (ev.event === 'flwrs-gap' || ev.event === 'flwrs-lagged') {
        this.onLog(`${ev.event} ${ev.data.join('\n')}`);
        return;
      }
      const cmd = decode(ev.data.join('\n'));
      if (!cmd) { this.onLog(`ignored: ${ev.data.join(' ').slice(0, 80)}`); return; }
      const t = timeOf(cmd);
      if (this.staleMs > 0 && t !== null && Date.now() - t > this.staleMs) {
        this.onLog(`stale (${Math.round((Date.now() - t) / 1000)} s): ${cmd.command}`);
        return;
      }
      this.onCommand(cmd, 'feed');
    }
  }

  const ns = (window.CvDog = window.CvDog || {});
  ns.Feed = Feed;
  ns.decodeCommand = decode;
})();
