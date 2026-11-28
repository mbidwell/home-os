import * as api from './api.js';
import { startParticles } from './particles.js';
import { startRealtime } from './realtime.js';

const VERSION = '2';
const T = window.homeosTheme;
const Q = new URLSearchParams(location.search);
const PREVIEW = T.isPreview ? Q.get('preview') : null; // local screenshots only
const $app = document.getElementById('app');
const K = { profiles: 'homeos-profiles', queue: 'homeos-queue', rows: 'homeos-rows', loc: 'homeos-kitchen-loc', later: 'homeos-partner-later', stores: 'homeos-store-memory', debug: 'homeos-debug' };
const TABLES = ['grocery_items', 'staples', 'pantry_items'];

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if (PREVIEW) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

const emptyRows = () => ({ grocery_items: [], staples: [], pantry_items: [] });
const state = {
  profiles: ls.get(K.profiles, []),
  rows: { ...emptyRows(), ...ls.get(K.rows, {}) },
  queue: ls.get(K.queue, []),
  storeMemory: ls.get(K.stores, {}), // item name -> store it was last bought at
  member: true,
  fetched: false,
  flushing: false,
  netFail: false,
  error: null
};
// Screen-only state (not synced).
const ui = { sheet: null, edit: false, newGroup: null, loc: ls.get(K.loc, 'fridge') };

/* ---------- constants ---------- */
const STORES = [['costco', 'Costco'], ['wegmans', 'Wegmans'], ['publix', 'Publix'], ['harris_teeter', 'Harris Teeter']];
const storeName = (k) => (STORES.find((s) => s[0] === k) || [null, 'Unsorted'])[1];
const LOCS = [['fridge', 'Fridge'], ['freezer', 'Freezer'], ['pantry', 'Pantry'], ['garage_freezer', 'Garage freezer']];
const locName = (k) => (LOCS.find((l) => l[0] === k) || [null, k])[1];
const LOC_SOON = null; // a location that's shown but not usable yet (none right now)
const LOC_SHORT = { garage_freezer: 'Garage' }; // fits the tab bar
const COSTCO_GROUPS = ['Fridge', 'Freezer', 'Pantry', 'Household', 'Kids', 'Other'];

