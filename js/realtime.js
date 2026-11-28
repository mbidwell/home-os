// Supabase Realtime over a plain WebSocket (Phoenix protocol), no library.
// Listens for row changes on the given tables and calls onChange(table).
// RLS applies: the server only sends rows this user may read.
import * as api from './api.js';

const TOPIC = 'realtime:homeos';

export function startRealtime(tables, onChange) {
  let ws = null, ref = 0, hb = 0, retry = 0, stopped = false, lastToken = '', timer = 0;

  const send = (topic, event, payload) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref) }));
  };

  async function open() {
    clearTimeout(timer);
    if (stopped || !api.configured || !api.getSession() || !navigator.onLine) return;
    if (ws && ws.readyState <= 1) return;
    let token;
    try { token = await api.accessToken(); } catch { return schedule(); }
    lastToken = token;
    ws = new WebSocket(api.realtimeUrl());
    ws.onopen = () => {
      retry = 0;
      send(TOPIC, 'phx_join', {
        config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: tables.map((table) => ({ event: '*', schema: 'public', table })) },
        access_token: token
      });
      clearInterval(hb);
      hb = setInterval(heartbeat, 25000);
    };
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(m.data); } catch { return; }
      if (msg.event === 'postgres_changes') onChange(msg.payload?.data?.table);
      // After (re)joining, catch up on anything missed while disconnected.
      if (msg.event === 'phx_reply' && msg.topic === TOPIC && msg.payload?.status === 'ok' && msg.payload?.response?.postgres_changes) onChange(null);
    };
    ws.onclose = () => { clearInterval(hb); ws = null; schedule(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }

  async function heartbeat() {
    send('phoenix', 'heartbeat', {});
    // Keep the channel's token fresh when the session refreshes.
    try {
      const t = await api.accessToken();
      if (t !== lastToken) { lastToken = t; send(TOPIC, 'access_token', { access_token: t }); }
    } catch {}
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
  }

  open();
  return {
    wake() { retry = 0; open(); },
    stop() { stopped = true; clearTimeout(timer); clearInterval(hb); if (ws) try { ws.close(); } catch {} }
  };
}
