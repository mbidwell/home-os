import * as api from './api.js';
import { startParticles } from './particles.js';

const VERSION = '1';
const T = window.homeosTheme;
const Q = new URLSearchParams(location.search);
const PREVIEW = T.isPreview ? Q.get('preview') : null; // local screenshots only
const $app = document.getElementById('app');
const K = { profiles: 'homeos-profiles', queue: 'homeos-queue', debug: 'homeos-debug' };

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if (PREVIEW) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

const state = {
  profiles: ls.get(K.profiles, []),
  queue: ls.get(K.queue, []),
  member: true,
  fetched: false,
  flushing: false,
  netFail: false,
  error: null
};

if (PREVIEW) {
  api.setPreviewSession(PREVIEW === 'signin' ? null : { user: { id: 'me' } });
  state.profiles = [{ user_id: 'me', display_name: 'Sam' }];
  if (Q.get('partner') === '1') state.profiles.push({ user_id: 'p', display_name: 'Riley' });
  state.queue = [];
  state.fetched = true;
}

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const I = {
  home: '<path d="M3.5 11 12 3.8l8.5 7.2"/><path d="M5.5 9.6V20h13V9.6"/><path d="M10 20v-5.5h4V20"/>',
  set: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  ppl: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.8-3.3 3.2-5 6-5s5.2 1.7 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16.5 14.6c2.3.1 3.9 1.6 4.5 4.4"/>',
  moon: '<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  chev: '<path d="M9 5.5 15.5 12 9 18.5"/>',
  arr: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>'
};
const ic = (k, c = 'i') => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;

