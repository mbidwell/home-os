// Minimal Supabase client over REST: password sign-in, token refresh, PostgREST.
// Zero dependencies. Session lives in localStorage under homeos-session.
const C = window.HOMEOS_CONFIG || {};
const BASE = (C.supabaseUrl || '').replace(/\/+$/, '');
const KEY = C.supabaseKey || '';
const K_SESSION = 'homeos-session';

export const configured = !!(BASE && KEY);

let session = load();
let refreshing = null;

function load() { try { return JSON.parse(localStorage.getItem(K_SESSION)); } catch { return null; } }
function save(s) {
  session = s;
  try { s ? localStorage.setItem(K_SESSION, JSON.stringify(s)) : localStorage.removeItem(K_SESSION); } catch {}
}

export const getSession = () => session;
export const setPreviewSession = (s) => { session = s; };

class ApiError extends Error {
  constructor(msg, { status = 0, network = false, signedOut = false } = {}) {
    super(msg); this.status = status; this.network = network; this.signedOut = signedOut;
  }
}

async function call(url, init) {
  try { return await fetch(url, init); }
  catch { throw new ApiError("Can't reach the server.", { network: true }); }
}

async function auth(path, body) {
  const r = await call(`${BASE}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error_description || j.msg || j.message || 'Request failed', { status: r.status });
  return j;
}

function fromToken(j) {
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user: { id: j.user && j.user.id }
  };
}

export async function signIn(email, password) {
  save(fromToken(await auth('token?grant_type=password', { email, password })));
  return session;
}

export function refresh() {
  if (!session) return Promise.reject(new ApiError('Signed out', { signedOut: true }));
  if (!refreshing) {
    refreshing = (async () => {
      // Another tab (or Safari next to the installed app) may have refreshed already. Supabase rotates
      // refresh tokens, so reusing the old one would end the session: pick up the newer one instead.
      const stored = load();
      if (stored && stored.refresh_token !== session.refresh_token && stored.expires_at - 60 > Date.now() / 1000) { session = stored; refreshing = null; return session; }
      try {
        save(fromToken(await auth('token?grant_type=refresh_token', { refresh_token: session.refresh_token })));
        return session;
      } catch (e) {
        const again = load();
        if (again && again.refresh_token !== session.refresh_token) { session = again; return session; } // lost a race, not signed out
        // A rejected refresh token means signed out. Network trouble keeps the session.
        if (e.status === 400 || e.status === 401 || e.status === 403) {
          save(null);
          throw new ApiError('Signed out', { signedOut: true });
        }
        throw e;
      } finally { refreshing = null; }
    })();
  }
  return refreshing;
}

async function token() {
  if (!session) throw new ApiError('Signed out', { signedOut: true });
  if (session.expires_at - 60 < Date.now() / 1000) {
    const stored = load();
    if (stored && stored.access_token !== session.access_token && stored.expires_at - 60 > Date.now() / 1000) session = stored;
    else await refresh();
  }
  return session.access_token;
}

export const accessToken = token;
export const realtimeUrl = () => `${BASE.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(KEY)}&vsn=1.0.0`;

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const send = async () => {
    const h = { apikey: KEY, Authorization: `Bearer ${await token()}` };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (prefer) h.Prefer = prefer;
    return call(`${BASE}/rest/v1/${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  let r = await send();
  if (r.status === 401) { await refresh(); r = await send(); }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new ApiError(j.message || `Request failed (${r.status})`, { status: r.status });
  }
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

export function signOut() {
  const s = session;
  save(null);
  if (s && configured) {
    call(`${BASE}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  }
}