/* ---------- local preview (screenshots only, sample data, no network) ---------- */
if (PREVIEW) {
  api.setPreviewSession(PREVIEW === 'signin' ? null : { user: { id: 'me' } });
  state.profiles = [{ user_id: 'me', display_name: 'Sam' }];
  if (Q.get('partner') === '1') state.profiles.push({ user_id: 'p', display_name: 'Riley' });
  state.queue = [];
  state.fetched = true;
  const r = (name, o = {}) => ({ id: 'x' + Math.random().toString(36).slice(2), name, ...o });
  const now = new Date().toISOString();
  const eggs = r('Eggs', { location: 'fridge', status: 'out' }), milk = r('Milk', { location: 'fridge', status: 'out' });
  state.rows = {
    grocery_items: [
      r('Paper towels'), r('Birthday candles'),
      r('Eggs', { store: 'costco', note: '2 dozen' }), r('Bananas', { store: 'costco' }), r('Coffee beans', { store: 'costco' }),
      r('Sourdough bread', { store: 'wegmans' }), r('Fresh basil', { store: 'wegmans' }),
      r('Milk', { store: 'costco', checked_at: now, pantry_item_id: milk.id }), r('Yogurt', { checked_at: now }), r('Apples', { checked_at: now })
    ].filter((g) => !(g.name === 'Eggs' && Q.get('preview') === 'kitchen')),
    staples: [
      r('Eggs', { list: 'costco', category: 'Fridge', store: 'costco' }), r('Shredded cheese', { list: 'costco', category: 'Fridge', store: 'costco' }), r('Butter', { list: 'costco', category: 'Fridge', store: 'costco' }),
      r('Frozen berries', { list: 'costco', category: 'Freezer', store: 'costco' }), r('Chicken thighs', { list: 'costco', category: 'Freezer', store: 'costco' }),
      r('Coffee beans', { list: 'costco', category: 'Pantry', store: 'costco' }), r('Olive oil', { list: 'costco', category: 'Pantry', store: 'costco' }),
      r('Milk', { list: 'staples', store: 'costco' }), r('Bananas', { list: 'staples', store: 'costco' }), r('Bread', { list: 'staples', store: 'wegmans' }), r('Dish soap', { list: 'staples' })
    ],
    pantry_items: [milk, eggs, r('Butter', { location: 'fridge', status: 'low' }), r('Shredded cheese', { location: 'fridge', status: 'have' }),
      r('Yogurt', { location: 'fridge', status: 'have' }), r('Hot sauce', { location: 'fridge', status: 'have' }),
      r('Frozen peas', { location: 'freezer', status: 'have' }), r('Rice', { location: 'pantry', status: 'low' })]
  };
  if (Q.get('sheet')) ui.sheet = { type: 'addfrom', tab: Q.get('sheet') };
  if (Q.get('preview') === 'kitchen') state.rows.grocery_items = state.rows.grocery_items.filter((g) => g.name !== 'Eggs');
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
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  cart: '<path d="M3 4.5h2.4l2.1 10.2h10.4l2-7.4H6.6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  box: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M4 10h16M8 6.8v.4M8 13v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
  bag: '<path d="M5.5 8h13l-1 12h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'
};
const ic = (k, c = 'i') => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => ((Math.random() * 16) | 0).toString(16)));
const norm = (s) => String(s || '').trim().toLowerCase();
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const THEMES = {
  blush: { name: 'Blush', group: 'Cozy', long: 'Cozy, blush and plum', sw: ['#FBEFF1', '#4A2141', '#EE9CB7'] },
  roast: { name: 'Roast', group: 'Cozy', long: 'Cozy, hojicha and oat', sw: ['#4A3F38', '#D9D1C3', '#00DDE8'] },
  night: { name: 'Night Shift', group: 'Dense', long: 'Night Shift', sw: ['#272D3F', '#DDD8CB', '#1FE6A0'] }
};
const swatch = (a) => `<span class="sw" aria-hidden="true">${a.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
const cozy = () => T.apply().theme !== 'night';

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

/* ---------- rows: live views over the local copy ---------- */
const live = (t) => state.rows[t].filter((r) => !r.deleted_at);
const groceryOpen = () => live('grocery_items').filter((g) => !g.checked_at);
const groceryDone = () => live('grocery_items').filter((g) => g.checked_at).sort((a, b) => String(b.checked_at).localeCompare(String(a.checked_at)));
const onGrocery = (name, pantryId) => groceryOpen().find((g) => (pantryId && g.pantry_item_id === pantryId) || norm(g.name) === norm(name));
const pantry = () => live('pantry_items');
const outNotListed = () => pantry().filter((p) => p.status === 'out' && p.location !== LOC_SOON && !onGrocery(p.name, p.id));
const findRow = (t, id) => state.rows[t].find((r) => r.id === id);

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
let lastSync = '';
const badgeHtml = () => {
  const s = syncStatus();
  const just = lastSync === 'busy' && s.k === 'ok'; // a save just landed
  lastSync = s.k;
  return `<button class="sync s-${s.k} press${just ? ' just' : ''}" data-act="sync" aria-live="polite"><i></i><span>${s.t}</span></button>`;
};
function updateBadge() { document.querySelectorAll('[data-act="sync"]').forEach((b) => { b.outerHTML = badgeHtml(); }); }

/* ---------- local changes: optimistic, queued, synced in order ---------- */
function saveRows() { ls.set(K.rows, state.rows); }
function saveQueue() { ls.set(K.queue, state.queue); }

function insertRow(table, data) {
  const now = new Date().toISOString();
  const row = { id: uid(), created_at: now, updated_at: now, ...data };
  state.rows[table].push(row);
  saveRows();
  if (!PREVIEW) { state.queue.push({ kind: 'row', op: 'insert', table, id: row.id, data: row }); saveQueue(); flush(); }
  return row;
}

function updateRow(table, id, patch) {
  const row = findRow(table, id);
  if (!row) return;
  Object.assign(row, patch, { updated_at: new Date().toISOString() });
  const j = justSaved.get(id); if (j) Object.assign(j.data, patch); // e.g. removed right after adding stays removed
  saveRows();
  if (PREVIEW) return;
  // Fold into a change that hasn't been sent yet, so the queue stays short.
  const pending = state.queue.find((o) => o.kind === 'row' && o.table === table && o.id === id && !o.sending);
  if (pending) Object.assign(pending.data, patch);
  else state.queue.push({ kind: 'row', op: 'update', table, id, data: { ...patch } });
  saveQueue();
  flush();
}
const removeRow = (table, id) => updateRow(table, id, { deleted_at: new Date().toISOString() });

/* ---------- server sync ---------- */
let pulling = null;
async function pull() {
  if (PREVIEW || !api.getSession()) return;
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      const members = await api.rest('household_members?select=user_id');
      state.member = !!members && members.some((m) => m.user_id === myId());
      if (!state.member) {
        state.error = "This account isn't in the household yet. Add its user ID to household_members (README, step 4).";
      } else {
        const [profiles, history, ...tables] = await Promise.all([
          api.rest('profiles?select=user_id,display_name,updated_at&deleted_at=is.null'),
          // Where each item was bought before, including cleared ones: new adds go to that store.
          api.rest('grocery_items?select=name,store&store=not.is.null&order=updated_at.desc&limit=500'),
          ...TABLES.map((t) => api.rest(`${t}?select=*&deleted_at=is.null&order=created_at.asc`))
        ]);
        const mem = {};
        for (const h of history) if (!(norm(h.name) in mem)) mem[norm(h.name)] = h.store;
        state.storeMemory = mem;
        ls.set(K.stores, mem);
        state.profiles = profiles;
        TABLES.forEach((t, i) => { state.rows[t] = tables[i]; });
        overlayQueue();
        ls.set(K.profiles, state.profiles);
        saveRows();
        if (state.error && !state.queue.length) state.error = null;
      }
      state.fetched = true;
      state.netFail = false;
    } catch (e) { onErr(e); }
    render({ soft: true });
    flush();
  })();
  try { await pulling; } finally { pulling = null; }
}

// Rows saved in the last few seconds: a refresh that started before the save finished won't have them yet.
const justSaved = new Map();
// Server rows plus local changes that haven't synced yet, so nothing flickers back.
function overlayQueue() {
  const now = Date.now();
  for (const [id, j] of justSaved) {
    if (j.until < now) { justSaved.delete(id); continue; }
    const rows = state.rows[j.table];
    if (!rows.some((r) => r.id === id)) rows.push({ ...j.data });
  }
  for (const o of state.queue) {
    if (o.kind === 'profile') {
      const me = profileOf(myId());
      if (me) me.display_name = o.data.display_name; else state.profiles.push({ user_id: myId(), display_name: o.data.display_name });
      continue;
    }
    const rows = state.rows[o.table], row = rows.find((r) => r.id === o.id);
    if (row) Object.assign(row, o.data);
    else if (o.op === 'insert') rows.push({ ...o.data });
  }
}

async function flush() {
  if (PREVIEW || state.flushing || !state.queue.length || !navigator.onLine || !api.getSession() || !state.member) return updateBadge();
  state.flushing = true; updateBadge();
  try {
    while (state.queue.length) {
      const op = state.queue[0];
      op.sending = true;
      try {
        if (op.kind === 'profile') {
          const rows = await api.rest('profiles?on_conflict=user_id', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=representation',
            body: { user_id: myId(), display_name: op.data.display_name }
          });
          if (rows && rows[0]) upsertProfile(rows[0]);
        } else if (op.op === 'insert') {
          const { created_at, updated_at, ...body } = op.data; // server sets the clocks
          await api.rest(`${op.table}?on_conflict=id`, { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body });
          justSaved.set(op.id, { table: op.table, data: op.data, until: Date.now() + 15000 });
        } else {
          const { updated_at, ...body } = op.data;
          await api.rest(`${op.table}?id=eq.${encodeURIComponent(op.id)}`, { method: 'PATCH', prefer: 'return=minimal', body });
        }
      } catch (e) {
        op.sending = false;
        // A change the server rejects outright would block everything behind it: drop it and say so.
        if (!e.network && !e.signedOut && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)) {
          state.queue.shift(); saveQueue();
          state.error = `A change couldn't be saved: ${e.message}`;
          continue;
        }
        throw e;
      }
      state.queue.shift();
      saveQueue();
    }
    if (!state.error || state.error.startsWith('Something')) state.error = null;
    state.netFail = false;
  } catch (e) { onErr(e); }
  state.flushing = false;
  updateBadge();
}