const THEMES = {
  blush: { name: 'Blush', group: 'Cozy', long: 'Cozy, blush and plum', sw: ['#FBEFF1', '#4A2141', '#EE9CB7'] },
  roast: { name: 'Roast', group: 'Cozy', long: 'Cozy, hojicha and oat', sw: ['#4A3F38', '#D9D1C3', '#00DDE8'] },
  night: { name: 'Night Shift', group: 'Dense', long: 'Night Shift', sw: ['#272D3F', '#DDD8CB', '#1FE6A0'] }
};
const swatch = (a) => `<span class="sw" aria-hidden="true">${a.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;

const myId = () => api.getSession()?.user?.id;
const profileOf = (id) => state.profiles.find((p) => p.user_id === id);
const myName = () => (profileOf(myId())?.display_name || '').trim();
const partner = () => state.profiles.find((p) => p.user_id !== myId() && (p.display_name || '').trim());
const installed = () => (PREVIEW ? Q.get('installed') !== '0' : matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);

function greeting() {
  const h = T.now().getHours();
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening';
}
const today = () => T.now().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/* ---------- sync badge (real connection + queue state) ---------- */
function syncStatus() {
  if (PREVIEW) {
    const s = Q.get('sync');
    if (s === 'off') return { k: 'off', t: 'Offline · 1 waiting' };
    if (s === 'err') return { k: 'err', t: 'Sync error' };
    return { k: 'ok', t: 'Synced' };
  }
  const n = state.queue.length;
  if (!navigator.onLine || state.netFail) return { k: 'off', t: n ? `Offline · ${n} waiting` : 'Offline' };
  if (state.error) return { k: 'err', t: 'Sync error' };
  if (state.flushing || n || !state.fetched) return { k: 'busy', t: n ? 'Saving' : 'Syncing' };
  return { k: 'ok', t: 'Synced' };
}
const badgeHtml = () => { const s = syncStatus(); return `<button class="sync s-${s.k} press" data-act="sync" aria-live="polite"><i></i><span>${s.t}</span></button>`; };
function updateBadge() { document.querySelectorAll('[data-act="sync"]').forEach((b) => { b.outerHTML = badgeHtml(); }); }

/* ---------- data ---------- */
async function pull() {
  if (PREVIEW || !api.getSession()) return;
  try {
    const members = await api.rest('household_members?select=user_id');
    state.member = !!members && members.some((m) => m.user_id === myId());
    if (!state.member) {
      state.error = "This account isn't in the household yet. Add its user ID to household_members (README, step 4).";
    } else {
      const rows = await api.rest('profiles?select=user_id,display_name,updated_at&deleted_at=is.null');
      // Keep my optimistic name if a save is still queued.
      const pending = state.queue.find((o) => o.kind === 'profile');
      state.profiles = rows.map((r) => (pending && r.user_id === myId() ? { ...r, display_name: pending.data.display_name } : r));
      if (pending && !profileOf(myId())) state.profiles.push({ user_id: myId(), display_name: pending.data.display_name });
      ls.set(K.profiles, state.profiles);
      if (state.error && !state.queue.length) state.error = null;
    }
    state.fetched = true;
    state.netFail = false;
  } catch (e) { onErr(e); }
  render({ soft: true });
  flush();
}

async function flush() {
  if (PREVIEW || state.flushing || !state.queue.length || !navigator.onLine || !api.getSession() || !state.member) return updateBadge();
  state.flushing = true; updateBadge();
  try {
    while (state.queue.length) {
      const op = state.queue[0];
      if (op.kind === 'profile') {
        const rows = await api.rest('profiles?on_conflict=user_id', {
          method: 'POST',
          prefer: 'resolution=merge-duplicates,return=representation',
          body: { user_id: myId(), display_name: op.data.display_name, updated_at: new Date().toISOString() }
        });
        if (rows && rows[0]) upsertLocal(rows[0]);
      }
      state.queue.shift();
      ls.set(K.queue, state.queue);
    }
    state.error = null; state.netFail = false;
  } catch (e) { onErr(e); }
  state.flushing = false;
  updateBadge();
}

function onErr(e) {
  if (e.signedOut) { resetLocal(); render(); return; }
  if (e.network) { state.netFail = true; return; }
  state.error = e.message || 'Something went wrong';
}

function upsertLocal(row) {
  const i = state.profiles.findIndex((p) => p.user_id === row.user_id);
  if (i < 0) state.profiles.push(row); else state.profiles[i] = { ...state.profiles[i], ...row };
  ls.set(K.profiles, state.profiles);
}

function saveName(name) {
  name = name.trim().slice(0, 40);
  if (!name || name === myName()) return;
  upsertLocal({ user_id: myId(), display_name: name });
  if (PREVIEW) return render({ soft: true });
  state.queue = state.queue.filter((o) => o.kind !== 'profile');
  state.queue.push({ kind: 'profile', data: { display_name: name }, at: new Date().toISOString() });
  ls.set(K.queue, state.queue);
  updateBadge();
  flush();
}

function resetLocal() {
  state.profiles = []; state.queue = []; state.fetched = false; state.error = null; state.netFail = false; state.member = true;
  ls.del(K.profiles); ls.del(K.queue);
}

/* ---------- screens ---------- */
let destroyFx = null;

function signinView() {
  const ready = api.configured || PREVIEW;
  return `<canvas class="fx" aria-hidden="true"></canvas>
  <main class="si">
    <div class="si-in">
      <div class="mark rise">${ic('home')}</div>
      <h1 class="rise d1">Home</h1>
      <p class="sub rise d1">Your household, on both phones.</p>
      <form class="form rise d2" novalidate>
        <label class="lbl" for="em">Email</label>
        <input class="in" id="em" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" required>
        <label class="lbl" for="pw">Password</label>
        <input class="in" id="pw" name="password" type="password" autocomplete="current-password" required>
        <p class="err" id="err" role="alert" hidden></p>
        <button class="pri press" type="submit" ${ready ? '' : 'disabled'}>Sign in ${ic('arr')}</button>
        <p class="foot">${ready ? 'Stays signed in on this phone.' : 'Setup needed: add the project URL and key to config.js.'}</p>
      </form>
    </div>
  </main>`;
}

function steps() {
  return [
    { done: !!myName(), title: 'Add your name', body: 'So the app shows your name, not your email.', go: '#/settings' },
    { done: installed(), title: 'Add Home to your home screen', body: 'In Safari, tap Share, then Add to Home Screen. It opens full screen and stays signed in.' },
    { done: !!partner(), title: 'Get your partner signed in', body: 'Open Home on their phone, add it to the home screen, and sign in.' }
  ];
}

function phoneLine(th) {
  if (th.theme !== 'night') return THEMES[th.theme].long;
  if (th.dimmed) return 'Night Shift, dimmed until 6 AM';
  return th.dimOn ? 'Night Shift, dims at 10 PM' : 'Night Shift';
}

function header(eyebrow, title) {
  return `<header class="hd"><div class="top"><p class="eyebrow">${eyebrow}</p>${badgeHtml()}</div><h1>${title}</h1></header>`;
}

function dock(on) {
  const b = (k, label, icon) => `<a class="press${on === k ? ' on' : ''}" href="#/${k}" ${on === k ? 'aria-current="page"' : ''}>${ic(icon)}${label}</a>`;
  return `<nav class="dockwrap" aria-label="Main"><div class="dock">${b('home', 'Home', 'home')}${b('settings', 'Settings', 'set')}</div></nav>`;
}

function homeView() {
  const th = T.apply();
  const name = myName();
  const s = steps();
  const next = s.find((x) => !x.done);
  const doneCount = s.filter((x) => x.done).length;
  const p = partner();
  const hero = next ? `<div class="stack rise">
      <${next.go ? `a href="${next.go}"` : 'section'} class="hero${next.go ? ' press' : ''}">
        <p class="eyebrow">Next up</p>
        <h2>${esc(next.title)}${next.go ? ic('chev', 'i hchev') : ''}</h2>
        <p>${esc(next.body)}</p>
        <div class="prog" role="img" aria-label="${doneCount} of ${s.length} setup steps done"><div class="trk"><b style="width:${(doneCount / s.length) * 100}%"></b></div><span>${doneCount} of ${s.length}</span></div>
      </${next.go ? 'a' : 'section'}></div>` : '';
  const house = p
    ? `${name ? esc(name) : 'You'} and ${esc(p.display_name)}, both signed in`
    : `${name ? esc(name) + ' signed in' : 'You’re signed in'}, partner not yet`;
  return `${header(today(), name ? `${greeting()},<br>${esc(name)}` : greeting())}
  <main>
    ${hero}
    <a class="card press rise d1" href="#/settings"><div class="ic">${ic('ppl')}</div><div><b>Household</b><small>${house}</small></div></a>
    <a class="card press rise d2" href="#/settings"><div class="ic">${ic(th.theme === 'night' ? 'moon' : 'sun')}</div><div><b>This phone</b><small>${phoneLine(th)}</small></div></a>
  </main>
  ${dock('home')}`;
}

function settingsView() {
  const th = T.apply();
  const p = partner();
  const tile = (k) => {
    const t = THEMES[k], sel = th.theme === k;
    return `<button class="tile press${sel ? ' sel' : ''}" role="radio" aria-checked="${sel}" data-theme="${k}">
      ${swatch(t.sw)}<span><small>${t.group}</small>${t.name}</span></button>`;
  };
  return `${header('Theme is per phone', 'Settings')}
  <main>
    <p class="gt">Names</p>
    <div class="grp rise">
      <label class="fl" for="nm">You<input id="nm" type="text" value="${esc(myName())}" placeholder="Add your name" maxlength="40" autocomplete="nickname" enterkeyhint="done"></label>
      <div class="fl">Partner<span class="v">${p ? esc(p.display_name) : 'Not signed in yet'}</span></div>
    </div>
    <p class="gt">Theme</p>
    <div class="grp rise d1">
      <div class="tiles" role="radiogroup" aria-label="Theme">${tile('blush')}${tile('roast')}${tile('night')}</div>
      ${th.theme === 'night' ? `<button class="fl swr" role="switch" aria-checked="${th.dimOn}" data-act="dim">Dim 10 PM to 6 AM<span class="tg" aria-hidden="true"></span></button>` : ''}
    </div>
    <button class="ghost press rise d2" data-act="signout">Sign out</button>
    <p class="ver" data-act="ver">Version ${VERSION}</p>
  </main>
  ${dock('settings')}`;
}

/* ---------- render + events ---------- */
let current = '';
function route() {
  if (!api.getSession()) return 'signin';
  if (PREVIEW && PREVIEW !== 'signin' && !location.hash) return PREVIEW;
  return location.hash === '#/settings' ? 'settings' : 'home';
}

function render({ soft = false } = {}) {
  const r = route();
  // Don't wipe a field the user is typing in; just refresh the badge.
  if (soft && r === current && $app.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return updateBadge();
  if (destroyFx) { destroyFx(); destroyFx = null; }
  $app.className = `scr-${r}${(soft && r === current) || PREVIEW ? ' still' : ''}`;
  $app.innerHTML = r === 'signin' ? signinView() : r === 'settings' ? settingsView() : homeView();
  current = r;
  if (r === 'signin') destroyFx = startParticles($app.querySelector('canvas.fx'));
  debugReadout();
}

$app.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (PREVIEW) return;
  const f = e.target, btn = f.querySelector('button[type=submit]'), err = f.querySelector('#err');
  const email = f.email.value.trim(), password = f.password.value;
  err.hidden = true;
  if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
  btn.disabled = true; btn.firstChild.textContent = 'Signing in ';
  try {
    await api.signIn(email, password);
    resetLocal();
    location.hash = '#/home';
    render();
    pull();
  } catch (x) {
    err.textContent = x.network ? "Can't reach the server. Check your connection." : x.status === 400 ? "That email and password don't match." : x.message;
    err.hidden = false; btn.disabled = false; btn.firstChild.textContent = 'Sign in ';
  }
});

$app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-theme],[data-act]');
  if (!t) return;
  if (t.dataset.theme) { T.setTheme(t.dataset.theme); render({ soft: true }); return; }
  const a = t.dataset.act;
  if (a === 'dim') { T.setDim(t.getAttribute('aria-checked') !== 'true'); render({ soft: true }); }
  else if (a === 'sync') {
    if (state.error) alert(state.error);
    state.error = null; state.netFail = false; updateBadge(); pull();
  } else if (a === 'signout') {
    const n = state.queue.length;
    if (n && !confirm(`${n} change${n > 1 ? 's haven’t' : ' hasn’t'} synced yet. Sign out anyway?`)) return;
    api.signOut(); resetLocal(); location.hash = ''; render();
  } else if (a === 'ver') {
    verTaps = (verTaps || 0) + 1;
    clearTimeout(verTimer); verTimer = setTimeout(() => (verTaps = 0), 1500);
    if (verTaps >= 5) { verTaps = 0; ls.set(K.debug, !ls.get(K.debug, false)); debugReadout(); }
  }
});
let verTaps = 0, verTimer = 0;

$app.addEventListener('change', (e) => { if (e.target.id === 'nm') saveName(e.target.value); });
$app.addEventListener('keydown', (e) => { if (e.target.id === 'nm' && e.key === 'Enter') e.target.blur(); });

addEventListener('hashchange', () => render());
addEventListener('online', () => { state.netFail = false; pull(); });
addEventListener('offline', updateBadge);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { T.apply(); pull(); } });
addEventListener('pageshow', (e) => { if (e.persisted) pull(); });
// Auto dim: re-check the clock each minute.
setInterval(() => { const before = document.documentElement.className; T.apply(); if (document.documentElement.className !== before) render({ soft: true }); }, 60000);

/* ---------- layout debug readout (tap Version 5 times, or ?debug=1) ---------- */
if (Q.get('debug') === '1') ls.set(K.debug, true);
function debugReadout() {
  let el = document.getElementById('dbg');
  if (!ls.get(K.debug, false)) { el && el.remove(); return; }
  if (!el) { el = document.createElement('pre'); el.id = 'dbg'; document.body.appendChild(el); }
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom);visibility:hidden';
  document.body.appendChild(probe);
  const sab = probe.getBoundingClientRect().height; probe.remove();
  const nav = document.querySelector('.dockwrap');
  el.textContent = `innerHeight ${innerHeight}\nvisualViewport ${Math.round(visualViewport?.height ?? 0)}\nsafe-area bottom ${sab}\nnav bottom ${nav ? Math.round(nav.getBoundingClientRect().bottom) : '-'}\nstandalone ${installed()}`;
}
addEventListener('resize', debugReadout);
visualViewport?.addEventListener('resize', debugReadout);

/* ---------- service worker (own scope, own caches only) ---------- */
if ('serviceWorker' in navigator && !PREVIEW) {
  const hadController = !!navigator.serviceWorker.controller; // first install: no reload
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    const go = () => { if (!reloaded) { reloaded = true; location.reload(); } };
    // Never reload under someone's thumb while they type.
    if (document.activeElement?.tagName === 'INPUT') document.addEventListener('visibilitychange', go, { once: true });
    else go();
  });
}

render();
pull();
