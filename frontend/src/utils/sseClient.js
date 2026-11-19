/**
 * Fetch-based Server-Sent Events client.
 * Unlike EventSource it can send the Authorization header, so the JWT never goes into the URL.
 *
 * - Reconnects with exponential backoff (1s → 30s, with jitter).
 * - Calls onFallback(true) after `fallbackAfter` consecutive failures so the app can poll instead,
 *   and onFallback(false) once a stream is healthy again.
 * - Stops for good on 401/403 or a `session_ended` event and calls onUnauthorized().
 */
export function createSSE({ url, getToken, onEvent, onStatus, onFallback, onUnauthorized, fallbackAfter = 4 }) {
  let ctrl = null;
  let stopped = true;
  let failures = 0;
  let retryTimer = null;
  let fallback = false;

  const setStatus = (s) => onStatus && onStatus(s);
  const setFallback = (v) => { if (v !== fallback) { fallback = v; onFallback && onFallback(v); } };

  function scheduleReconnect() {
    if (stopped) return;
    failures += 1;
    if (failures >= fallbackAfter) setFallback(true);
    const base = Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5));
    const delay = base / 2 + Math.random() * (base / 2);
    setStatus('reconnecting');
    retryTimer = setTimeout(connect, delay);
  }

  function parseBlock(block) {
    let event = 'message';
    const data = [];
    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue; // comment / heartbeat
      const i = line.indexOf(':');
      const field = i === -1 ? line : line.slice(0, i);
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (!data.length && event === 'message') return;
    let parsed = null;
    try { parsed = data.length ? JSON.parse(data.join('\n')) : null; } catch { return; }
    if (event === 'session_ended') { stop(); onUnauthorized && onUnauthorized(); return; }
    onEvent && onEvent(event, parsed);
  }

  async function connect() {
    if (stopped) return;
    const token = getToken();
    if (!token) { stop(); return; }
    ctrl = new AbortController();
    setStatus('connecting');
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) { stop(); onUnauthorized && onUnauthorized(); return; }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let healthy = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx).replace(/^\r?\n\r?\n/, '');
          if (!healthy) { healthy = true; failures = 0; setFallback(false); setStatus('live'); }
          parseBlock(block);
        }
      }
      // Server closed the stream (restart, deploy): reconnect.
      if (!stopped) scheduleReconnect();
    } catch (err) {
      if (stopped || err?.name === 'AbortError') return;
      scheduleReconnect();
    }
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    failures = 0;
    connect();
  }

  function stop() {
    stopped = true;
    clearTimeout(retryTimer);
    if (ctrl) ctrl.abort();
    ctrl = null;
    setStatus('off');
  }

  /** Reconnect now (e.g. tab became visible or network came back). */
  function nudge() {
    if (stopped) return;
    clearTimeout(retryTimer);
    if (ctrl) ctrl.abort();
    failures = Math.max(0, failures - 1);
    connect();
  }

  return { start, stop, nudge };
}