function onErr(e) {
  if (e.signedOut) { resetLocal(); render(); return; }
  if (e.network) { state.netFail = true; return; }
  state.error = e.message || 'Something went wrong';
}

function upsertProfile(row) {
  const i = state.profiles.findIndex((p) => p.user_id === row.user_id);
  if (i < 0) state.profiles.push(row); else state.profiles[i] = { ...state.profiles[i], ...row };
  ls.set(K.profiles, state.profiles);
}

function saveName(name) {
  name = name.trim().slice(0, 40);
  if (!name || name === myName()) return;
  upsertProfile({ user_id: myId(), display_name: name });
  if (PREVIEW) return render({ soft: true });
  state.queue = state.queue.filter((o) => o.kind !== 'profile' || o.sending);
  state.queue.push({ kind: 'profile', data: { display_name: name }, at: new Date().toISOString() });
  saveQueue();
  updateBadge();
  flush();
}

function resetLocal() {
  state.storeMemory = {}; ls.del(K.stores);
  state.profiles = []; state.rows = emptyRows(); state.queue = []; state.fetched = false; state.error = null; state.netFail = false; state.member = true;
  ls.del(K.profiles); ls.del(K.rows); ls.del(K.queue);
}

/* ---------- actions ---------- */
function addGrocery(name, extra = {}) {
  name = name.trim().slice(0, 80);
  if (!name) return null;
  const dup = onGrocery(name, extra.pantry_item_id);
  if (dup) return dup;
  // Pick the store: where it was last bought, else its staple or Costco list entry, else Unsorted.
  if (!('store' in extra)) {
    const s = live('staples').find((x) => norm(x.name) === norm(name) && x.store);
    extra.store = state.storeMemory[norm(name)] || (s ? s.store : null);
  }
  return insertRow('grocery_items', { name, store: null, note: null, pantry_item_id: null, checked_at: null, ...extra });
}

function toggleGrocery(id) {
  const g = findRow('grocery_items', id);
  if (!g) return;
  const checked = !g.checked_at;
  updateRow('grocery_items', id, { checked_at: checked ? new Date().toISOString() : null });
  // Bought it: the kitchen has it again.
  if (checked) {
    const p = (g.pantry_item_id && findRow('pantry_items', g.pantry_item_id)) || pantry().find((x) => norm(x.name) === norm(g.name) && x.status !== 'have');
    if (p && p.status !== 'have') updateRow('pantry_items', p.id, { status: 'have' });
  }
}

function sendToGrocery(p) { return addGrocery(p.name, { pantry_item_id: p.id }); }

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
      <form class="form rise d2" data-form="signin" novalidate>
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
    { done: !!partner() || ls.get(K.later, false), title: 'Get your partner signed in', body: 'Open Home on their phone, add it to the home screen, and sign in.', later: true }
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
  return `<nav class="dockwrap" aria-label="Main"><div class="dock">${b('home', 'Home', 'home')}${b('grocery', 'Grocery', 'cart')}${b('kitchen', 'Kitchen', 'box')}${b('settings', 'Settings', 'set')}</div></nav>`;
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
        ${next.later ? `<button class="later press" data-act="later">Later</button>` : ''}
      </${next.go ? 'a' : 'section'}></div>` : '';
  const house = p
    ? `${name ? esc(name) : 'You'} and ${esc(p.display_name)}, both signed in`
    : `${name ? esc(name) + ' signed in' : 'You’re signed in'}, partner not yet`;
  const toGet = groceryOpen().length;
  const out = pantry().filter((x) => x.status === 'out').length, low = pantry().filter((x) => x.status === 'low').length;
  const kitchenLine = [out && `${out} out`, low && `${low} low`].filter(Boolean).join(', ');
  return `${header(today(), name ? `${greeting()},<br>${esc(name)}` : greeting())}
  <main>
    ${hero}
    ${toGet ? `<a class="card press rise d1" href="#/grocery"><div class="ic">${ic('cart')}</div><div><b>Grocery</b><small>${plural(toGet, 'thing')} to get</small></div></a>` : ''}
    ${kitchenLine ? `<a class="card press rise d1" href="#/kitchen"><div class="ic">${ic('box')}</div><div><b>Kitchen</b><small>${kitchenLine}</small></div></a>` : ''}
    <a class="card press rise d2" href="#/settings"><div class="ic">${ic('ppl')}</div><div><b>Household</b><small>${house}</small></div></a>
    <a class="card press rise d2" href="#/settings"><div class="ic">${ic(th.theme === 'night' ? 'moon' : 'sun')}</div><div><b>This phone</b><small>${phoneLine(th)}</small></div></a>
  </main>
  ${dock('home')}`;
}

/* --- grocery --- */
const sec = (a, b = '') => `<div class="sec"><b>${a}</b><span>${b}</span></div>`;
const cbx = (on, id) => `<button class="cb${on ? ' on' : ''} press" data-act="gcheck" data-id="${id}" role="checkbox" aria-checked="${on}" aria-label="${on ? 'Uncheck' : 'Check off'}">${on ? ic('check') : ''}</button>`;

function groceryRow(g) {
  const done = !!g.checked_at;
  return `<div class="it${done ? ' done' : ''}">${cbx(done, g.id)}
    <button class="nm" data-act="gitem" data-id="${g.id}">${esc(g.name)}${g.note ? `<small>${esc(g.note)}</small>` : ''}</button>
    ${!done && !g.store ? `<button class="tag press" data-act="gitem" data-id="${g.id}">Tag store</button>` : ''}</div>`;
}

function groceryView() {
  const open = groceryOpen(), done = groceryDone();
  const groups = [[null, 'Unsorted'], ...STORES].map(([k, label]) => [label, open.filter((g) => (g.store || null) === k)]).filter(([, items]) => items.length);
  return `${header(open.length ? `${open.length} to get` : 'All set', 'Grocery')}
  <main>
    <form class="qa rise" data-form="gadd" autocomplete="off">
      <div class="row"><input class="fld" name="name" type="text" placeholder="${cozy() ? 'What do we need?' : 'Add an item'}" maxlength="80" enterkeyhint="done" aria-label="Add an item">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}<span>Add</span></button></div>
      <div class="chips"><button type="button" class="chip press" data-act="addfrom" data-tab="staples">${ic('star')}Staples</button><button type="button" class="chip press" data-act="addfrom" data-tab="costco">${ic('bag')}Buy at Costco</button></div>
    </form>
    ${!open.length && !done.length ? `<p class="empty">Nothing on the list. Add things as you think of them, or tap Staples.</p>` : ''}
    ${groups.map(([label, items]) => `${sec(label, items.length)}<div class="list">${items.map(groceryRow).join('')}</div>`).join('')}
    ${done.length ? `<div class="sec"><b>Got it</b><button class="clear press" data-act="gclear">Clear ${done.length}</button></div><div class="list">${done.map(groceryRow).join('')}</div>` : ''}
  </main>
  ${dock('grocery')}`;
}

/* --- kitchen --- */
function hlo(p) {
  const b = (s, label) => `<button class="${p.status === s ? s[0] : ''}" data-act="pstat" data-id="${p.id}" data-s="${s}" aria-pressed="${p.status === s}">${label}</button>`;
  return `<span class="hlo" role="group" aria-label="${esc(p.name)} status">${b('have', 'Have')}${b('low', 'Low')}${b('out', 'Out')}</span>`;
}

function pantryRow(p) {
  let sub = '';
  if (p.status === 'out') {
    sub = onGrocery(p.name, p.id)
      ? `<span class="onlist">${ic('check')}On grocery</span>`
      : `<span class="send press" data-act="psend" data-id="${p.id}" role="button">${ic('plus')}Grocery</span>`;
  }
  return `<div class="it"><div class="nm"><button class="nmb" data-act="pitem" data-id="${p.id}">${esc(p.name)}</button>${sub}</div>${hlo(p)}</div>`;
}

function kitchenView() {
  const loc = ui.loc;
  const here = pantry().filter((p) => p.location === loc).sort((a, b) => a.name.localeCompare(b.name));
  const need = outNotListed();
  const seg = LOCS.map(([k, label]) => k === LOC_SOON
    ? `<span class="soon" aria-disabled="true">Garage<br>soon</span>`
    : `<button class="${k === loc ? 'on' : ''}" data-act="loc" data-loc="${k}" aria-pressed="${k === loc}" aria-label="${label}">${LOC_SHORT[k] || label}</button>`).join('');
  const hero = need.length ? `<div class="stack rise" style="margin:14px 0 26px"><section class="hero sum">
      <p class="eyebrow">Out</p>
      <h2>${esc(need[0].name)}${need.length > 1 ? ` and ${plural(need.length - 1, 'more', 'more')}` : ''}</h2>
      <p>${need.length > 1 ? 'Out, and not on the grocery list yet.' : `Out${need[0].location !== loc ? ` in the ${locName(need[0].location).toLowerCase()}` : ''}, and not on the grocery list yet.`}</p>
      <button class="pri press" data-act="psendall">${ic('cart')}${need.length > 1 ? `Add ${need.length} to grocery` : 'Add to grocery'}</button>
    </section></div>` : '';
  const block = (s, label) => { const items = here.filter((p) => p.status === s); return items.length ? `${sec(label, items.length)}<div class="list">${items.map(pantryRow).join('')}</div>` : ''; };
  return `${header(`${locName(loc)} · ${plural(here.length, 'item')}`, 'Kitchen')}
  <main>
    <div class="seg rise" role="group" aria-label="Location">${seg}</div>
    ${hero}
    <form class="qa slim rise" data-form="padd" autocomplete="off"><div class="row">
      <input class="fld" name="name" type="text" placeholder="Add to ${locName(loc).toLowerCase()}" maxlength="80" enterkeyhint="done" aria-label="Add to ${locName(loc).toLowerCase()}">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div></form>
    ${!here.length ? `<p class="empty">Nothing in the ${locName(loc).toLowerCase()} yet. Add what you keep here, then mark it Low or Out when it runs down.</p>` : ''}
    ${block('out', 'Out')}${block('low', 'Low')}${block('have', 'Have')}
  </main>
  ${dock('kitchen')}`;
}

/* --- bottom sheets --- */
function sheetView() {
  const s = ui.sheet;
  if (!s) return '';
  let body = '';
  if (s.type === 'addfrom') body = addFromSheet(s.tab);
  else if (s.type === 'gitem') body = groceryItemSheet(findRow('grocery_items', s.id));
  else if (s.type === 'pitem') body = pantryItemSheet(findRow('pantry_items', s.id));
  if (!body) { ui.sheet = null; return ''; }
  return `<div class="scrim" data-act="close"></div><div class="bs${s.type === 'addfrom' ? '' : ' short'}" role="dialog" aria-modal="true">
    <div class="grab" data-act="close"></div>${body}</div>`;
}

function addFromSheet(tab) {
  const list = live('staples').filter((x) => (x.list || 'staples') === tab).sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
  const groups = tab === 'costco'
    ? COSTCO_GROUPS.map((c) => [c, list.filter((x) => (COSTCO_GROUPS.includes(x.category) ? x.category : 'Other') === c)])
    : [...STORES.map(([k, l]) => [l, list.filter((x) => x.store === k)]), ['Any store', list.filter((x) => !x.store)]];
  const row = (x) => {
    const on = !!onGrocery(x.name);
    const right = ui.edit
      ? `<button class="plus press" data-act="delstaple" data-id="${x.id}" aria-label="Remove ${esc(x.name)}">${ic('x')}</button>`
      : on ? `<span class="onlist" data-sid="${x.id}">${ic('check')}On list</span>` : `<button class="plus press" data-act="addstaple" data-id="${x.id}" aria-label="Add ${esc(x.name)}">${ic('plus')}</button>`;
    return `<div class="it"><span class="nm">${esc(x.name)}</span>${right}</div>`;
  };
  const choices = tab === 'costco' ? COSTCO_GROUPS : [...STORES.map((x) => x[1]), 'Any store'];
  const pick = ui.newGroup && choices.includes(ui.newGroup) ? ui.newGroup : choices[0];
  const addForm = ui.edit ? `<form class="newst" data-form="sadd" autocomplete="off">
      <div class="row"><input class="fld2" name="name" type="text" placeholder="${tab === 'costco' ? 'Add to the Costco list' : 'Add a staple'}" maxlength="80" enterkeyhint="done">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div>
      <div class="picks">${choices.map((c) => `<button type="button" class="pick${c === pick ? ' on' : ''}" data-act="newgroup" data-g="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    </form>` : '';
  const empty = !list.length ? `<p class="empty">${tab === 'costco'
    ? 'No Costco list yet. Import it from Settings, or tap Edit to add items.'
    : 'No staples yet. Tap Edit to add the things you buy every time.'}</p>` : '';
  return `<h2>${ui.edit ? 'Edit list' : 'Add from'}<button class="lnk" data-act="edit">${ui.edit ? 'Done' : 'Edit'}</button></h2>
    <div class="seg"><button class="${tab === 'staples' ? 'on' : ''}" data-act="addfrom" data-tab="staples">Staples</button><button class="${tab === 'costco' ? 'on' : ''}" data-act="addfrom" data-tab="costco">Buy at Costco</button></div>
    <div class="scroll">${addForm}${empty}${groups.filter(([, items]) => items.length).map(([label, items]) => `${sec(esc(label))}<div class="list">${items.map(row).join('')}</div>`).join('')}</div>`;
}

function groceryItemSheet(g) {
  if (!g || g.deleted_at) return '';
  const opt = (k, label) => `<button class="opt press${(g.store || null) === k ? ' on' : ''}" data-act="gstore" data-id="${g.id}" data-store="${k || ''}">${label}${(g.store || null) === k ? ic('check') : ''}</button>`;
  return `<h2>${esc(g.name)}</h2>
    <p class="gt">Store</p>
    <div class="list opts">${STORES.map(([k, l]) => opt(k, l)).join('')}${opt(null, 'No store yet')}</div>
    <button class="ghost press" data-act="gdel" data-id="${g.id}">Remove from list</button>`;
}

function pantryItemSheet(p) {
  if (!p || p.deleted_at) return '';
  const opt = ([k, label]) => k === LOC_SOON
    ? `<span class="opt soon">${label}<small>Coming soon</small></span>`
    : `<button class="opt press${p.location === k ? ' on' : ''}" data-act="ploc" data-id="${p.id}" data-loc="${k}">${label}${p.location === k ? ic('check') : ''}</button>`;
  return `<h2>${esc(p.name)}</h2>
    <p class="gt">Kept in</p>
    <div class="list opts">${LOCS.map(opt).join('')}</div>
    <button class="ghost press" data-act="pdel" data-id="${p.id}">Remove from kitchen</button>`;
}

/* --- settings --- */
function settingsView() {
  const th = T.apply();
  const p = partner();
  const tile = (k) => {
    const t = THEMES[k], sel = th.theme === k;
    return `<button class="tile press${sel ? ' sel' : ''}" role="radio" aria-checked="${sel}" data-theme="${k}">
      ${swatch(t.sw)}<span><small>${t.group}</small>${t.name}</span></button>`;
  };
  const costco = live('staples').filter((x) => x.list === 'costco').length;
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
    <p class="gt">Lists</p>
    <div class="grp rise d1">
      <label class="fl press">Import Costco list<span class="v">${costco ? `${costco} items` : 'CSV file'}</span><input class="hide" type="file" accept=".csv,text/csv" data-act="costcocsv"></label>
    </div>
    <button class="ghost press rise d2" data-act="signout">Sign out</button>
    <p class="ver" data-act="ver">Version ${VERSION}</p>
  </main>
  ${dock('settings')}`;
}

/* ---------- Costco CSV import (columns: name, category, store, good_to_freeze) ---------- */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function importCostco(file) {
  const rows = parseCsv(await file.text());
  const head = (rows.shift() || []).map(norm);
  const col = (n) => head.indexOf(n);
  if (col('name') < 0) { alert('That file needs a "name" column.'); return; }
  const have = new Set(live('staples').filter((x) => x.list === 'costco').map((x) => norm(x.name)));
  let added = 0;
  rows.forEach((r, i) => {
    const name = (r[col('name')] || '').trim().slice(0, 80);
    if (!name || have.has(norm(name))) return;
    const cat = (r[col('category')] || '').trim();
    insertRow('staples', { list: 'costco', name, store: 'costco', category: COSTCO_GROUPS.find((g) => norm(g) === norm(cat)) || 'Other', sort: i });
    have.add(norm(name)); added++;
  });
  alert(added ? `Added ${plural(added, 'item')} to the Costco list.` : 'Everything in that file is already on the list.');
  render({ soft: true });
}

/* ---------- render + events ---------- */
let current = '';
const ROUTES = ['home', 'grocery', 'kitchen', 'settings'];
function route() {
  if (!api.getSession()) return 'signin';
  if (PREVIEW && PREVIEW !== 'signin' && !location.hash) return PREVIEW;
  const h = location.hash.replace('#/', '');
  return ROUTES.includes(h) ? h : 'home';
}

const VIEWS = { signin: signinView, home: homeView, grocery: groceryView, kitchen: kitchenView, settings: settingsView };

function render({ soft = false, keepFocus = null, fx = null } = {}) {
  const r = route();
  // Never lose what someone is typing. The name field just waits; add boxes keep their text and focus across a redraw.
  const act = $app.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'file' ? document.activeElement : null;
  if (soft && !keepFocus && r === current && act && act.id === 'nm') return updateBadge();
  const typing = soft && !keepFocus && r === current && act && act.form?.dataset.form
    ? { sel: `[data-form="${act.form.dataset.form}"] input[name="${act.name}"]`, value: act.value, start: act.selectionStart, end: act.selectionEnd }
    : null;
  if (destroyFx) { destroyFx(); destroyFx = null; }
  const scroll = r === current ? $app.querySelector('main')?.scrollTop || 0 : 0;
  const sScroll = r === current ? $app.querySelector('.bs .scroll')?.scrollTop || 0 : 0;
  $app.className = `scr-${r}${(soft && r === current) || PREVIEW ? ' still' : ''}`;
  $app.innerHTML = VIEWS[r]() + (r === 'signin' ? '' : sheetView());
  if (r === current) {
    const m = $app.querySelector('main'); if (m) m.scrollTop = scroll;
    const ss = $app.querySelector('.bs .scroll'); if (ss) ss.scrollTop = sScroll;
  }
  current = r;
  if (keepFocus) $app.querySelector(keepFocus)?.focus();
  if (typing) {
    const el = $app.querySelector(typing.sel);
    if (el) { el.value = typing.value; el.focus(); try { el.setSelectionRange(typing.start, typing.end); } catch {} }
    syncAddButton(el);
  }
  // One-shot motion on whatever just changed (jelly on a check, pop on a new row).
  if (fx) for (const [sel, cls] of fx) { const el = sel && $app.querySelector(sel); if (el) el.classList.add(cls); }
  if (r === 'signin') destroyFx = startParticles($app.querySelector('canvas.fx'));
  debugReadout();
}

$app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, kind = f.dataset.form;
  if (kind === 'gadd' || kind === 'padd' || kind === 'sadd') {
    const name = f.name.value.trim();
    if (!name) return;
    let added = null;
    if (kind === 'gadd') added = addGrocery(name);
    else if (kind === 'padd') added = insertRow('pantry_items', { name: name.slice(0, 80), location: ui.loc, status: 'have' });
    else {
      const tab = ui.sheet?.tab || 'staples';
      const choices = tab === 'costco' ? COSTCO_GROUPS : [...STORES.map((x) => x[1]), 'Any store'];
      const g = ui.newGroup && choices.includes(ui.newGroup) ? ui.newGroup : choices[0];
      const store = tab === 'costco' ? 'costco' : (STORES.find((s) => s[1] === g) || [null])[0];
      insertRow('staples', { list: tab, name: name.slice(0, 80), store, category: tab === 'costco' ? g : null, sort: 1000 });
    }
    // Stay in the field for the next item.
    const rowSel = added ? `[data-id="${added.id}"]` : null;
    render({ soft: true, keepFocus: kind === 'sadd' ? '.newst .fld2' : `[data-form="${kind}"] .fld`, fx: rowSel ? [[`.it:has(${rowSel})`, 'pop']] : null });
    return;
  }
  if (PREVIEW) return;
  const btn = f.querySelector('button[type=submit]'), err = f.querySelector('#err');
  const email = f.email.value.trim(), password = f.password.value;
  err.hidden = true;
  if (!email || !password) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
  btn.classList.add('ld'); btn.setAttribute('aria-busy', 'true');
  try {
    await api.signIn(email, password);
    btn.classList.add('ok');
    await new Promise((r) => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 520));
    resetLocal();
    location.hash = '#/home';
    render();
    pull();
    rt.wake();
  } catch (x) {
    err.textContent = x.network ? "Can't reach the server. Check your connection." : x.status === 400 ? "That email and password don't match." : x.message;
    err.hidden = false; btn.classList.remove('ld', 'ok'); btn.removeAttribute('aria-busy');
  }
});

$app.addEventListener('click', (e) => {
  // In-app links swap the screen without stacking history, so a back-swipe doesn't jump between tabs.
  const link = e.target.closest('a[href^="#/"]');
  if (link) { e.preventDefault(); if (location.hash !== link.getAttribute('href')) location.replace(link.getAttribute('href')); return; }
  const t = e.target.closest('[data-theme],[data-act]');
  if (!t || t.tagName === 'INPUT') return;
  if (t.dataset.theme) { T.setTheme(t.dataset.theme); render({ soft: true }); return; }
  const a = t.dataset.act, id = t.dataset.id;
  const soft = (fx) => render({ soft: true, keepFocus: '__none', fx });
  switch (a) {
    case 'later': ls.set(K.later, true); return soft();
    case 'dim': T.setDim(t.getAttribute('aria-checked') !== 'true'); return soft();
    case 'sync':
      if (state.error) alert(state.error);
      state.error = null; state.netFail = false; updateBadge(); pull(); rt.wake(); return;
    case 'signout': {
      const n = state.queue.length;
      if (n && !confirm(`${n} change${n > 1 ? 's haven’t' : ' hasn’t'} synced yet. Sign out anyway?`)) return;
      api.signOut(); resetLocal(); ui.sheet = null; location.hash = ''; render(); return;
    }
    case 'ver':
      verTaps = (verTaps || 0) + 1;
      clearTimeout(verTimer); verTimer = setTimeout(() => (verTaps = 0), 1500);
      if (verTaps >= 5) { verTaps = 0; ls.set(K.debug, !ls.get(K.debug, false)); debugReadout(); }
      return;
    // grocery
    case 'gcheck': toggleGrocery(id); return soft([[`[data-act="gcheck"][data-id="${id}"]`, 'jelly']]);
    case 'gclear': groceryDone().forEach((g) => removeRow('grocery_items', g.id)); return soft();
    case 'gitem': ui.sheet = { type: 'gitem', id }; return soft();
    case 'gstore': {
      const g = findRow('grocery_items', id), store = t.dataset.store || null;
      updateRow('grocery_items', id, { store });
      if (g && store) { state.storeMemory[norm(g.name)] = store; ls.set(K.stores, state.storeMemory); } // next time it goes straight there
      ui.sheet = null; return soft();
    }
    case 'gdel': removeRow('grocery_items', id); ui.sheet = null; return soft();
    // add-from sheet
    case 'addfrom': ui.sheet = { type: 'addfrom', tab: t.dataset.tab }; ui.newGroup = null; return soft();
    case 'edit': ui.edit = !ui.edit; return soft();
    case 'newgroup': ui.newGroup = t.dataset.g; return soft();
    case 'addstaple': { const x = findRow('staples', id); if (x) addGrocery(x.name, { store: x.store || (x.list === 'costco' ? 'costco' : null) }); return soft([[`[data-sid="${id}"]`, 'pop']]); }
    case 'delstaple': removeRow('staples', id); return soft();
    case 'close': ui.sheet = null; ui.edit = false; return soft();
    // kitchen
    case 'loc': ui.loc = t.dataset.loc; ls.set(K.loc, ui.loc); return soft();
    case 'pstat': updateRow('pantry_items', id, { status: t.dataset.s }); return soft([[`[data-act="pstat"][data-id="${id}"][data-s="${t.dataset.s}"]`, 'jelly']]);
    case 'psend': { const p = findRow('pantry_items', id); if (p) sendToGrocery(p); return soft([[`[data-id="${id}"] ~ .onlist, .it:has([data-id="${id}"]) .onlist`, 'pop']]); }
    case 'psendall': {
      // Load & success, then the card leaves.
      if (t.classList.contains('ld')) return;
      t.classList.add('ld');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => t.classList.add('ok'), still ? 0 : 280);
      setTimeout(() => { outNotListed().forEach(sendToGrocery); soft(); }, still ? 0 : 820);
      return;
    }
    case 'pitem': ui.sheet = { type: 'pitem', id }; return soft();
    case 'ploc': updateRow('pantry_items', id, { location: t.dataset.loc }); ui.sheet = null; return soft();
    case 'pdel': removeRow('pantry_items', id); ui.sheet = null; return soft();
  }
});
let verTaps = 0, verTimer = 0;

$app.addEventListener('change', (e) => {
  if (e.target.id === 'nm') saveName(e.target.value);
  if (e.target.dataset.act === 'costcocsv' && e.target.files[0]) importCostco(e.target.files[0]);
});
function syncAddButton(input) {
  const b = input?.form?.querySelector('.add');
  if (b && input.form.dataset.form === 'gadd') b.classList.toggle('ready', !!input.value.trim());
}
$app.addEventListener('input', (e) => { if (e.target.classList.contains('fld')) syncAddButton(e.target); });

const RIPPLE = '.pri,.add,.chip,.tag,.plus,.opt,.send,.seg > button,.dock a,.hlo button,.clear,.ghost,.tile,.card,.hero.press,.it .nm,.lnk,.pick';
$app.addEventListener('pointerdown', (e) => {
  const b = e.target.closest(RIPPLE);
  if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = b.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
  const dot = document.createElement('span');
  dot.className = 'rip';
  dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  b.classList.add('rp');
  b.appendChild(dot);
  setTimeout(() => dot.remove(), 600);
}, { passive: true });

$app.addEventListener('keydown', (e) => {
  if (e.target.id === 'nm' && e.key === 'Enter') e.target.blur();
  if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; ui.edit = false; render({ soft: true, keepFocus: '__none' }); }
});

addEventListener('hashchange', () => { ui.sheet = null; ui.edit = false; render(); });
addEventListener('online', () => { state.netFail = false; pull(); rt.wake(); });
addEventListener('offline', updateBadge);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { T.apply(); pull(); rt.wake(); } });
addEventListener('pageshow', (e) => { if (e.persisted) { pull(); rt.wake(); } });
// Auto dim: re-check the clock each minute.
setInterval(() => { const before = document.documentElement.className; T.apply(); if (document.documentElement.className !== before) render({ soft: true }); }, 60000);

/* ---------- live updates from the other phone ---------- */
let rtTimer = 0;
const rt = PREVIEW ? { wake() {}, stop() {} } : startRealtime(TABLES, () => { clearTimeout(rtTimer); rtTimer = setTimeout(pull, 300); });

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
  el.textContent = `innerHeight ${innerHeight}\nvisualViewport ${Math.round(visualViewport?.height ?? 0)}\nsafe-area bottom ${sab}\nnav bottom ${nav ? Math.round(nav.getBoundingClientRect().bottom) : '-'}\nstandalone ${installed()}\nqueue ${state.queue.length}`;
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
