import * as api from './api.js';
import { startParticles } from './particles.js';
import { startRealtime } from './realtime.js';
import * as S from './schedule.js';
import * as D from './day.js';
import * as M from './meals.js';
import * as F from './fit.js';
import * as C from './cheer.js';
import * as A from './aisles.js';
import * as R from './routines.js';

const VERSION = '23';
const T = window.homeosTheme;
const Q = new URLSearchParams(location.search);
const PREVIEW = T.isPreview ? Q.get('preview') : null; // local screenshots only
const $app = document.getElementById('app');
const K = { profiles: 'homeos-profiles', queue: 'homeos-queue', rows: 'homeos-rows', loc: 'homeos-kitchen-loc', later: 'homeos-partner-later', stores: 'homeos-store-memory', choreTab: 'homeos-chore-tab', lists: 'homeos-task-lists', who: 'homeos-chore-who', debug: 'homeos-debug', ktab: 'homeos-kitchen-tab', calapp: 'homeos-cal-app', seen: 'homeos-cheer-seen', gstore: 'homeos-grocery-store', backup: 'homeos-last-backup' };
const TABLES = ['grocery_items', 'staples', 'pantry_items', 'tasks', 'task_events',
  'calendar_events', 'calendar_sync', 'day_settings', 'day_overrides', 'kid_items', 'recipes', 'meal_plan', 'cheers', 'routines'];
// Tables keyed by something other than id.
const PK = { calendar_events: 'uid', calendar_sync: 'source', day_settings: 'id', day_overrides: 'date', meal_plan: 'slot' };
const pkOf = (t) => PK[t] || 'id';
// Newer tables: if one isn't set up yet, keep going without it instead of failing the whole sync.
const OPTIONAL = new Set(['calendar_events', 'calendar_sync', 'day_settings', 'day_overrides', 'kid_items', 'recipes', 'meal_plan', 'cheers', 'routines']);
// What each table pulls. History (task_events) is add-only: the most recent stretch is enough on a phone.
const TABLE_Q = {
  task_events: 'task_events?select=*&order=at.desc&limit=800',
  calendar_events: 'calendar_events?select=uid,kind,title,shift_type,site,all_day,start_date,end_date,starts_at,ends_at&removed_at=is.null&order=start_date.asc&limit=3000',
  calendar_sync: 'calendar_sync?select=*',
  day_settings: 'day_settings?select=*',
  day_overrides: 'day_overrides?select=*&order=date.desc&limit=120',
  meal_plan: 'meal_plan?select=*&order=date.desc&limit=400'
};
const tableQuery = (t) => TABLE_Q[t] || `${t}?select=*&deleted_at=is.null&order=created_at.asc`;

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if (PREVIEW) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

const emptyRows = () => ({ grocery_items: [], staples: [], pantry_items: [], tasks: [], task_events: [], calendar_events: [], calendar_sync: [], day_settings: [], day_overrides: [], kid_items: [], recipes: [], meal_plan: [], cheers: [], routines: [] });
const state = {
  profiles: ls.get(K.profiles, []),
  rows: { ...emptyRows(), ...ls.get(K.rows, {}) },
  queue: ls.get(K.queue, []),
  storeMemory: ls.get(K.stores, {}), // item name -> store it was last bought at
  members: [], // household user IDs (so a chore can be assigned before the partner signs in)
  member: true,
  fetched: false,
  flushing: false,
  netFail: false,
  error: null
};
// Screen-only state (not synced).
const ui = { gstore: ls.get(K.gstore, 'all'), sheet: null, edit: false, newGroup: null, loc: ls.get(K.loc, 'fridge'), choreTab: ls.get(K.choreTab, 'chores'), who: ls.get(K.who, 'all'), showLater: false, showDone: false, howto: null, taskCat: 'House', resetCount: null, calTab: 'week', ktab: ls.get(K.ktab, 'stock'), week: 0, ingr: {}, ingrDays: null, plan: null, planErr: null };

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
    ...emptyRows(),
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
    pantry_items: [milk, eggs, r('Chicken thighs', { location: 'freezer', status: 'have' }), r('Butter', { location: 'fridge', status: 'low' }), r('Shredded cheese', { location: 'fridge', status: 'have' }),
      r('Yogurt', { location: 'fridge', status: 'have' }), r('Hot sauce', { location: 'fridge', status: 'have' }),
      r('Frozen peas', { location: 'freezer', status: 'have' }), r('Rice', { location: 'pantry', status: 'low' })]
  };
  const today = S.localToday(T.now());
  const ch = (title, o) => ({ id: 'c' + Math.random().toString(36).slice(2), kind: 'chore', title, active: true, repeat_mode: 'after', every: 1, unit: 'week', week_of_month: null, weekday: null, months: null, assignee: null, priority: false, howto: null, ...o });
  const filt = ch('Change the air filter', { repeat_mode: 'fixed', unit: 'month', week_of_month: 4, assignee: 'me', due_date: S.addDays(today, -6), howto: 'Turn off the unit at the switch.\nSlide the old filter out; note the arrow.\nSlide the new one in, arrow toward the unit.' });
  state.rows.tasks = [
    ch('Wipe down the fridge', { every: 2, due_date: S.addDays(today, -2) }), filt,
    ch('Water the plants', { every: 3, unit: 'day', due_date: S.addDays(today, -1) }),
    ch('Take out recycling', { repeat_mode: 'fixed', every: 2, weekday: 2, assignee: 'p', due_date: S.addDays(today, 2) }),
    ch('Clean the bathrooms', { due_date: S.addDays(today, 2), assignee: 'me' }), ch('Wash the bedding', { due_date: S.addDays(today, 5) }),
    ch('Clean the gutters', { repeat_mode: 'fixed', every: 6, unit: 'month', week_of_month: 2, months: [4, 10], due_date: S.addDays(today, 60) }),
    ch('Test smoke alarms', { repeat_mode: 'fixed', every: 3, unit: 'month', week_of_month: 1, months: [3, 6, 9, 12], due_date: S.addDays(today, 25) }),
    { id: 't1', kind: 'task', title: 'Fix the squeaky door', category: 'House', priority: true, due_date: S.addDays(today, 2), active: true, repeat_mode: 'once' },
    { id: 't2', kind: 'task', title: 'Call about the gutters', category: 'House', priority: true, active: true, repeat_mode: 'once' },
    { id: 't3', kind: 'task', title: 'Hang the hallway shelf', category: 'House', active: true, repeat_mode: 'once' },
    { id: 't4', kind: 'task', title: 'Sign the field trip form', category: 'Kids', due_date: S.addDays(today, 3), active: true, repeat_mode: 'once' },
    { id: 't5', kind: 'task', title: 'Order winter boots', category: 'Kids', active: true, repeat_mode: 'once' },
    { id: 't6', kind: 'task', title: 'Return the library books', category: 'Errands', due_date: S.addDays(today, 5), active: true, repeat_mode: 'once' }
  ];
  state.rows.task_events = [
    { id: 'e1', task_id: filt.id, kind: 'done', due_date: S.addDays(today, -34), at: S.addDays(today, -34) + 'T15:00:00Z', by_user: 'me' },
    { id: 'e2', task_id: filt.id, kind: 'skip', due_date: S.addDays(today, -62), at: S.addDays(today, -62) + 'T15:00:00Z', by_user: 'me' }
  ];
  state.members = ['me', 'p'];
  // calendar sample (made up)
  const at = (d, h, m = 0) => { const x = new Date(S.parse(S.addDays(today, d))); x.setUTCHours(h + 5, m); return x.toISOString(); }; // EST
  const ev = (uid, o) => ({ uid, all_day: false, ...o });
  state.rows.calendar_events = [
    ev('s1', { kind: 'shift', shift_type: 'working', site: 'Main ED', title: 'Main ED', starts_at: at(0, 7), ends_at: at(0, 19), start_date: today, end_date: today }),
    ev('s2', { kind: 'shift', shift_type: 'on_call', all_day: true, start_date: S.addDays(today, 1), end_date: S.addDays(today, 1) }),
    ev('s3', { kind: 'shift', shift_type: 'working', site: 'Main ED', title: 'Main ED', starts_at: at(2, 19), ends_at: at(3, 7), start_date: S.addDays(today, 2), end_date: S.addDays(today, 3) }),
    ev('s4', { kind: 'shift', shift_type: 'working', site: 'Urgent care', title: 'Urgent care', starts_at: at(5, 8), ends_at: at(5, 16), start_date: S.addDays(today, 5), end_date: S.addDays(today, 5) }),
    ev('m1', { kind: 'meeting', title: null, starts_at: at(0, 9), ends_at: at(0, 9, 30), start_date: today, end_date: today }),
    ev('m2', { kind: 'meeting', title: null, starts_at: at(4, 10), ends_at: at(4, 11), start_date: S.addDays(today, 4), end_date: S.addDays(today, 4) }),
    ev('g1', { kind: 'event', title: 'Soccer practice', starts_at: at(3, 18), ends_at: at(3, 19), start_date: S.addDays(today, 3), end_date: S.addDays(today, 3) }),
    ev('e1', { kind: 'event_shift', title: 'City FC vs. Sample United', starts_at: at(1, 17, 30), ends_at: at(1, 22, 30), start_date: S.addDays(today, 1), end_date: S.addDays(today, 1) }),
    ev('e2', { kind: 'event_shift', title: 'City FC vs. River Town', starts_at: at(-12, 17), ends_at: at(-12, 22), start_date: S.addDays(today, -12), end_date: S.addDays(today, -12) }),
    ev('e3', { kind: 'event_shift', title: 'Fall concert series', starts_at: at(-30, 16), ends_at: at(-30, 23), start_date: S.addDays(today, -30), end_date: S.addDays(today, -30) })
  ];
  state.rows.calendar_sync = Q.get('calerr')
    ? [{ source: 'google', last_ok_at: new Date(Date.now() - 6 * 3600000).toISOString(), last_error: null }, { source: 'outlook', last_ok_at: new Date(Date.now() - 6 * 3600000).toISOString(), last_error: 'Feed returned 404' }]
    : [{ source: 'google', last_ok_at: new Date(Date.now() - 20 * 60000).toISOString() }, { source: 'outlook', last_ok_at: new Date(Date.now() - 20 * 60000).toISOString() }];
  state.rows.day_settings = [{ id: 1, nap_start: '13:00', nap_end: '16:00', nap_minutes: 120, dinner: '18:00', bed: '20:00', post_call_hours: 10, appliances: ['stove', 'oven', 'microwave', 'air_fryer', 'pressure_cooker', 'slow_cooker'] }];
  if (Q.get('nap')) state.rows.day_overrides = [{ date: today, nap_start: Q.get('nap'), nap_end: (() => { const [h, m] = Q.get('nap').split(':').map(Number); return `${String(h + 2).padStart(2, '0')}:${String(m).padStart(2, '0')}`; })() }];
  state.rows.kid_items = [
    { id: 'k1', kind: 'appointment', title: 'Pediatrician', starts_at: at(0, 16, 30), location: '100 Sample Street, Springfield' },
    { id: 'k7', kind: 'appointment', title: 'Swim lesson', starts_at: at(2, 20) },
    { id: 'k2', kind: 'appointment', title: 'Dentist checkup', starts_at: at(12, 10) },
    { id: 'k3', kind: 'supply', title: 'Diapers', status: 'low' }, { id: 'k4', kind: 'supply', title: 'Wipes', status: 'have' },
    { id: 'k5', kind: 'supply', title: 'Formula', status: 'have' }, { id: 'k6', kind: 'supply', title: 'Kids’ Tylenol', status: 'out' }
  ];
  const rc = (id, title, ingredients, o = {}) => ({ id, title, ingredients, steps: null, source_url: null, notes: null, created_at: now, ...o });
  state.rows.recipes = [
    rc('r1', 'Chicken tacos', '1.5 lb chicken thighs\n8 small tortillas\n1 cup shredded cheese\n2 limes\n1 onion\nTaco seasoning',
      { favorite: true, quick: true, kid_friendly: true, method: 'stove', source_url: 'https://example.com/chicken-tacos', steps: 'Season the chicken and sear 6 minutes a side.\nRest, then slice thin.\nWarm the tortillas; top with chicken, cheese, onion, and lime.', notes: 'Kids like it without onion.' }),
    rc('r2', 'Sheet pan salmon', '4 salmon fillets\n1 lb green beans\n2 tbsp olive oil\n1 lemon\nSalt', { quick: true, favorite: true, method: 'sheet_pan' }),
    rc('r3', 'Slow cooker chili', '1 lb ground beef\n1 (15 oz) can black beans\n1 (15 oz) can kidney beans\n1 can crushed tomatoes\n1 onion\n2 tbsp chili powder\nShredded cheese', { method: 'slow_cooker' }),
    rc('r4', 'Pasta with peas', '1 lb pasta\n2 cups frozen peas\n2 tbsp butter\nParmesan')
  ];
  const wk0 = M.weekStart(today), mp = (d, meal, o) => ({ slot: M.slotOf(S.addDays(wk0, d), meal), date: S.addDays(wk0, d), meal, recipe_id: null, text: null, ...o });
  state.rows.meal_plan = [mp(0, 'dinner', { recipe_id: 'r1' }), mp(1, 'dinner', { text: 'Leftovers' }), mp(2, 'dinner', { recipe_id: 'r2' }), mp(4, 'dinner', { text: 'Pizza night' }), mp(5, 'dinner', { recipe_id: 'r3' })];
  const sd = S.weekdayOf(today) === 0 ? 6 : S.weekdayOf(today) - 1; // today's slot gets a dinner too
  if (![0, 1, 2, 4, 5].includes(sd)) state.rows.meal_plan.push(mp(sd, 'dinner', { recipe_id: 'r4' }));
  const tm = S.addDays(today, 1);
  if (!state.rows.meal_plan.some((m) => m.date === tm)) state.rows.meal_plan.push({ slot: M.slotOf(tm), date: tm, meal: 'dinner', recipe_id: 'r1', text: null });
  state.rows.meal_plan.push(mp(-6, 'dinner', { recipe_id: 'r3' }), mp(-3, 'dinner', { recipe_id: 'r2' }));
  if (Q.get('lunch')) { state.rows.day_settings[0].lunch_plan = true; state.rows.meal_plan.push(mp(sd, 'lunch', { text: 'Turkey sandwiches' })); }
  if (Q.get('ktab')) ui.ktab = Q.get('ktab');
  if (Q.get('msheet') === 'plan') {
    ui.plan = { slots: [
      { date: S.addDays(wk0, 3), meal: 'dinner', title: 'Sheet pan gnocchi', cur: '', on: true },
      { date: S.addDays(wk0, 4), meal: 'dinner', title: 'Pasta with peas', cur: 'Pizza night', on: false },
      { date: S.addDays(wk0, 6), meal: 'dinner', title: 'Chicken tacos', cur: '', on: true }],
      recipes: [{ title: 'Sheet pan gnocchi', method: 'sheet_pan', ingredients: '1 lb gnocchi\n1 pint cherry tomatoes\n1 red onion\n2 tbsp olive oil\nItalian sausage', steps: 'Heat the oven to 425.\nToss everything on a sheet pan.\nRoast 20 minutes.', notes: null, source_url: null, on: true }] };
  }
  if (Q.get('msheet') === 'ingrsoon') { ui.ingrDays = [0, 1, 2].map((i) => S.addDays(today, i)); ui.sheet = { type: 'ingr' }; }
  else if (Q.get('msheet') === 'kid') ui.sheet = { type: 'kid', id: 'k1' };
  else if (Q.get('msheet') === 'addcal') ui.sheet = { type: 'addcal', id: 'k1' };
  else if (Q.get('msheet')) ui.sheet = Q.get('msheet') === 'recipe' ? { type: 'recipe', id: 'r1' } : Q.get('msheet') === 'meal' ? { type: 'meal', slot: M.slotOf(S.addDays(today, 1)) } : { type: Q.get('msheet') };
  state.rows.routines = [{ id: 'w1', title: 'Music class', who: 'kids', weekdays: [1, 3, 5], start_time: '09:00', end_time: '13:00', breaks: [] }, { id: 'w2', title: 'Study group', who: 'p', weekdays: [3], start_time: '09:00', end_time: '12:00', breaks: [{ from: S.addDays(today, 20), to: S.addDays(today, 40), label: 'Winter break' }] }];
  if (Q.get('msheet') === 'routine') ui.sheet = { type: 'routine', id: 'w2' };
  state.rows.pantry_items.push({ id: 'lo1', name: 'Leftover chili', location: 'fridge', status: 'have', made_on: S.addDays(today, -3) });
  state.rows.cheers = [{ id: 'n1', to_user: 'me', created_by: 'p', text: 'I love you. Thank you for everything you do.', created_at: now }, { id: 'n2', to_user: 'p', created_by: 'me', text: 'You make this house a home.', created_at: now }];
  if (Q.get('cheer')) setTimeout(() => cheer(Q.get('cheer'), true), 600);
  if (Q.get('undo')) setTimeout(() => offerUndo('Done: Water the plants', () => {}), 600);
  if (Q.get('union')) state.rows.day_overrides.push({ date: today, union_day: true });
  if (Q.get('owner')) state.rows.day_settings[0].calendar_owner = Q.get('owner'); // 'me' or 'p' (see it as the partner)
  if (Q.get('cal')) ui.calTab = Q.get('cal');
  if (Q.get('oncall')) state.rows.calendar_events[0] = ev('s1', { kind: 'shift', shift_type: 'on_call', all_day: true, start_date: today, end_date: today });
  if (Q.get('tab')) ui.choreTab = Q.get('tab');
  if (Q.get('howto')) ui.howto = filt.id;
  if (Q.get('edit')) ui.sheet = { type: 'chore', id: filt.id };
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
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chore: '<path d="M5 12.5 9 16.5 19 6.5"/><path d="M5 19.5h14"/>',
  q: '<circle cx="12" cy="12" r="8.5"/><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.6-2.2 2-2.2 3.4M12 16.8v.1"/>',
  flag: '<path d="M6 20.5V4.5M6 5h10.5l-2 3.8 2 3.8H6"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  kid: '<circle cx="12" cy="7.5" r="3"/><path d="M6.5 20c.6-4 2.8-6 5.5-6s4.9 2 5.5 6"/>',
  warn: '<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17v.1"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'
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
const findRow = (t, id) => state.rows[t].find((r) => r[pkOf(t)] === id);

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

function insertRow(table, data, { conflict = null } = {}) {
  const now = new Date().toISOString();
  const row = { id: uid(), created_at: now, updated_at: now, ...data };
  state.rows[table].push(row);
  saveRows();
  if (!PREVIEW) { state.queue.push({ kind: 'row', op: 'insert', table, id: row.id, data: row, conflict }); saveQueue(); flush(); }
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
// Bring back a soft-deleted row, even if a refresh already dropped it from this phone.
function restoreRow(table, snap) {
  if (!snap) return;
  if (!findRow(table, snap.id)) { state.rows[table].push({ ...snap }); }
  updateRow(table, snap.id, { deleted_at: null });
}

/* ---------- undo: a few seconds to take back a tap ---------- */
let undoTimer = 0;
function offerUndo(label, fn) {
  document.querySelector('.undo')?.remove();
  const el = document.createElement('div');
  el.className = 'undo';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(label)}</span><button type="button" class="press">Undo</button>`;
  const close = () => { el.classList.add('out'); document.body.classList.remove('has-undo'); setTimeout(() => el.remove(), 300); };
  el.querySelector('button').addEventListener('click', () => { clearTimeout(undoTimer); fn(); close(); document.querySelector('.cheer')?.remove(); render({ soft: true, keepFocus: '__none' }); });
  document.body.appendChild(el);
  document.body.classList.add('has-undo');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(close, 6000);
}
// Undo a chore or task check-off: put its date back and mark the history entry as taken back.
function undoClose(c, prev, ev) {
  updateRow('tasks', c.id, prev);
  if (ev) updateRow('task_events', ev.id, { undone_at: new Date().toISOString() });
}

/** Save fields on a row keyed by its natural key (a date, an event uid), creating it if needed. */
function saveKeyed(table, key, patch) {
  const pk = pkOf(table);
  let row = findRow(table, key);
  if (!row) { row = { [pk]: key }; state.rows[table].push(row); }
  Object.assign(row, patch);
  saveRows();
  if (PREVIEW) return row;
  const pending = state.queue.find((o) => o.kind === 'keyed' && o.table === table && o.key === key && !o.sending);
  if (pending) Object.assign(pending.data, patch);
  else state.queue.push({ kind: 'keyed', table, key, data: { ...patch } });
  saveQueue();
  flush();
  return row;
}

/* ---------- server sync ---------- */
let pulling = null;
async function pull() {
  if (PREVIEW || !api.getSession()) return;
  if (pulling) return pulling;
  pulling = (async () => {
    try {
      const members = await api.rest('household_members?select=user_id');
      state.member = !!members && members.some((m) => m.user_id === myId());
      state.members = (members || []).map((m) => m.user_id);
      if (!state.member) {
        state.error = "This account isn't in the household yet. Add its user ID to household_members (README, step 4).";
      } else {
        const [profiles, history, ...tables] = await Promise.all([
          api.rest('profiles?select=user_id,display_name,updated_at&deleted_at=is.null'),
          // Where each item was bought before, including cleared ones: new adds go to that store.
          api.rest('grocery_items?select=name,store&store=not.is.null&order=updated_at.desc&limit=500'),
          ...TABLES.map((t) => (OPTIONAL.has(t) ? api.rest(tableQuery(t)).catch((e) => { if (e.network || e.signedOut) throw e; return null; }) : api.rest(tableQuery(t))))
        ]);
        const mem = {};
        for (const h of history) if (!(norm(h.name) in mem)) mem[norm(h.name)] = h.store;
        state.storeMemory = mem;
        ls.set(K.stores, mem);
        state.profiles = profiles;
        TABLES.forEach((t, i) => { if (tables[i]) state.rows[t] = tables[i]; });
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
    if (o.kind === 'keyed') {
      const rows = state.rows[o.table], row = rows.find((r) => r[pkOf(o.table)] === o.key);
      if (row) Object.assign(row, o.data); else rows.push({ [pkOf(o.table)]: o.key, ...o.data });
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
        } else if (op.kind === 'keyed') {
          const pk = pkOf(op.table);
          await api.rest(`${op.table}?on_conflict=${pk}`, { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { [pk]: op.key, ...op.data } });
        } else if (op.op === 'insert') {
          const { created_at, updated_at, ...body } = op.data; // server sets the clocks
          if (op.table === 'task_events') { delete body.created_at; }
          // A conflict target means "record once": the other phone may already have written it.
          await api.rest(`${op.table}?on_conflict=${op.conflict || 'id'}`, { method: 'POST', prefer: `resolution=${op.conflict ? 'ignore' : 'merge'}-duplicates,return=minimal`, body });
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
  return `<nav class="dockwrap" aria-label="Main"><div class="dock">${b('home', 'Today', 'home')}${b('grocery', 'Grocery', 'cart')}${b('kitchen', 'Kitchen', 'box')}${b('chores', 'Chores', 'chore')}${b('settings', 'Settings', 'set')}</div></nav>`;
}

function resetCard() {
  const today = todayStr();
  if (S.weekdayOf(today) !== 0) return '';
  const n = missed(today).filter(S.resetsWeekly).length;
  return n ? `<a class="card press rise d1" href="#/reset"><div class="ic">${ic('reset')}</div><div><b>Sunday reset</b><small>${plural(n, 'chore')} to start fresh</small></div></a>` : '';
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

// Store mode: the aisle each item is in, using its Costco-list category as a hint.
const aisleFor = (g) => A.aisleOf(g.name, live('staples').find((x) => norm(x.name) === norm(g.name))?.category);
const byAisle = (a, b) => (A.aisleRank(aisleFor(a)) - A.aisleRank(aisleFor(b))) || a.name.localeCompare(b.name);
function groceryView() {
  const open = groceryOpen(), done = groceryDone();
  const counts = [['all', 'All', open.length], ...STORES.map(([k, l]) => [k, l, open.filter((g) => g.store === k).length]), ['none', 'No store', open.filter((g) => !g.store).length]];
  const pick = counts.some(([k, , n]) => k === ui.gstore && (n || k === 'all')) ? ui.gstore : 'all';
  const storeChips = open.length ? `<div class="fchips rise">${counts.filter(([k, , n]) => k === 'all' || n).map(([k, l, n]) => `<button class="fchip press${pick === k ? ' on' : ''}" data-act="gstorepick" data-v="${k}">${k === 'all' ? l : `${l} · ${n}`}</button>`).join('')}</div>` : '';
  let groups;
  if (pick === 'all') groups = [[null, 'Unsorted'], ...STORES].map(([k, label]) => [label, open.filter((g) => (g.store || null) === k).sort(byAisle)]).filter(([, items]) => items.length);
  else {
    const here = open.filter((g) => (pick === 'none' ? !g.store : g.store === pick));
    groups = A.AISLES.map((a) => [a, here.filter((g) => aisleFor(g) === a).sort((x, y) => x.name.localeCompare(y.name))]).filter(([, items]) => items.length);
  }
  return `${header(open.length ? `${open.length} to get` : 'All set', 'Grocery')}
  <main>
    <form class="qa rise" data-form="gadd" autocomplete="off">
      <div class="row"><input class="fld" name="name" type="text" placeholder="${cozy() ? 'What do we need?' : 'Add an item'}" maxlength="80" enterkeyhint="done" aria-label="Add an item">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}<span>Add</span></button></div>
      <div class="chips"><button type="button" class="chip press" data-act="addfrom" data-tab="staples">${ic('star')}Staples</button><button type="button" class="chip press" data-act="addfrom" data-tab="costco">${ic('bag')}Buy at Costco</button></div>
    </form>
    ${!open.length && !done.length ? `<p class="empty">Nothing on the list. Add things as you think of them, or tap Staples.</p>` : ''}
    ${storeChips}
    ${groups.map(([label, items]) => `${sec(label, items.length)}<div class="list${pick !== 'all' ? ' instore' : ''}">${items.map(groceryRow).join('')}</div>`).join('')}
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
  const age = p.made_on ? `<span class="age${ageDays(p) >= 3 ? ' old' : ''}">${esc(ageLabel(p))}</span>` : '';
  return `<div class="it"><div class="nm"><button class="nmb" data-act="pitem" data-id="${p.id}">${esc(p.name)}</button>${age}${sub}</div>${hlo(p)}</div>`;
}

function stockView() {
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
    ${kseg()}
    <div class="seg rise" role="group" aria-label="Location">${seg}</div>
    ${hero}
    <form class="qa slim rise" data-form="padd" autocomplete="off"><div class="row">
      <input class="fld" name="name" type="text" placeholder="Add to ${locName(loc).toLowerCase()}" maxlength="80" enterkeyhint="done" aria-label="Add to ${locName(loc).toLowerCase()}">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div>
      ${loc === 'fridge' ? `<div class="chips"><button type="button" class="chip press" data-act="leftover">${ic('plus')}Leftovers</button></div>` : ''}</form>
    ${!here.length ? `<p class="empty">Nothing in the ${locName(loc).toLowerCase()} yet. Add what you keep here, then mark it Low or Out when it runs down.</p>` : ''}
    ${block('out', 'Out')}${block('low', 'Low')}${block('have', 'Have')}
  </main>
  ${dock('kitchen')}`;
}

/* --- meals and recipes (Kitchen tab: Stock | Meals | Recipes) --- */
const KTABS = [['stock', 'Stock'], ['meals', 'Meals'], ['recipes', 'Recipes']];
const kseg = () => `<div class="seg ktabs rise" role="group" aria-label="Kitchen">${KTABS.map(([k, l]) => `<button class="${ui.ktab === k ? 'on' : ''}" data-act="ktab" data-v="${k}" aria-pressed="${ui.ktab === k}">${l}</button>`).join('')}</div>`;
function kitchenView() { return ui.ktab === 'meals' ? mealsView() : ui.ktab === 'recipes' ? recipesView() : stockView(); }

const recipes = () => live('recipes').sort((a, b) => (!!a.never_again - !!b.never_again) || (!!b.favorite - !!a.favorite) || a.title.localeCompare(b.title)); // starred first, never-again last
const lunchOn = () => !!daySet().lunch_plan;
const autoGrocery = () => daySet().auto_grocery !== false; // on unless turned off
// Plan a meal. When a recipe goes on a day (today or later), what it needs that the kitchen doesn't have goes on the
// grocery list, tagged with the day. Clearing or swapping the meal takes back what it added that isn't bought yet.
function setMeal(slot, { recipe_id = null, text = null }) {
  const [date, meal] = slot.split(':');
  const w0 = M.weekStart(date), wk = [0, 1, 2, 3, 4, 5, 6].map((i) => M.slotOf(S.addDays(w0, i)));
  const fullBefore = wk.every((x) => mealOf(x));
  const before = findRow('meal_plan', slot);
  if (before && before.recipe_id !== recipe_id) unplanGrocery(slot);
  saveKeyed('meal_plan', slot, { date, meal, recipe_id, text });
  if (recipe_id && autoGrocery() && date >= todayStr()) addForMeal(slot);
  if (before && before.recipe_id && before.recipe_id !== recipe_id) topUpGrocery();
  if (!fullBefore && meal === 'dinner' && wk.every((x) => mealOf(x))) setTimeout(() => cheer('meals', true), 300);
}
function addForMeal(slot) {
  const m = mealOf(slot), r = m && m.recipe_id ? findRow('recipes', m.recipe_id) : null;
  if (!r || r.deleted_at) return 0;
  const have = pantry().filter((p) => p.status === 'have').map((p) => p.name);
  const need = M.missingFor(r.ingredients, have, groceryOpen().map((g) => g.name));
  for (const x of need) addGrocery(x.name, { note: [x.qty, `for ${r.title}`].filter(Boolean).join(' · '), from_slot: slot });
  return need.length;
}
function unplanGrocery(slot) { groceryOpen().filter((g) => g.from_slot === slot).forEach((g) => removeRow('grocery_items', g.id)); }
// After taking items back, re-add anything another planned meal still needs.
function topUpGrocery() {
  if (!autoGrocery()) return;
  const td = todayStr(), end = S.addDays(td, 14);
  live('meal_plan').filter((m) => m.recipe_id && m.date >= td && m.date <= end).forEach((m) => addForMeal(m.slot));
}
const GEAR = [['stove', 'Stove'], ['oven', 'Oven'], ['microwave', 'Microwave'], ['air_fryer', 'Air fryer'], ['pressure_cooker', 'Pressure cooker'], ['slow_cooker', 'Slow cooker'], ['grill', 'Grill']];
const gear = () => (Array.isArray(daySet().appliances) ? daySet().appliances : []);
const mealOf = (slot) => { const m = findRow('meal_plan', slot); return m && (m.recipe_id || m.text) ? m : null; };
function mealTitle(m) {
  if (!m) return '';
  if (!m.recipe_id) return m.text || '';
  const r = findRow('recipes', m.recipe_id);
  return r && !r.deleted_at ? r.title : m.text || 'Recipe removed';
}
const shortDay = (d, o) => new Date(S.parse(d)).toLocaleDateString(undefined, { timeZone: 'UTC', ...o });
const weekDays = () => { const w0 = S.addDays(M.weekStart(todayStr()), ui.week * 7); return [0, 1, 2, 3, 4, 5, 6].map((i) => S.addDays(w0, i)); };
const weekRange = (days) => `${shortDay(days[0], { month: 'short', day: 'numeric' })} – ${shortDay(days[6], days[0].slice(5, 7) === days[6].slice(5, 7) ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
const ingCount = (r) => M.ingredientLines(r && r.ingredients).length;
const awayOn = (d) => D.awayAtDinner(d, calRows(), activations(), { dinner: hm(daySet().dinner), tz: TZ });
const onCallOn = (d) => statusOf(d).type === 'on_call' && !awayOn(d);
// The last day a recipe was on the plan, before today.
function lastHad(id) {
  const td = todayStr();
  return live('meal_plan').filter((m) => m.recipe_id === id && m.date < td).reduce((a, m) => (m.date > a ? m.date : a), '');
}
const hadLine = (r) => { const d = lastHad(r.id); return d ? `had ${M.agoLabel(d, todayStr())}` : 'not had yet'; };
const tagLine = (r) => [r.never_again && 'Not again', M.methodLabel(r.method), r.quick && 'Quick', r.kid_friendly && 'Kids like it'].filter(Boolean).join(' · ');
// Freezer items needed for a day's planned meals: [{ item, recipe }].
function thawFor(date) {
  const frozen = pantry().filter((p) => (p.location === 'freezer' || p.location === 'garage_freezer') && p.status !== 'out');
  const out = [];
  for (const meal of ['lunch', 'dinner']) {
    const m = mealOf(M.slotOf(date, meal)), r = m && m.recipe_id ? findRow('recipes', m.recipe_id) : null;
    if (!r || r.deleted_at) continue;
    const hits = M.freezerHits(r.ingredients, frozen.map((p) => p.name));
    for (const p of frozen.filter((x) => hits.includes(x.name))) if (!out.some((o) => o.item.id === p.id)) out.push({ item: p, recipe: r });
  }
  return out;
}
// The next three days, for shopping ahead.
const soonDays = () => [0, 1, 2].map((i) => S.addDays(todayStr(), i));
function shopCard() {
  const groups = ingrGroups(soonDays()), need = groups.flatMap((g) => g.items.filter((x) => !x.listed && !x.kit));
  if (!need.length) return '';
  const titles = groups.filter((g) => g.items.some((x) => !x.listed && !x.kit)).map((g) => g.r.title);
  return `<button class="card press rise d1 cardbtn" data-act="shopsoon"><div class="ic">${ic('cart')}</div><div><b>Shop for the next few days</b><small>${plural(need.length, 'thing')} for ${esc(titles.length > 2 ? `${titles.slice(0, 2).join(', ')} and more` : titles.join(' and '))} ${need.length === 1 ? 'isn’t' : 'aren’t'} on the list yet.</small></div>${ic('chev')}</button>`;
}
function planNextCard(td) {
  const wd = S.weekdayOf(td);
  if (!(wd >= 4 || wd === 0)) return ''; // Thursday through Sunday
  const w0 = S.addDays(M.weekStart(td), 7), days = [0, 1, 2, 3, 4, 5, 6].map((i) => S.addDays(w0, i));
  const n = days.filter((d) => mealOf(M.slotOf(d))).length;
  if (n >= 4) return '';
  return `<button class="card press rise d1 cardbtn" data-act="plannext"><div class="ic">${ic('cal')}</div><div><b>Plan next week’s dinners</b><small>${n ? `${n} of 7 planned` : 'Nothing planned yet'} for ${weekRange(days)}. Plan early so there’s time to shop.</small></div>${ic('chev')}</button>`;
}
function thawCard(td) {
  const morning = +nowHM().slice(0, 2) < 14;
  const today = morning ? thawFor(td) : [], tom = thawFor(S.addDays(td, 1));
  const all = [...today.map((x) => ({ ...x, when: 'tonight’s' })), ...tom.map((x) => ({ ...x, when: 'tomorrow’s' }))];
  if (!all.length) return '';
  const names = all.map((x) => x.item.name), first = all[0];
  const what = names.length > 2 ? `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}` : names.join(' and ');
  return `<div class="card thaw rise d1"><div class="ic">${ic('snow')}</div><div><b>${today.length ? 'Thaw now' : 'Thaw tonight'}</b><small>Move ${esc(what.toLowerCase())} to the fridge for ${first.when} ${esc(first.recipe.title)}.</small></div><button class="mini press go" data-act="thawed" data-ids="${all.map((x) => x.item.id).join(',')}">Moved it</button></div>`;
}

// Planned meals that "Clear the week" would clear: today on (past days stay, for "last had").
const clearable = () => { const td = todayStr(), days = weekDays().filter((d) => d >= td); return live('meal_plan').filter((m) => days.includes(m.date) && (m.recipe_id || m.text)); };
function mealsView() {
  const days = weekDays(), td = todayStr(), lunch = lunchOn();
  const planned = days.filter((d) => mealOf(M.slotOf(d))).length;
  const line = (d, meal) => {
    const slot = M.slotOf(d, meal), m = mealOf(slot);
    const r = m && m.recipe_id ? findRow('recipes', m.recipe_id) : null, n = ingCount(r);
    const tag = meal === 'lunch' ? '<span class="ml">Lunch</span>' : '';
    return m
      ? `<button class="m press${meal === 'lunch' ? ' lu' : ''}" data-act="mslot" data-slot="${slot}">${tag}<span>${r && r.favorite ? `<span class="favi">${ic('star')}</span>` : ''}${esc(mealTitle(m))}</span>${r ? `<small>${esc(M.methodLabel(r.method) || 'Recipe')}${n ? ` · ${plural(n, 'ingredient')}` : ''}</small>` : ''}</button>`
      : `<button class="m open press${meal === 'lunch' ? ' lu' : ''}" data-act="mslot" data-slot="${slot}">+ ${meal === 'lunch' ? 'Lunch' : awayOn(d) ? 'Plan a smaller dinner' : 'Plan dinner'}</button>`;
  };
  const rows = days.map((d) => `<div class="pday${d === td ? ' today' : ''}${d < td ? ' past' : ''}"><span class="d"><b>${shortDay(d, { weekday: 'short' })}</b>${shortDay(d, { month: 'short', day: 'numeric' })}${awayOn(d) ? '<i class="dtag">Shift</i>' : onCallOn(d) ? '<i class="dtag">On call</i>' : ''}</span><div class="ms">${line(d, 'dinner')}${lunch ? line(d, 'lunch') : ''}</div></div>`).join('');
  const nav = `<div class="wk"><button class="press" data-act="wk" data-v="-1" aria-label="Last week">‹ Last</button><button class="press wkn" data-act="wk" data-v="0"><b>${weekRange(days)}</b>${ui.week ? '<small>Back to this week</small>' : ''}</button><button class="press" data-act="wk" data-v="1" aria-label="Next week">Next ›</button></div>`;
  return `${header(`${planned} of 7 dinners planned`, 'Meals')}
  <main>
    ${kseg()}${nav}
    <div class="list plan rise d1">${rows}</div>
    <div class="two rise d2"><button class="pri press" data-act="iopen">${ic('cart')}Ingredients to grocery</button><button class="ghost press" data-act="aiopen">${ic('copy')}Copy for AI</button></div>
    <button class="more press rise d2" data-act="planopen">${ic('plus')}Paste the AI’s plan</button>
    ${clearable().length ? `<button class="clear wkclear press" data-act="wkclear">${ic('x')}Clear ${ui.week ? 'that week' : 'the rest of this week'} (${plural(clearable().length, 'meal')})</button>` : ''}
  </main>
  ${dock('kitchen')}`;
}

const star = (r) => `<button class="flag fav press${r.favorite ? ' on' : ''}" data-act="rfav" data-id="${r.id}" aria-pressed="${!!r.favorite}" aria-label="${r.favorite ? 'Unstar' : 'Star'} ${esc(r.title)}">${ic('star')}</button>`;
function recipesView() {
  const rs = recipes();
  const row = (r) => { const n = ingCount(r); return `<div class="it"><button class="nm" data-act="ritem" data-id="${r.id}">${esc(r.title)}<small>${[tagLine(r), n ? plural(n, 'ingredient') : 'No ingredients yet', hadLine(r)].filter(Boolean).join(' · ')}</small></button>${star(r)}</div>`; };
  return `${header(rs.length ? plural(rs.length, 'recipe') : 'Recipe box', 'Recipes')}
  <main>
    ${kseg()}
    <form class="qa slim rise" data-form="radd" autocomplete="off"><div class="row">
      <input class="fld" name="name" type="text" placeholder="Add a recipe" maxlength="120" enterkeyhint="done" aria-label="Recipe name">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div></form>
    <button class="more press rise d1" data-act="pasteopen">${ic('copy')}Paste a whole recipe</button>
    ${rs.length ? `<div class="list rise d1">${rs.map(row).join('')}</div>` : '<p class="empty">No recipes yet. Add one by name, or paste a whole recipe and it gets split into ingredients and steps.</p>'}
  </main>
  ${dock('kitchen')}`;
}

const WANTS = ['Lighter', 'Comfort food', 'Quick', 'Pasta', 'Chicken', 'Mexican', 'Asian', 'Soup', 'Kid favorite', 'Something new'];
function mealSheet(slot) {
  const [date, meal] = String(slot).split(':');
  if (!date || !meal) return '';
  const m = findRow('meal_plan', slot) || {};
  const rs = recipes();
  const favs = rs.filter((r) => r.favorite && r.id !== m.recipe_id).sort((a, b) => lastHad(a.id).localeCompare(lastHad(b.id))); // longest ago first
  return `<h2>${shortDay(date, { weekday: 'short', month: 'short', day: 'numeric' })} · ${meal === 'lunch' ? 'Lunch' : 'Dinner'}<button class="lnk" data-act="close">Done</button></h2>
    <form class="qa slim" data-form="mtext" autocomplete="off" style="margin:0 0 6px"><div class="row">
      <input class="fld" name="name" type="text" placeholder="Type it (leftovers, pizza night…)" value="${esc(m.recipe_id ? '' : m.text || '')}" maxlength="120" enterkeyhint="done" aria-label="Meal">
      <button class="add press" type="submit" aria-label="Save">${ic('check')}</button></div></form>
    <div class="scroll">
      ${favs.length ? `${sec('Swap with a favorite')}<div class="gear favs">${favs.map((r) => `<button class="pick press" data-act="mpick" data-slot="${slot}" data-id="${r.id}"><span class="favi">${ic('star')}</span>${esc(r.title)}</button>`).join('')}</div>` : ''}
      ${date >= todayStr() ? `${sec('Or ask AI for something else')}
      <form class="swap" data-form="swap" autocomplete="off">
        <p class="hint" style="margin:0 4px 8px">Tell the AI what kind of meal you want: tap a few, or type your own.</p>
        <div class="gear wants">${WANTS.map((w) => `<button type="button" class="pick press" data-act="wantadd" data-v="${w}">${w}</button>`).join('')}</div>
        <input class="in" name="want" type="text" placeholder="What sounds good? Lighter, Mexican, pasta…" maxlength="160" enterkeyhint="done" aria-label="What sounds good">
        <div class="two"><button type="button" class="pri press" data-act="swapcopy" data-slot="${slot}">${ic('copy')}Copy for AI</button><button type="button" class="ghost press" data-act="planopen">${ic('plus')}Paste the reply</button></div></form>` : ''}
      ${rs.length ? `${sec('Or pick a recipe', rs.length)}<div class="list opts">${rs.map((r) => `<button class="opt press${m.recipe_id === r.id ? ' on' : ''}" data-act="mpick" data-slot="${slot}" data-id="${r.id}"><span>${r.favorite ? `<span class="favi">${ic('star')}</span>` : ''}${esc(r.title)}<small>${[tagLine(r), hadLine(r)].filter(Boolean).join(' · ')}</small></span>${m.recipe_id === r.id ? ic('check') : ''}</button>`).join('')}</div>`
        : '<p class="empty">No recipes yet. Add them under Recipes, or type a meal above.</p>'}
      ${m.recipe_id || m.text ? `<button class="ghost press" data-act="mclear" data-slot="${slot}">Clear ${meal}</button>` : ''}
    </div>`;
}

function recipeSheet(r) {
  if (!r || r.deleted_at) return '';
  const n = ingCount(r);
  const link = r.source_url && /^https?:\/\//i.test(r.source_url) ? `<a class="src press" href="${esc(r.source_url)}" target="_blank" rel="noopener">${ic('link')}Open the recipe page</a>` : '';
  return `<h2><input class="ttl" data-rf="title" data-id="${r.id}" value="${esc(r.title)}" maxlength="120" aria-label="Recipe name" enterkeyhint="done">${star(r)}<button class="lnk" data-act="close">Done</button></h2>
    <div class="scroll">
      ${sec('How to cook')}
      <div class="gear meth">${M.METHODS.map(([k, l]) => `<button class="pick press${r.method === k ? ' on' : ''}" data-act="rmethod" data-k="${k}" data-id="${r.id}" aria-pressed="${r.method === k}">${l}</button>`).join('')}</div>
      <div class="list frm">
        <button class="frow swr" role="switch" aria-checked="${!!r.quick}" data-act="rtag" data-k="quick" data-id="${r.id}">Quick (30 minutes or less)<span class="tg" aria-hidden="true"></span></button>
        <button class="frow swr" role="switch" aria-checked="${!!r.kid_friendly}" data-act="rtag" data-k="kid_friendly" data-id="${r.id}">Kids like it<span class="tg" aria-hidden="true"></span></button>
        <button class="frow swr" role="switch" aria-checked="${!!r.never_again}" data-act="rtag" data-k="never_again" data-id="${r.id}">Never again<span class="tg" aria-hidden="true"></span></button>
      </div>
      ${sec('Plan it', hadLine(r))}
      <div class="picks2 again">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = S.addDays(todayStr(), i), on = findRow('meal_plan', M.slotOf(d))?.recipe_id === r.id; return `<button class="pick press${on ? ' on' : ''}" data-act="ragain" data-id="${r.id}" data-date="${d}" aria-pressed="${on}">${i === 0 ? 'Tonight' : shortDay(d, { weekday: 'short' })}</button>`; }).join('')}</div>
      <div class="list frm" style="margin-top:12px"><label class="frow">Link<input class="txt" type="url" inputmode="url" autocapitalize="off" data-rf="source_url" data-id="${r.id}" value="${esc(r.source_url || '')}" placeholder="Optional" maxlength="500"></label></div>
      ${link}
      ${sec('Ingredients', n ? `${n} · one per line` : 'One per line')}
      <textarea class="ta" data-rf="ingredients" data-id="${r.id}" rows="7" placeholder="1 lb chicken thighs&#10;8 tortillas">${esc(r.ingredients || '')}</textarea>
      ${sec('Steps')}
      <textarea class="ta" data-rf="steps" data-id="${r.id}" rows="7" placeholder="One step per line">${esc(r.steps || '')}</textarea>
      ${sec('Notes')}
      <textarea class="ta" data-rf="notes" data-id="${r.id}" rows="2" placeholder="Optional">${esc(r.notes || '')}</textarea>
      <button class="ghost press" data-act="rdel" data-id="${r.id}" style="margin-top:14px">Delete recipe</button>
    </div>`;
}

// Ingredients from the recipes planned for the rest of the shown week (the whole week if it's ahead).
function ingrGroups(only) {
  const td = todayStr();
  const days = only || ui.ingrDays || weekDays().filter((d) => ui.week > 0 || d >= td);
  const have = pantry().filter((p) => p.status === 'have').map((p) => p.name);
  const low = pantry().filter((p) => p.status === 'low').map((p) => p.name);
  const seen = new Set(), groups = [];
  for (const d of days) for (const meal of ['dinner', 'lunch']) {
    const m = mealOf(M.slotOf(d, meal));
    if (!m || !m.recipe_id || seen.has(m.recipe_id)) continue;
    const r = findRow('recipes', m.recipe_id);
    if (!r || r.deleted_at) continue;
    seen.add(r.id);
    const items = M.ingredientLines(r.ingredients).map((line, i) => {
      const p = M.parseIngredient(line), key = `${r.id}|${i}`;
      p.name = p.name.charAt(0).toUpperCase() + p.name.slice(1);
      const listed = !!onGrocery(p.name), kit = M.inKitchen(p.name, have), lo = !kit && M.inKitchen(p.name, low);
      return { key, ...p, listed, kit, lo, on: key in ui.ingr ? ui.ingr[key] : !listed && !kit };
    });
    if (items.length) groups.push({ r, items });
  }
  return groups;
}

function ingrSheet() {
  const groups = ingrGroups();
  const n = groups.reduce((t, g) => t + g.items.filter((x) => x.on).length, 0);
  const why = (x) => (x.listed ? 'On grocery' : x.kit ? 'Kitchen has it' : x.lo ? 'Low in the kitchen' : '');
  const row = (x) => `<div class="it ing" data-act="itog" data-k="${x.key}" role="checkbox" aria-checked="${x.on}"><span class="cb${x.on ? ' on' : ''}">${x.on ? ic('check') : ''}</span><span class="nm">${esc(x.name)}${x.qty ? `<small>${esc(x.qty)}</small>` : ''}${why(x) ? `<span class="have${x.lo ? ' lo' : ''}">${why(x)}</span>` : ''}</span></div>`;
  if (!groups.length) return `<h2>Add to grocery<button class="lnk" data-act="close">Done</button></h2>
    <p class="empty">No recipes planned ${ui.week > 0 ? 'that week' : ui.week < 0 ? 'that week from today on' : 'for the rest of this week'}. Typed meals, like “pizza night”, don’t have ingredients.</p>`;
  return `<h2>Add to grocery<button class="lnk" data-act="close">Cancel</button></h2>
    <p class="hint" style="margin-top:0">From ${plural(groups.length, 'recipe')} ${ui.ingrDays ? 'in the next few days' : ui.week > 0 ? 'that week' : 'this week'}. Uncheck anything you already have.</p>
    <div class="scroll">${groups.map((g) => `${sec(esc(g.r.title), g.items.length)}<div class="list">${g.items.map(row).join('')}</div>`).join('')}</div>
    <div class="foot2"><button class="pri press" data-act="iadd"${n ? '' : ' disabled'}>${ic('cart')}${n ? `Add ${n} to grocery` : 'Nothing checked'}</button></div>`;
}

// What every AI message shares: the kitchen, recent dinners before `from`, saved recipes, appliances.
function aiContext(from) {
  const names = (f) => pantry().filter(f).map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const kitchen = {};
  for (const [k, l] of LOCS) kitchen[l] = names((p) => p.location === k && p.status === 'have');
  return {
    kitchen, low: names((p) => p.status === 'low'), out: names((p) => p.status === 'out'),
    recent: [...new Set(live('meal_plan').filter((m) => m.meal === 'dinner' && m.date < from && m.date >= S.addDays(from, -14)).sort((a, b) => b.date.localeCompare(a.date)).map((m) => mealTitle(m)).filter(Boolean))],
    recipes: recipes().filter((r) => !r.never_again).slice(0, 40),
    avoid: recipes().filter((r) => r.never_again).map((r) => r.title),
    gear: GEAR.filter(([k]) => gear().includes(k)).map(([, l]) => l.toLowerCase())
  };
}
function aiPrompt() {
  const days = weekDays();
  return M.buildPrompt({
    ...aiContext(days[0]), range: weekRange(days), lunch: lunchOn(),
    days: days.map((d) => ({ label: shortDay(d, { weekday: 'short' }), dinner: mealTitle(mealOf(M.slotOf(d))) || null, lunch: mealTitle(mealOf(M.slotOf(d, 'lunch'))) || null, away: awayOn(d), onCall: onCallOn(d) }))
  });
}
function swapPrompt(slot, want) {
  const [date, meal] = slot.split(':');
  return M.buildSwapPrompt({ ...aiContext(date), day: shortDay(date, { weekday: 'short' }), meal, current: mealTitle(mealOf(slot)) || null, want, away: meal === 'dinner' && awayOn(date) });
}
async function copySwap(slot, want, btn) {
  const text = swapPrompt(slot, want);
  try { await navigator.clipboard.writeText(text); btn.classList.add('jelly'); btn.innerHTML = `${ic('check')}Copied`; }
  catch { prompt('Copy this:', text); }
}

function aiSheet() {
  return `<h2>Copy for AI<button class="lnk" data-act="close">Done</button></h2>
    <p class="hint" style="margin-top:0">One message with your kitchen, recipes, and ${ui.week ? 'that' : 'this'} week’s plan. Paste it into Claude or ChatGPT, then save any idea you like as a recipe.</p>
    <div class="scroll"><pre class="prompt">${esc(aiPrompt())}</pre></div>
    <div class="two foot2"><button class="pri press" data-act="aicopy">${ic('copy')}Copy</button><button class="ghost press" data-act="planopen">${ic('plus')}Paste the reply</button></div>`;
}

// Paste the AI's reply: read its PLAN lines and RECIPE blocks, preview, then fill the week in one tap.
function planPasteSheet() {
  return `<h2>Paste the AI’s plan<button class="lnk" data-act="close">Cancel</button></h2>
    <p class="hint" style="margin-top:0">Paste the whole reply. The app reads the PLAN lines (“Thu: Sheet pan gnocchi”) and any RECIPE parts for ${ui.week ? 'that' : 'this'} week, then shows you what it will fill.</p>
    ${ui.planErr ? `<p class="hint warnt">${esc(ui.planErr)}</p>` : ''}
    <div class="scroll"><textarea class="ta" id="planbox" rows="12" placeholder="PLAN&#10;Thu: Sheet pan gnocchi&#10;Sun: Chicken tacos&#10;&#10;RECIPE: Sheet pan gnocchi&#10;Ingredients&#10;…"></textarea></div>
    <div class="foot2"><button class="pri press" data-act="planread">${ic('arr')}Preview</button></div>`;
}

function readPlan(text) {
  const { slots, recipes: fresh } = M.parsePlan(text, weekDays());
  const saved = recipes();
  const rs = fresh.filter((r) => !saved.some((x) => M.sameTitle(x.title, r.title))).map((r) => ({ ...r, on: true }));
  const ss = slots.map((x) => {
    const cur = mealTitle(mealOf(M.slotOf(x.date, x.meal)));
    const keep = cur && M.sameTitle(cur, x.title);
    return { ...x, cur: keep ? '' : cur, on: !cur && !keep, same: keep };
  }).filter((x) => !x.same && (x.meal === 'dinner' || lunchOn()));
  if (ss.length === 1) ss[0].on = true; // a one-meal swap means "replace it"
  return { slots: ss, recipes: rs };
}

function planSheet() {
  const p = ui.plan;
  if (!p) return '';
  const saved = recipes();
  const kind = (x) => {
    if (saved.some((r) => M.sameTitle(r.title, x.title))) return 'Saved recipe';
    const n = p.recipes.find((r) => M.sameTitle(r.title, x.title));
    return n ? (n.on ? 'New recipe' : 'Typed meal (recipe not saved)') : 'Typed meal';
  };
  const n = p.slots.filter((x) => x.on).length, nr = p.recipes.filter((r) => r.on).length;
  const row = (on, act, i, title, sub) => `<div class="it ing" data-act="${act}" data-i="${i}" role="checkbox" aria-checked="${on}"><span class="cb${on ? ' on' : ''}">${on ? ic('check') : ''}</span><span class="nm">${title}${sub}</span></div>`;
  return `<h2>Fill the week<button class="lnk" data-act="close">Cancel</button></h2>
    <p class="hint" style="margin-top:0">Days you’ve already planned start unchecked.</p>
    <div class="scroll">
      ${sec('Meals', p.slots.length)}<div class="list">${p.slots.map((x, i) => row(x.on, 'ptog', i, `${shortDay(x.date, { weekday: 'short' })}${x.meal === 'lunch' ? ' lunch' : ''} · ${esc(x.title)}`, `<small>${kind(x)}</small>${x.cur ? `<span class="have lo">Replaces ${esc(x.cur)}</span>` : ''}`)).join('')}</div>
      ${p.recipes.length ? `${sec('New recipes', p.recipes.length)}<div class="list">${p.recipes.map((r, i) => row(r.on, 'rtog', i, esc(r.title), `<small>${r.method ? `${M.methodLabel(r.method)} · ` : ''}${plural(ingCount(r), 'ingredient')}${r.steps ? ` · ${plural(r.steps.split('\n').length, 'step')}` : ''}</small>`)).join('')}</div>` : ''}
    </div>
    <div class="foot2"><button class="pri press" data-act="planapply"${n || nr ? '' : ' disabled'}>${ic('check')}${n ? `Fill ${plural(n, 'meal')}` : nr ? `Save ${plural(nr, 'recipe')}` : 'Nothing checked'}</button></div>`;
}

function applyPlan() {
  const p = ui.plan;
  if (!p) return;
  const made = p.recipes.filter((r) => r.on).map(({ on, ...r }) => insertRow('recipes', r));
  for (const x of p.slots.filter((s2) => s2.on)) {
    const r = [...recipes(), ...made].find((y) => M.sameTitle(y.title, x.title));
    setMeal(M.slotOf(x.date, x.meal), { recipe_id: r ? r.id : null, text: r ? null : x.title });
  }
}

function pasteSheet() {
  return `<h2>Paste a recipe<button class="lnk" data-act="close">Cancel</button></h2>
    <p class="hint" style="margin-top:0">Paste the whole thing. The first line becomes the title, and lines under “Ingredients” and “Steps” go in their own boxes. You can fix anything after.</p>
    <div class="scroll"><textarea class="ta" id="pastebox" rows="12" placeholder="Lemon chicken&#10;Ingredients&#10;4 chicken thighs&#10;2 lemons&#10;Steps&#10;1. Heat the pan…"></textarea></div>
    <div class="foot2"><button class="pri press" data-act="pastesave">${ic('check')}Save recipe</button></div>`;
}

async function copyPrompt(btn) {
  const text = aiPrompt();
  try { await navigator.clipboard.writeText(text); btn.classList.add('jelly'); btn.innerHTML = `${ic('check')}Copied`; }
  catch { prompt('Copy this:', text); }
}

/* --- chores and tasks --- */
const todayStr = () => S.localToday(T.now());
const choresAll = () => live('tasks').filter((t) => t.kind === 'chore');
const tasksAll = () => live('tasks').filter((t) => t.kind === 'task');
const partnerId = () => state.members.find((id) => id !== myId()) || partner()?.user_id || null;
const userName = (id) => { const n = (profileOf(id)?.display_name || '').trim(); return n || (id === myId() ? 'You' : 'Partner'); };
const whoKey = (t) => (!t.assignee ? 'either' : t.assignee === myId() ? 'me' : 'partner');
const whoInitial = (t) => (!t.assignee ? 'E' : (userName(t.assignee)[0] || '?').toUpperCase());
const whoLine = (t) => (!t.assignee ? 'Either' : userName(t.assignee));
const passWho = (t) => ui.who === 'all' || whoKey(t) === ui.who;
const missed = (today) => choresAll().filter((c) => c.active && S.isOverdue(c, today));
const TASK_LISTS = ['House', 'Kids', 'Errands'];
const taskLists = () => [...new Set([...TASK_LISTS, ...tasksAll().map((t) => t.category).filter(Boolean), ...ls.get(K.lists, [])])];
const eventsOf = (id) => live('task_events').filter((e) => e.task_id === id && !e.undone_at).sort((a, b) => String(b.at).localeCompare(String(a.at)));

function recordEvent(t, kind, due) {
  return insertRow('task_events', { task_id: t.id, kind, due_date: due, at: new Date().toISOString(), by_user: myId() }, { conflict: 'task_id,kind,due_date' });
}

// Done or skip closes the open instance and schedules the next one. One open instance per chore, never a stack.
function closeChore(c, kind) {
  const today = todayStr();
  if (c.kind === 'task' || c.repeat_mode === 'once') {
    if (kind === 'done') { const ev = recordEvent(c, 'done', c.due_date || today); updateRow('tasks', c.id, { done_at: new Date().toISOString() }); return ev; }
    return null;
  }
  const ev = recordEvent(c, kind, c.due_date || today);
  updateRow('tasks', c.id, { due_date: S.nextDue(c, today) });
  return ev;
}

// Sunday reset: frequent misses start fresh; monthly-or-longer ones and tasks stay until done. History is kept.
function resetWeek() {
  const today = todayStr();
  let n = 0;
  for (const c of missed(today)) {
    if (!S.resetsWeekly(c)) continue;
    const next = S.resetDue(c, today);
    if (next && next !== c.due_date) { recordEvent(c, 'reset', c.due_date); updateRow('tasks', c.id, { due_date: next }); n++; }
  }
  return n;
}

function newChore() {
  const today = todayStr();
  const c = { kind: 'chore', title: 'New chore', category: null, assignee: null, priority: false, notes: null, howto: null, active: true,
    repeat_mode: 'after', every: 1, unit: 'week', week_of_month: null, weekday: null, months: null };
  c.anchor_date = c.due_date = S.initialDue(c, today);
  return insertRow('tasks', c);
}

// How full a day is, from the calendar owner's schedule.
function loadOf(d) {
  const st = statusOf(d);
  if (['working', 'activated', 'post_call', 'union'].includes(st.type) || st.union || calRows().some((r) => r.kind === 'event_shift' && r.start_date === d)) return 'busy';
  if (st.type === 'on_call') return 'light';
  if (st.type === 'no_shift') return 'free';
  return 'unknown'; // schedule not posted: don't send chores there
}
// A big chore of the calendar owner's (or an Either chore, on their phone) that's due on a busy day gets a better day.
function fitFor(c, today = todayStr()) {
  if (!calOwner() || !c.active || !c.due_date || F.sizeOf(c) !== 'big') return null;
  if (!(c.assignee === calOwner() || (!c.assignee && calOwner() === myId()))) return null;
  const due = S.shownDue(c, today), d = F.betterDay(due, today, F.slackFor(c), loadOf);
  return d ? { date: d, why: loadOf(d) === 'free' ? 'day off' : 'on call', busy: chipText(statusOf(due)) } : null;
}
const dayShort = (d) => (d === todayStr() ? 'today' : d === S.addDays(todayStr(), 1) ? 'tomorrow' : shortDay(d, { weekday: 'long' }));
const fitRow = (c, f) => `<div class="fitrow"><span>${esc(f.busy)} that day. Better ${esc(dayShort(f.date))} (${f.why}).</span><button class="mini press" data-act="cmove" data-id="${c.id}" data-date="${f.date}">Move</button></div>`;

function choreRow(c, today) {
  const fit = fitFor(c, today);
  const due = S.shownDue(c, today), late = S.isOverdue(c, today);
  const open = ui.howto === c.id && c.howto;
  return `<div class="it${late ? ' late' : ''}">${`<button class="cb press" data-act="cdone" data-id="${c.id}" role="checkbox" aria-checked="false" aria-label="Done: ${esc(c.title)}"></button>`}
    <button class="nm" data-act="citem" data-id="${c.id}">${esc(c.title)}<span class="meta"><b>${S.dueLabel(due, today)}</b> · ${esc(S.repeatLabel(c))}</span></button>
    ${c.howto ? `<button class="qbtn press" data-act="howto" data-id="${c.id}" aria-expanded="${!!open}" aria-label="How to">${ic('q')}</button>` : ''}
    <span class="who${whoKey(c) === 'me' ? ' me' : ''}" title="${esc(whoLine(c))}">${esc(whoInitial(c))}</span></div>
    ${fit ? fitRow(c, fit) : ''}
    ${open ? `<div class="howto"><ol>${c.howto.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `<li>${esc(l.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')}</ol></div>` : ''}`;
}

function choresView() {
  const today = todayStr(), weekEnd = S.addDays(today, 6);
  const tabs = `<div class="seg rise" role="group" aria-label="Chores or tasks"><button class="${ui.choreTab === 'chores' ? 'on' : ''}" data-act="ctab" data-v="chores">Chores</button><button class="${ui.choreTab === 'tasks' ? 'on' : ''}" data-act="ctab" data-v="tasks">Tasks</button></div>`;
  if (ui.choreTab === 'tasks') return tasksView(tabs);
  const all = choresAll().filter((c) => c.active && c.due_date);
  const list = all.filter(passWho).map((c) => ({ c, due: S.shownDue(c, today) })).sort((a, b) => a.due.localeCompare(b.due) || a.c.title.localeCompare(b.c.title));
  const over = list.filter((x) => S.isOverdue(x.c, today));
  const hero = over[0] || list.find((x) => x.due === today);
  const rest = list.filter((x) => x !== hero);
  const groups = [
    ['Overdue', rest.filter((x) => S.isOverdue(x.c, today))],
    ['Today', rest.filter((x) => x.due === today && !S.isOverdue(x.c, today))],
    ['This week', rest.filter((x) => x.due > today && x.due <= weekEnd)]
  ];
  const later = rest.filter((x) => x.due > weekEnd);
  const off = choresAll().filter((c) => !c.active && passWho(c));
  const overAll = all.filter((c) => S.isOverdue(c, today)).length;
  const weekAll = all.filter((c) => { const d = S.shownDue(c, today); return d >= today && d <= weekEnd; }).length;
  const chip = (k, label) => `<button class="fchip press${ui.who === k ? ' on' : ''}" data-act="cwhof" data-v="${k}">${esc(label)}</button>`;
  const heroHtml = hero ? `<div class="stack rise" style="margin:12px 0 26px"><section class="hero chore">
      <p class="eyebrow">${S.isOverdue(hero.c, today) ? `Overdue · ${plural(-S.diffDays(hero.c.due_date, today), 'day')}` : 'Due today'}</p>
      <h2>${esc(hero.c.title)}</h2><p>${esc(S.repeatLabel(hero.c))} · ${esc(whoLine(hero.c))}${F.sizeOf(hero.c) === 'big' ? ' · Big' : ''}</p>
      ${fitFor(hero.c, today) ? `<p class="pcl">Busy day. Better ${esc(dayShort(fitFor(hero.c, today).date))} (${fitFor(hero.c, today).why}). <button class="lnk2 press" data-act="cmove" data-id="${hero.c.id}" data-date="${fitFor(hero.c, today).date}">Move it</button></p>` : ''}
      <div class="acts"><button class="pri press" data-act="cdonehero" data-id="${hero.c.id}">${ic('check')}Done</button><button class="skipb press" data-act="cskip" data-id="${hero.c.id}">Skip</button></div>
    </section></div>` : '';
  const sections = groups.filter(([, xs]) => xs.length).map(([label, xs]) => `${sec(label, xs.length)}<div class="list">${xs.map((x) => choreRow(x.c, today)).join('')}</div>`).join('');
  const laterHtml = later.length ? (ui.showLater
    ? `${sec('Later', later.length)}<div class="list">${later.map((x) => choreRow(x.c, today)).join('')}</div>`
    : `<button class="more press" data-act="clater">Show ${plural(later.length, 'later chore')}</button>`) : '';
  const offHtml = ui.showLater && off.length ? `${sec('Switched off', off.length)}<div class="list">${off.map((c) => `<div class="it off"><span class="cb ghosted"></span><button class="nm" data-act="citem" data-id="${c.id}">${esc(c.title)}<span class="meta">${esc(S.repeatLabel(c))}</span></button></div>`).join('')}</div>` : '';
  const pName = partnerId() ? userName(partnerId()) : null;
  return `${header(overAll || weekAll ? [overAll && `${overAll} overdue`, weekAll && `${weekAll} this week`].filter(Boolean).join(' · ') : 'All caught up', 'Chores')}
  <main>
    ${tabs}
    <div class="fchips rise">${chip('all', 'Everyone')}${chip('me', myName() || 'Me')}${pName ? chip('partner', pName) : ''}${chip('either', 'Either')}</div>
    ${heroHtml}
    ${!list.length && !off.length ? `<p class="empty">${choresAll().length ? 'Nothing for this filter.' : 'No chores yet. Import your list in Settings, or add one below.'}</p>` : ''}
    ${sections}${laterHtml}${offHtml}
    <div class="crow"><button class="more press" data-act="cnew">${ic('plus')}New chore</button><a class="more press" href="#/reset">${ic('reset')}Sunday reset</a></div>
  </main>
  ${dock('chores')}`;
}

function tasksView(tabs) {
  const today = todayStr();
  const open = tasksAll().filter((t) => !t.done_at);
  const done = tasksAll().filter((t) => t.done_at).sort((a, b) => String(b.done_at).localeCompare(String(a.done_at))).slice(0, 30);
  const sort = (a, b) => (b.priority - a.priority) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const lists = taskLists();
  const cat = lists.includes(ui.taskCat) ? ui.taskCat : lists[0];
  const row = (t) => `<div class="it${t.done_at ? ' done' : ''}">
      <button class="cb${t.done_at ? ' on' : ''} press" data-act="tdone" data-id="${t.id}" role="checkbox" aria-checked="${!!t.done_at}" aria-label="${t.done_at ? 'Not done' : 'Done'}: ${esc(t.title)}">${t.done_at ? ic('check') : ''}</button>
      <button class="nm" data-act="titem" data-id="${t.id}">${esc(t.title)}${t.due_date && !t.done_at ? `<span class="meta">${S.isOverdue(t, today) ? `<b>${S.dueLabel(t.due_date, today)}</b>` : `Due ${S.dueLabel(t.due_date, today)}`}</span>` : ''}</button>
      ${t.done_at ? '' : `<button class="flag press${t.priority ? ' on' : ''}" data-act="tflag" data-id="${t.id}" aria-pressed="${t.priority}" aria-label="Priority">${ic('flag')}</button>`}</div>`;
  const flagged = open.filter((t) => t.priority).length;
  const byList = lists.map((l) => [l, open.filter((t) => (t.category || 'House') === l).sort(sort)]).filter(([, xs]) => xs.length);
  return `${header(open.length ? `${open.length} open${flagged ? ` · ${flagged} flagged` : ''}` : 'All done', 'Tasks')}
  <main>
    ${tabs}
    <form class="qa rise" data-form="tadd" autocomplete="off" style="margin-top:12px">
      <div class="row"><input class="fld" name="name" type="text" placeholder="${cozy() ? 'What needs doing?' : 'Add a task'}" maxlength="120" enterkeyhint="done" aria-label="Add a task">
      <button class="add press" type="submit" aria-label="Add">${ic('plus')}<span>Add</span></button></div>
      <div class="chips">${lists.map((l) => `<button type="button" class="chip press${l === cat ? ' on' : ''}" data-act="tcat" data-v="${esc(l)}" aria-pressed="${l === cat}">${esc(l)}</button>`).join('')}<button type="button" class="chip press" data-act="tnewcat">${ic('plus')}List</button></div>
    </form>
    ${!open.length ? `<p class="empty">Nothing open. Add things as they come up; flag the ones that matter most.</p>` : ''}
    ${byList.map(([l, xs]) => `${sec(esc(l), xs.length)}<div class="list">${xs.map(row).join('')}</div>`).join('')}
    ${done.length ? (ui.showDone ? `${sec('Done', done.length)}<div class="list">${done.map(row).join('')}</div>` : `<button class="more press" data-act="tshowdone">Show ${plural(done.length, 'done task')}</button>`) : ''}
  </main>
  ${dock('chores')}`;
}

function resetView() {
  const today = todayStr();
  const miss = missed(today).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const fresh = miss.filter(S.resetsWeekly), stay = miss.filter((c) => !S.resetsWeekly(c));
  const row = (c, next) => `<div class="it"><span class="pill">${esc(S.repeatLabel(c).split(',')[0].split(' · ')[0])}</span><span class="nm">${esc(c.title)}<span class="meta">${S.dueLabel(c.due_date, today)} · ${next}</span></span></div>`;
  const doneMsg = ui.resetCount != null ? `<div class="hero sum rise" style="margin-bottom:14px"><p class="eyebrow">Done</p><h2>Week reset</h2><p>${ui.resetCount ? `${plural(ui.resetCount, 'chore')} start${ui.resetCount === 1 ? 's' : ''} fresh.` : 'Nothing needed resetting.'} History is kept.</p></div>` : '';
  const dateLine = new Date(S.parse(today)).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${header(dateLine, 'Sunday reset')}
  <main class="has-big">
    ${doneMsg}
    ${miss.length ? `<p class="rs-sum">${plural(miss.length, 'thing was', 'things were')} missed. ${fresh.length ? 'The weekly ones start fresh; ' : ''}${stay.length ? 'the rest stay until they’re done.' : ''}</p>` : (ui.resetCount == null ? `<p class="empty">Nothing missed. Nice week.</p>` : '')}
    ${fresh.length ? `${sec('Starts fresh', fresh.length)}<div class="list">${fresh.map((c) => row(c, `next ${S.dueLabel(S.resetDue(c, today), today)}`)).join('')}</div>` : ''}
    ${stay.length ? `${sec('Stays until done', stay.length)}<div class="list">${stay.map((c) => row(c, 'still due')).join('')}</div>` : ''}
  </main>
  ${fresh.length ? `<div class="bigbtn"><button class="pri press" data-act="resetweek">${ic('reset')}Reset week</button></div>` : ''}
  ${dock('chores')}`;
}

function choreSheet(c) {
  if (!c || c.deleted_at) return '';
  const today = todayStr();
  const pid = partnerId();
  const seg = (act, opts, cur) => `<div class="seg sm">${opts.map(([v, l]) => `<button class="${v === cur ? 'on' : ''}" data-act="${act}" data-id="${c.id}" data-v="${v}" aria-pressed="${v === cur}">${esc(l)}</button>`).join('')}</div>`;
  const sel = (field, opts, cur) => `<select class="sel" data-field="${field}" data-id="${c.id}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const monthly = c.unit === 'month' || c.unit === 'year';
  const hist = eventsOf(c.id).slice(0, 6).map((e) => `${S.dueLabel(S.localToday(new Date(e.at)), today)} · ${e.kind === 'done' ? `done by ${esc(userName(e.by_user))}` : e.kind === 'skip' ? 'skipped' : 'reset on Sunday'}`).join('<br>');
  const months = c.months && c.months.length ? c.months : [];
  return `<h2><input class="ttl" data-field="title" data-id="${c.id}" value="${esc(c.title)}" maxlength="120" aria-label="Chore name" enterkeyhint="done"><button class="lnk" data-act="close">Done</button></h2>
    <div class="scroll">
      <div class="acts2"><button class="pri press" data-act="cdone" data-id="${c.id}">${ic('check')}Mark done</button><button class="ghost press" data-act="cskip" data-id="${c.id}">Skip</button></div>
      <div class="list frm">
        <div class="frow">Who${seg('cwho', [['me', myName() || 'Me'], ...(pid ? [['partner', userName(pid)]] : []), ['either', 'Either']], whoKey(c))}</div>
        <label class="frow">Next due<input type="date" class="dt" data-field="due_date" data-id="${c.id}" value="${c.due_date || ''}"></label>
        <div class="frow">Repeats<span class="pair"><span class="evl">Every</span><input type="number" class="num" min="1" max="365" inputmode="numeric" data-field="every" data-id="${c.id}" value="${c.every || 1}" aria-label="Every">${sel('unit', [['day', c.every > 1 ? 'days' : 'day'], ['week', c.every > 1 ? 'weeks' : 'week'], ['month', c.every > 1 ? 'months' : 'month'], ['year', c.every > 1 ? 'years' : 'year']], c.unit)}</span></div>
        ${monthly ? `<div class="frow">Week of the month${sel('week_of_month', [['', 'Any'], ['1', 'Week 1'], ['2', 'Week 2'], ['3', 'Week 3'], ['4', 'Week 4']], c.week_of_month)}</div>` : ''}
        ${c.unit === 'week' || (monthly && c.week_of_month) ? `<div class="frow">Day${sel('weekday', [['', 'Any'], ...S.WEEKDAYS.map((d, i) => [String(i), d])], c.weekday)}</div>` : ''}
        <div class="frow">Size${seg('csize', [['quick', 'Quick'], ['big', 'Big']], F.sizeOf(c))}</div>
        <div class="frow">Count from${seg('cmode', [['after', 'Last done'], ['fixed', 'Schedule']], c.repeat_mode === 'fixed' ? 'fixed' : 'after')}</div>
      </div>
      <p class="hint">${esc(S.repeatLabel(c))}. ${c.repeat_mode === 'fixed' ? 'Stays on the calendar even when it’s done late.' : 'The next one is counted from the day it’s done.'}</p>
      ${sec('Only in these months', months.length ? `${months.length} of 12` : 'All year')}
      <div class="months">${S.MONTHS.map((m, i) => `<button class="press${!months.length || months.includes(i + 1) ? ' on' : ''}" data-act="cmonth" data-id="${c.id}" data-m="${i + 1}" aria-pressed="${!months.length || months.includes(i + 1)}">${m}</button>`).join('')}</div>
      ${sec('How-to', 'One step per line')}
      <textarea class="ta" data-field="howto" data-id="${c.id}" rows="4" placeholder="Steps for anything unusual">${esc(c.howto || '')}</textarea>
      ${sec('Notes')}
      <textarea class="ta" data-field="notes" data-id="${c.id}" rows="2" placeholder="Optional">${esc(c.notes || '')}</textarea>
      <div class="list frm" style="margin-top:12px">
        <label class="frow">Group<input class="txt" data-field="category" data-id="${c.id}" value="${esc(c.category || '')}" placeholder="Optional" maxlength="40"></label>
        <button class="frow swr" role="switch" aria-checked="${c.active}" data-act="cactive" data-id="${c.id}">Switched on<span class="tg" aria-hidden="true"></span></button>
      </div>
      ${hist ? `${sec('History')}<div class="hist">${hist}</div>` : ''}
      <button class="ghost press" data-act="cdel" data-id="${c.id}" style="margin-top:14px">Delete chore</button>
    </div>`;
}

function taskSheet(t) {
  if (!t || t.deleted_at) return '';
  const lists = taskLists();
  return `<h2><input class="ttl" data-field="title" data-id="${t.id}" value="${esc(t.title)}" maxlength="120" aria-label="Task" enterkeyhint="done"><button class="lnk" data-act="close">Done</button></h2>
    <div class="list frm">
      <label class="frow">List<select class="sel" data-field="category" data-id="${t.id}">${lists.map((l) => `<option${l === (t.category || 'House') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="frow">Due<input type="date" class="dt" data-field="due_date" data-id="${t.id}" value="${t.due_date || ''}"></label>
      <button class="frow swr" role="switch" aria-checked="${!!t.priority}" data-act="tflag" data-id="${t.id}">Priority<span class="tg" aria-hidden="true"></span></button>
    </div>
    ${sec('Notes')}
    <textarea class="ta" data-field="notes" data-id="${t.id}" rows="3" placeholder="Optional">${esc(t.notes || '')}</textarea>
    <button class="ghost press" data-act="tdel" data-id="${t.id}" style="margin-top:14px">Delete task</button>`;
}

/* --- today, calendar, kids, event shifts --- */
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const FN_URL = `${(window.HOMEOS_CONFIG?.supabaseUrl || '').replace(/\/+$/, '')}/functions/v1/calendar-sync`;
const daySet = () => ({ nap_start: '13:00', nap_end: '16:00', nap_minutes: 120, dinner: '18:00', bed: '20:00', post_call_hours: 10, union_start: '09:00', union_end: '17:00', ...(state.rows.day_settings[0] || {}) });
const nowHM = () => hhmmOf(T.now().toISOString()); // preview clock aware
const hm = (t) => String(t || '').slice(0, 5);
function clock(t, withAp = true) { // '13:30' -> '1:30 PM'
  const [h, m] = hm(t).split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12 || 12;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''}${withAp ? ` ${ap}` : ''}`;
}
function span(a, b) { // '13:00','15:00' -> '1–3 PM'
  const pa = +hm(a).slice(0, 2) >= 12, pb = +hm(b).slice(0, 2) >= 12;
  return pa === pb ? `${clock(a, false)}–${clock(b)}` : `${clock(a)} – ${clock(b)}`;
}
const addMin = (t, n) => { const [h, m] = hm(t).split(':').map(Number); const x = (h * 60 + m + n + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
const timeOf = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(':00', '');
const hhmmOf = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const calRows = () => state.rows.calendar_events;
const activations = () => state.rows.day_overrides.filter((o) => o.activated_from).map((o) => ({ ...o, date: o.date }));
function calSync() {
  const rows = state.rows.calendar_sync;
  if (!rows.length) return { setup: false, ok: false };
  const err = rows.find((r) => r.last_error);
  const lastOk = rows.map((r) => r.last_ok_at).filter(Boolean).sort().pop() || null;
  const stale = !lastOk || Date.now() - Date.parse(lastOk) > 2 * 3600000;
  return { setup: true, ok: !err && !stale, err, stale, lastOk, rows };
}
// A union day: a non-clinical day at the union EMS office during office hours. Marked by hand, shared.
const unionOn = (date) => !!findRow('day_overrides', date)?.union_day;
const baseStatus = (date) => D.dayStatus(date, calRows(), activations(), { tz: TZ, postCallHours: daySet().post_call_hours, syncOk: calSync().ok });
const hourOf = (t) => { const [h, m] = hm(t).split(':').map(Number); return h + (m || 0) / 60; };
// Union days: weekdays with no shift, or only a short evening shift (a 5 PM–2 AM). Not overnight days
// (a 7p–7a, a 9p–6a) and not post call, when there's sleep to catch up on.
function canUnion(date) {
  const wd = S.weekdayOf(date);
  if (wd === 0 || wd === 6) return false;
  const st = baseStatus(date);
  if (['unknown', 'post_call', 'activated'].includes(st.type) || st.postCall) return false;
  const ue = hourOf(daySet().union_end);
  const ok = (r) => {
    if (r.all_day || D.localDateOf(Date.parse(r.starts_at), TZ) !== date) return true;
    const start = D.localHourOf(Date.parse(r.starts_at), TZ);
    const nextDay = D.localDateOf(Date.parse(r.ends_at), TZ) > date, end = D.localHourOf(Date.parse(r.ends_at), TZ);
    return start >= ue && (!nextDay || end <= 3); // starts after the office closes, done by 3 AM
  };
  return calRows().filter((r) => r.kind === 'shift' && r.shift_type === 'working').every(ok);
}
const unionHours = () => `${clock(daySet().union_start)} – ${clock(daySet().union_end)}`;
function statusOf(date) {
  const st = baseStatus(date);
  if (!unionOn(date) || !canUnion(date)) return st;
  if (st.type === 'working' || st.type === 'activated') return { ...st, union: true }; // union by day, shift at night
  return { ...st, type: 'union', label: 'Union day', was: st.type, hours: span(daySet().union_start, daySet().union_end), hoursLong: unionHours() };
}
// Whose calendar this is. Their phone shows everything; the other phone gets a slim version.
const calOwner = () => daySet().calendar_owner || null;
const mine = () => !calOwner() || calOwner() === myId();
const ownerName = () => (calOwner() ? userName(calOwner()) : 'Partner');
const CHIP = { union: 'union', working: 'work', activated: 'work', on_call: 'call', post_call: 'sleep', no_shift: 'none', not_posted: 'np', unknown: 'np' };
function chipText(st) {
  if (st.type === 'working') return `Working ${st.hours}`;
  if (st.type === 'activated') return `Activated ${st.hours}`;
  if (st.type === 'post_call') return `Post call ${st.hours}`;
  if (st.type === 'union') return `Union ${st.hours}`;
  return st.label;
}
function chipTextU(st) { return st.union ? `${chipText(st)} + union` : chipText(st);
}
const eventsOn = (date) => calRows().filter((r) => r.kind !== 'shift' && (r.all_day ? r.start_date <= date && date <= r.end_date : r.start_date === date));
const kidsAll = () => live('kid_items');
// Appointments and the calendar owner's work. An appointment that overlaps a shift, an event shift, or an activation
// is "at work": the other parent takes it unless someone picks otherwise.
const APPT_MS = 3600000;
function atWork(k) {
  if (!calOwner() || !k.starts_at) return false;
  const a = Date.parse(k.starts_at), b = a + APPT_MS;
  const hit = (from, to) => from && Date.parse(from) < b && (to ? Date.parse(to) : Date.parse(from) + 12 * 3600000) > a;
  return calRows().some((r) => !r.all_day && ((r.kind === 'shift' && r.shift_type === 'working') || r.kind === 'event_shift') && hit(r.starts_at, r.ends_at))
    || activations().some((x) => hit(x.activated_from, x.activated_to));
}
const otherParent = () => state.members.find((id) => id !== calOwner()) || null;
const takerOf = (k) => k.taker || (atWork(k) ? otherParent() : null); // a user id, 'both', or null (not decided)
function takerLine(k) {
  const t = takerOf(k);
  if (!t) return '';
  if (t === 'both') return 'Both going';
  return t === myId() ? 'You’re taking it' : `${userName(t)}’s taking it`;
}
// On the owner's phone, an appointment they can't make drops to a quiet line instead of their timeline.
const quietForMe = (k) => !!calOwner() && calOwner() === myId() && atWork(k) && takerOf(k) !== myId() && takerOf(k) !== 'both';
// Weekly routines: preschool, a study group. Shared; each says who it's for.
const routinesOn = (date) => live('routines').filter((r) => R.occursOn(r, date)).sort((a, b) => hm(a.start_time).localeCompare(hm(b.start_time)));
function routineWho(r) {
  if (!r.who || r.who === 'kids') return 'Kids';
  if (r.who === 'family') return 'Family';
  return r.who === myId() ? 'You' : userName(r.who);
}
const apptsOn = (date) => kidsAll().filter((k) => k.kind === 'appointment' && k.starts_at && D.localDateOf(Date.parse(k.starts_at), TZ) === date);

// Ask the server to re-read the calendars (at most every few minutes from this phone), then refresh.
let lastKick = 0;
async function kickCalendar(force = false) {
  if (PREVIEW || !api.getSession() || !api.configured || !navigator.onLine) return;
  if (!force && Date.now() - lastKick < 5 * 60000) return;
  lastKick = Date.now();
  try {
    const r = await fetch(`${FN_URL}${force ? '?force=1' : ''}`, { method: 'POST', headers: { apikey: window.HOMEOS_CONFIG.supabaseKey, 'Content-Type': 'application/json' }, body: '{}' });
    if (r.ok) setTimeout(pull, 300);
  } catch {}
}

function timeline(date) {
  const ds = daySet(), ov = findRow('day_overrides', date) || {};
  const napSet = !!ov.nap_start;
  const nap = napSet ? [ov.nap_start, ov.nap_end] : [ds.nap_start, ds.nap_end];
  const items = [];
  for (const e of eventsOn(date)) {
    if (e.all_day) continue;
    const mins = Math.round((Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60000);
    const dur = mins >= 60 ? `${+(mins / 60).toFixed(1)} hr${mins === 60 ? '' : 's'}` : `${mins} min`;
    items.push({ k: hhmmOf(e.starts_at), t: timeOf(e.starts_at), w: e.kind === 'meeting' ? 'Work meeting' : e.title || 'Busy', sub: e.kind === 'event_shift' ? `${D.hoursLabel(e.starts_at, e.ends_at, TZ, true)}` : dur, tag: e.kind === 'event_shift' ? 'Event shift' : '', cls: 'ev' });
  }
  if (unionOn(date) && canUnion(date)) items.push({ k: hm(daySet().union_start), t: span(daySet().union_start, daySet().union_end), w: 'Union office', sub: 'Union EMS', cls: 'ev' });
  for (const r of routinesOn(date)) items.push({ k: hm(r.start_time), t: span(r.start_time, r.end_time), w: r.title, sub: routineWho(r), cls: 'ev' });
  for (const a of apptsOn(date)) if (!quietForMe(a)) items.push({ k: hhmmOf(a.starts_at), t: timeOf(a.starts_at), w: a.title, sub: ['Kids', takerLine(a)].filter(Boolean).join(' · '), tag: !mine() && atWork(a) ? `${ownerName()}’s working` : '', cls: 'ev', go: '#/kids' });
  items.push(napSet
    ? { k: hm(nap[0]), t: span(nap[0], nap[1]), w: 'Nap', sub: '', nap: true }
    : { k: hm(nap[0]), t: span(nap[0], nap[1]), w: 'Nap', sub: `About ${napLen(ds.nap_minutes)}`, nap: true, window: true });
  const withHow = (m) => { const t = mealTitle(m), r = m && m.recipe_id ? findRow('recipes', m.recipe_id) : null, k = r && M.methodLabel(r.method); return t && k ? `${t} · ${k}` : t; };
  const din = withHow(mealOf(M.slotOf(date))), lun = lunchOn() ? withHow(mealOf(M.slotOf(date, 'lunch'))) : '';
  if (lun) items.push({ k: '12:00', t: clock('12:00'), w: 'Lunch', sub: lun });
  items.push({ k: hm(ds.dinner), t: clock(ds.dinner), w: 'Dinner', sub: din });
  items.push({ k: hm(ds.bed), t: clock(ds.bed), w: 'Bed' });
  items.sort((a, b) => a.k.localeCompare(b.k));
  const allDay = eventsOn(date).filter((e) => e.all_day);
  return { items, allDay, napSet, nap };
}

function tlHtml(date, withNapBtn) {
  const { items, allDay, napSet, nap } = timeline(date);
  const now = nowHM();
  const row = (x) => {
    let btn = '';
    if (x.nap && withNapBtn) {
      const asleep = napSet && now >= hm(nap[0]) && now < hm(nap[1]);
      btn = napSet
        ? `<button class="mini press" data-act="${asleep ? 'napup' : 'napedit'}" data-date="${date}">${asleep ? 'Up' : 'Change'}</button>`
        : `<button class="mini press go" data-act="napnow" data-date="${date}">Down now</button><button class="mini press" data-act="napedit" data-date="${date}" aria-label="Pick a nap time">${ic('chev')}</button>`;
    }
    const cur = withNapBtn && x.nap && napSet && now >= hm(nap[0]) && now < hm(nap[1]);
    return `<div class="r ${x.cls || ''}${cur ? ' now' : ''}"><span class="t">${esc(x.t)}</span><span class="w">${esc(x.w)}${x.tag ? `<span class="tag2">${esc(x.tag)}</span>` : ''}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${btn}</div>`;
  };
  return `${allDay.length ? `<div class="alld">${allDay.map((e) => `<span>${esc(e.title || 'Busy')}</span>`).join('')}</div>` : ''}<div class="tl rise d1">${items.map(row).join('')}</div>`;
}

function shiftHero(today, readOnly = false) {
  const cs = calSync();
  if (!cs.setup) return `<a class="card press rise" href="#/settings"><div class="ic">${ic('cal')}</div><div><b>Calendar</b><small>Not connected yet. Your shifts will show here.</small></div></a>`;
  const st = statusOf(today), tom = statusOf(S.addDays(today, 1));
  const asOf = !cs.ok && cs.lastOk ? ` · as of ${timeOf(cs.lastOk)}` : '';
  const pc = st.postCall && st.type !== 'post_call' ? `<p class="pcl">Post call until ${timeOf(st.postCall.until)}</p>` : '';
  const actBtn = st.type === 'on_call' || st.was === 'on_call' ? `<button class="actb press" data-act="actopen" data-date="${today}">I got activated</button>`
    : st.type === 'activated' ? `<button class="actb press" data-act="actopen" data-date="${today}">Edit activation</button>` : '';
  const unionBtn = unionOn(today) && canUnion(today) ? `<button class="actb press" data-act="union" data-date="${today}">Not a union day</button>`
    : canUnion(today) ? `<button class="actb press" data-act="union" data-date="${today}">Union day</button>` : '';
  const act = readOnly ? '' : [actBtn, unionBtn].filter(Boolean).join('');
  const sub = st.type === 'union' ? `Union EMS office${st.was === 'on_call' ? ' · on call too' : st.was === 'post_call' ? ' · post call this morning' : ''}` : st.type === 'working' ? esc(st.site || '') : st.type === 'on_call' ? 'Not working unless called in' : st.type === 'post_call' ? 'Rest after the overnight' : st.type === 'not_posted' ? 'Nothing posted for today yet' : st.type === 'unknown' ? 'Can’t tell until the calendar updates' : '';
  return `<div class="stack rise" style="margin:0 0 26px"><a class="hero shift press${st.type === 'unknown' ? ' unknown' : ''}" href="#/calendar">
    <p class="eyebrow">${readOnly ? `${esc(ownerName())}’s day` : 'Your day'}${asOf}</p>
    <div class="row2"><h2>${esc(st.label)}</h2><span class="big">${esc(st.hoursLong || (st.type === 'post_call' ? st.hours : '') || '')}</span></div>
    ${sub ? `<p>${sub}</p>` : ''}${!readOnly && apptsOn(today).some(quietForMe) ? `<p class="pcl">While you’re at work: ${apptsOn(today).filter(quietForMe).map((a) => `${esc(a.title)} ${timeOf(a.starts_at)}`).join(', ')}</p>` : ''}${st.union ? `<p class="pcl">Union office ${unionHours()}</p>` : ''}${pc}
    <div class="tom"><span>Tomorrow</span><b>${esc(chipTextU(tom))}</b></div>
  </a>${act ? `<div class="actrow${actBtn && unionBtn ? ' two2' : ''}">${act}</div>` : ''}</div>`;
}

function syncWarn() {
  const cs = calSync();
  if (!cs.setup || cs.ok) return '';
  const bad = cs.rows.filter((r) => r.last_error).map((r) => (r.source === 'google' ? 'Google' : 'Outlook'));
  const ago = cs.lastOk ? `Last updated ${S.dueLabel(D.localDateOf(Date.parse(cs.lastOk), TZ), todayStr()).toLowerCase() === 'today' ? `at ${timeOf(cs.lastOk)}` : `on ${new Date(cs.lastOk).toLocaleDateString()}`}.` : 'It hasn’t updated yet.';
  return `<button class="warn press" data-act="calforce">${ic('warn')}<span><b>${bad.length ? `${bad.join(' and ')} calendar couldn’t update` : 'Calendar is out of date'}</b>${ago} Shifts may be out of date. Tap to try again.</span></button>`;
}

function calFooter() {
  const cs = calSync();
  if (!cs.setup) return '';
  const mark = (src) => { const r = cs.rows.find((x) => x.source === src); return r ? `${src === 'google' ? 'Google' : 'Outlook'} ${r.last_error ? '✕' : '✓'}` : ''; };
  return `<p class="upd">${cs.lastOk ? `Calendar updated ${timeOf(cs.lastOk)}` : 'Calendar not updated yet'} · ${[mark('google'), mark('outlook')].filter(Boolean).join(' · ')}</p>`;
}

function todayCards(today) {
  const cards = [];
  const kidsLow = kidsAll().filter((k) => k.kind === 'supply' && (k.status === 'low' || k.status === 'out')).length;
  const nextAppt = kidsAll().filter((k) => k.kind === 'appointment' && k.starts_at && Date.parse(k.starts_at) > Date.now()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const kidLine = [nextAppt && `${nextAppt.title} ${S.dueLabel(D.localDateOf(Date.parse(nextAppt.starts_at), TZ), today).toLowerCase()}`, kidsLow && `${kidsLow} supplies low`].filter(Boolean).join(' · ');
  cards.push(`<a class="card press rise d1" href="#/kids"><div class="ic">${ic('kid')}</div><div><b>Kids</b><small>${esc(kidLine || 'Appointments and supplies')}</small></div></a>`);
  const toGet = groceryOpen().length; if (toGet) cards.push(`<a class="card press rise d2" href="#/grocery"><div class="ic">${ic('cart')}</div><div><b>Grocery</b><small>${plural(toGet, 'thing')} to get</small></div></a>`);
  const out = pantry().filter((x) => x.status === 'out').length, low = pantry().filter((x) => x.status === 'low').length;
  const kl = [out && `${out} out`, low && `${low} low`].filter(Boolean).join(', ');
  if (kl) cards.push(`<a class="card press rise d2" href="#/kitchen"><div class="ic">${ic('box')}</div><div><b>Kitchen</b><small>${kl}</small></div></a>`);
  const nextShift = eventShifts().filter((e) => e.start_date >= today).pop();
  if (nextShift && mine()) cards.push(`<a class="card press rise d2" href="#/events"><div class="ic">${ic('cal')}</div><div><b>Event shifts</b><small>Next: ${esc(nextShift.title)} ${S.dueLabel(nextShift.start_date, today).toLowerCase()}</small></div></a>`);
  return cards.join('');
}

/* ---------- cheers: a little encouragement when things get done ---------- */
const notesForMe = () => live('cheers').filter((n) => n.to_user === myId()).map((n) => ({ id: n.id, text: n.text, from: userName(n.created_by) }));
const myNotes = () => live('cheers').filter((n) => n.created_by === myId()).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
let cheerTimer = 0;
function cheer(kind, force = false, text = null) {
  if (!force && !C.shouldCheer(kind, Math.random())) return;
  const pn = partnerId() ? userName(partnerId()) : '';
  const c = text ? { text, from: null, noteId: null } : C.pickCheer(kind, { partner: pn === 'Partner' ? '' : pn, notes: notesForMe(), seen: ls.get(K.seen, []) });
  if (c.noteId) ls.set(K.seen, [...new Set([...ls.get(K.seen, []), c.noteId])].slice(-200));
  document.querySelector('.cheer')?.remove();
  const el = document.createElement('div');
  el.className = `cheer${kind === 'allDone' ? ' big' : ''}`;
  el.setAttribute('role', 'status');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bits = kind === 'allDone' && !still ? `<div class="confetti" aria-hidden="true">${Array.from({ length: 22 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 5) * 0.08}s;--r:${(i * 53) % 360}deg"></i>`).join('')}</div>` : '';
  el.innerHTML = `${bits}<p>${esc(c.text)}</p>${c.from ? `<small>from ${esc(c.from)} ♥</small>` : ''}`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  clearTimeout(cheerTimer);
  cheerTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, kind === 'allDone' || c.from ? 6000 : 3800);
}
// After checking something off: everything for today done is the big one; otherwise a small cheer.
function cheerAfterDone(kind) {
  const { mine, myTasks } = todoToday(todayStr());
  if (!mine.length && !myTasks.length) cheer('allDone', true); else cheer(kind);
}

// To do today: chores and tasks due today or late, for me (and Either), with checkboxes right here.
function todoToday(td) {
  const mineOrEither = (c) => !c.assignee || c.assignee === myId();
  const chores = choresAll().filter((c) => c.active && c.due_date && S.shownDue(c, td) <= td);
  const tasks = tasksAll().filter((t) => !t.done_at && t.active !== false && ((t.due_date && t.due_date <= td) || (!t.due_date && t.priority)));
  const mine = chores.filter(mineOrEither).sort((a, b) => S.shownDue(a, td).localeCompare(S.shownDue(b, td)) || a.title.localeCompare(b.title));
  const theirs = chores.filter((c) => !mineOrEither(c)).length;
  const myTasks = tasks.filter((t) => !t.assignee || t.assignee === myId()).sort((a, b) => (b.priority - a.priority) || String(a.due_date || '9').localeCompare(String(b.due_date || '9')));
  const doneToday = live('task_events').filter((e) => e.kind === 'done' && !e.undone_at && e.by_user === myId() && D.localDateOf(Date.parse(e.at), TZ) === td).length;
  return { mine, myTasks, theirs, doneToday };
}
function taskRowToday(t, td) {
  return `<div class="it"><button class="cb press" data-act="tdone" data-id="${t.id}" role="checkbox" aria-checked="false" aria-label="Done: ${esc(t.title)}"></button>
    <button class="nm" data-act="titem" data-id="${t.id}">${esc(t.title)}<span class="meta">${t.due_date ? (S.isOverdue(t, td) ? `<b>${S.dueLabel(t.due_date, td)}</b>` : 'Due today') : 'Flagged'} · Task</span></button>
    <button class="flag press${t.priority ? ' on' : ''}" data-act="tflag" data-id="${t.id}" aria-pressed="${!!t.priority}" aria-label="Priority">${ic('flag')}</button></div>`;
}
function todoHtml(td) {
  const { mine, myTasks, theirs, doneToday } = todoToday(td);
  const n = mine.length + myTasks.length;
  const pn = partnerId() ? userName(partnerId()) : 'your partner';
  const foot = [doneToday && `${plural(doneToday, 'thing')} done today`, theirs && `${theirs} more for ${pn}`].filter(Boolean).join(' · ');
  if (!n) return `${sec('To do today')}${doneToday ? `<div class="card alldone rise d1"><div class="ic">${ic('star')}</div><div><b>All done for today</b><small>${plural(doneToday, 'thing')} checked off. Go put your feet up.</small></div></div>` : `<div class="list todo rise d1"><p class="empty" style="margin:16px 4px">Nothing due today.</p></div>`}${theirs ? `<p class="upd">${theirs} more for ${esc(pn)}</p>` : ''}`;
  return `${sec('To do today', n)}<div class="list todo rise d1">${mine.map((c) => choreRow(c, td)).join('')}${myTasks.map((t) => taskRowToday(t, td)).join('')}</div>${foot ? `<p class="upd">${esc(foot)}</p>` : ''}`;
}

// After 7 PM: tomorrow at a glance, so the next day gets planned the night before.
function tomorrowHtml(td) {
  if (nowHM() < '19:00') return '';
  const tm = S.addDays(td, 1), st = statusOf(tm);
  const din = mealOf(M.slotOf(tm)), r = din && din.recipe_id ? findRow('recipes', din.recipe_id) : null;
  const shift = calSync().setup ? `${mine() ? 'You' : esc(ownerName())}: ${esc(chipTextU(st))}` : '';
  const dinner = din ? `Dinner: ${esc(mealTitle(din))}${r && r.method ? ` · ${esc(M.methodLabel(r.method))}` : ''}` : 'No dinner planned yet';
  return `${sec('Tomorrow', shortDay(tm, { weekday: 'long' }))}<a class="card press rise d1" href="#/calendar"><div class="ic">${ic('cal')}</div><div><b>${shift || shortDay(tm, { weekday: 'long', month: 'short', day: 'numeric' })}</b><small>${dinner}</small></div></a>${tlHtml(tm, false)}`;
}

// Time-sensitive nudges, gathered into one slim list instead of a stack of big cards.
// Tonight (after 7:30 PM) or last night's dinner, until someone rates it.
function rateRow(td) {
  const d = nowHM() >= '19:30' ? td : S.addDays(td, -1);
  const m = mealOf(M.slotOf(d));
  if (!m || m.rating) return '';
  const b = (v, l) => `<button class="mini press" data-act="rate" data-slot="${m.slot}" data-v="${v}">${l}</button>`;
  return `<div class="card rate"><div class="ic">${ic('star')}</div><div><b>How was ${esc(mealTitle(m))}?</b><small>${d === td ? 'Tonight' : 'Last night'}. It helps plan meals you’ll actually eat.</small><div class="rbtns">${b('loved', 'Loved it')}${b('fine', 'Fine')}${b('never', 'Never again')}</div></div></div>`;
}
// Leftovers: food-safety guidance is 3 to 4 days in the fridge.
const ageDays = (p) => (p.made_on ? S.diffDays(todayStr(), p.made_on) : null);
function ageLabel(p) {
  const n = ageDays(p);
  if (n == null) return '';
  const base = n <= 0 ? 'Made today' : n === 1 ? '1 day old' : `${n} days old`;
  return n >= 5 ? `${base} · toss it` : n >= 3 ? `${base} · eat soon` : base;
}
function leftoverRows() {
  return pantry().filter((p) => p.made_on && ageDays(p) >= 3).sort((a, b) => a.made_on.localeCompare(b.made_on)).map((p) =>
    `<div class="card"><div class="ic">${ic('box')}</div><div><b>${esc(p.name)}</b><small>${esc(ageLabel(p))}.</small></div><button class="mini press go" data-act="lodone" data-id="${p.id}" data-v="ate">Ate it</button><button class="mini press" data-act="lodone" data-id="${p.id}" data-v="tossed">Tossed</button></div>`).join('');
}
// Sunday (and Monday morning): what the two of you got done this week.
function weekCounts(td) {
  const from = S.addDays(td, -6);
  const inWeek = (iso) => { const d = D.localDateOf(Date.parse(iso), TZ); return d >= from && d <= td; };
  const done = live('task_events').filter((e) => e.kind === 'done' && !e.undone_at && inWeek(e.at));
  const kindOf = (e) => findRow('tasks', e.task_id)?.kind;
  const chores = done.filter((e) => kindOf(e) !== 'task').length, tasks = done.filter((e) => kindOf(e) === 'task').length;
  const dinners = live('meal_plan').filter((m) => m.meal === 'dinner' && (m.recipe_id || m.text) && m.date >= from && m.date <= td).length;
  return { chores, tasks, dinners, total: chores + tasks + dinners };
}
function recapRow(td) {
  const wd = S.weekdayOf(td);
  if (!(wd === 0 || (wd === 1 && nowHM() < '12:00'))) return '';
  const end = wd === 0 ? td : S.addDays(td, -1), c = weekCounts(end);
  if (!c.total) return '';
  const parts = [c.chores && plural(c.chores, 'chore'), c.tasks && plural(c.tasks, 'task'), c.dinners && plural(c.dinners, 'dinner')].filter(Boolean).join(' · ');
  return `<button class="card press cardbtn" data-act="recap" data-n="${c.total}"><div class="ic">${ic('star')}</div><div><b>This week together: ${plural(c.total, 'thing')}</b><small>${parts}. Teamwork.</small></div>${ic('chev')}</button>`;
}
// A monthly nudge to save a copy of everything.
function backupRow() {
  const last = ls.get(K.backup, null);
  if (last && Date.now() - Date.parse(last) < 30 * 86400000) return '';
  if (!live('recipes').length && !choresAll().length) return '';
  return `<div class="card"><div class="ic">${ic('box')}</div><div><b>Save a backup</b><small>${last ? `Last one ${new Date(last).toLocaleDateString()}` : 'No backup yet'}. One file with your recipes, chores, and lists.</small></div><button class="mini press go" data-act="backup">Back up</button></div>`;
}

function headsUp(td) {
  // Most urgent first; only three show until you ask for the rest (fewer choices, less noise).
  const rows = [thawCard(td), rateRow(td), leftoverRows(), shopCard(), planNextCard(td), recapRow(td), resetCard(), backupRow()].filter(Boolean)
    .flatMap((h) => h.split(/(?=<(?:div|a|button) class="card)/).filter((x) => x.trim()));
  if (!rows.length) return '';
  const shown = ui.allHeads ? rows : rows.slice(0, 3), more = rows.length - shown.length;
  return `${sec('Heads up', rows.length)}<div class="list heads rise d1">${shown.join('')}</div>${more ? `<button class="clear press moreh" data-act="moreheads">Show ${more} more</button>` : ui.allHeads && rows.length > 3 ? `<button class="clear press moreh" data-act="moreheads">Show less</button>` : ''}`;
}

function homeView() {
  const td = todayStr();
  const name = myName();
  const s = steps();
  const next = s.find((x) => !x.done);
  const doneCount = s.filter((x) => x.done).length;
  const setup = next ? `<div class="stack rise">
      <${next.go ? `a href="${next.go}"` : 'section'} class="hero${next.go ? ' press' : ''}">
        <p class="eyebrow">Next up</p>
        <h2>${esc(next.title)}${next.go ? ic('chev', 'i hchev') : ''}</h2>
        <p>${esc(next.body)}</p>
        <div class="prog" role="img" aria-label="${doneCount} of ${s.length} setup steps done"><div class="trk"><b style="width:${(doneCount / s.length) * 100}%"></b></div><span>${doneCount} of ${s.length}</span></div>
        ${next.later ? `<button class="later press" data-act="later">Later</button>` : ''}
      </${next.go ? 'a' : 'section'}></div>` : '';
  return `${header(today(), name ? `${greeting()},<br>${esc(name)}` : greeting())}
  <main>
    ${syncWarn()}
    ${setup}
    ${shiftHero(td, !mine())}
    ${todoHtml(td)}
    ${tomorrowHtml(td)}
    ${headsUp(td)}
    ${sec('Today')}${tlHtml(td, true)}
    <div class="tiles2 rise d2">${todayCards(td)}</div>
    <a class="more press" href="#/calendar">${ic('cal')}Week and month</a>
    ${calFooter()}
  </main>
  ${dock('home')}`;
}

function calendarView() {
  const today = todayStr();
  const days = ui.calTab === 'month' ? 35 : 7;
  const seg = `<div class="seg seg3 rise"><a class="${''}" href="#/home">Today</a><button class="${ui.calTab !== 'month' ? 'on' : ''}" data-act="caltab" data-v="week">Week</button><button class="${ui.calTab === 'month' ? 'on' : ''}" data-act="caltab" data-v="month">Month</button></div>`;
  const cards = [];
  for (let i = 0; i < days; i++) {
    const d = S.addDays(today, i), st = statusOf(d);
    const dt = new Date(S.parse(d));
    const dn = dt.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }), dd = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const evs = [...eventsOn(d).map((e) => ({ k: e.all_day ? '00:00' : hhmmOf(e.starts_at), t: e.all_day ? 'All day' : timeOf(e.starts_at), w: e.kind === 'meeting' ? 'Work meeting' : e.title || 'Busy', es: e.kind === 'event_shift' })),
      ...routinesOn(d).map((r) => ({ k: hm(r.start_time), t: clock(r.start_time), w: `${r.title} (${routineWho(r)})` })),
      ...apptsOn(d).map((a) => ({ k: hhmmOf(a.starts_at), t: timeOf(a.starts_at), w: a.title, quiet: quietForMe(a), tag: quietForMe(a) ? 'At work' : !mine() && atWork(a) ? `${ownerName()}’s working` : '' }))].sort((a, b) => a.k.localeCompare(b.k));
    const pc = st.postCall && st.type !== 'post_call' ? `<span class="sc sleep">Post call until ${timeOf(st.postCall.until)}</span>` : '';
    const list = ui.calTab === 'month' ? (evs.length ? `<div class="el">${evs.slice(0, 2).map((e) => `<b>${esc(e.t)}</b>${esc(e.w)}`).join('<br>')}${evs.length > 2 ? `<br>+${evs.length - 2} more` : ''}</div>` : '')
      : (evs.length ? `<div class="el">${evs.map((e) => `<span class="${e.quiet ? 'qt' : ''}"><b>${esc(e.t)}</b>${esc(e.w)}${e.es ? '<span class="tag2">Event shift</span>' : ''}${e.tag ? `<span class="tag2">${esc(e.tag)}</span>` : ''}</span>`).join('<br>')}</div>` : '');
    cards.push(`<div class="day${d === today ? ' today' : ''}"><div class="dh"><span class="dn">${dn}<small>${dd}</small></span><span class="chips2"><span class="sc ${CHIP[st.type]}">${esc(chipText(st))}</span>${pc}${st.union ? `<span class="sc union">Union ${esc(span(daySet().union_start, daySet().union_end))}</span>` : ''}${!mine() || ui.calTab === 'month' || !canUnion(d) ? '' : unionOn(d) ? `<button class="sc uadd press" data-act="union" data-date="${d}" aria-label="Not a union day">${ic('x')}</button>` : `<button class="sc uadd press" data-act="union" data-date="${d}">+ Union</button>`}</span></div>${st.type === 'working' && st.site ? `<div class="el site">${esc(st.site)}</div>` : ''}${list}</div>`);
  }
  const end = new Date(S.parse(S.addDays(today, days - 1))).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const start = new Date(S.parse(today)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${header(`${start} – ${end}`, ui.calTab === 'month' ? 'Next 5 weeks' : 'This week')}
  <main>${syncWarn()}${seg}${cards.join('')}${calFooter()}</main>
  ${dock('home')}`;
}

const napLen = (m) => { m = +m || 120; const h = m / 60; return Number.isInteger(h) ? `${h} hour${h === 1 ? '' : 's'}` : `${Math.floor(h)}½ hours`; };
function napSheet(date) {
  const ds = daySet(), ov = findRow('day_overrides', date) || {};
  const picks = [];
  for (let t = hm(ds.nap_start); t < hm(ds.nap_end) && picks.length < 8; t = addMin(t, 30)) picks.push(t);
  return `<h2>Toddler nap<button class="lnk" data-act="close">Done</button></h2>
    <p class="hint" style="margin-top:0">Usually ${span(ds.nap_start, ds.nap_end)}, about ${napLen(ds.nap_minutes)}. Shared with both phones.</p>
    <p class="gt">Went down at</p>
    <div class="picks2">${picks.map((t) => `<button class="pick press${ov.nap_start && hm(ov.nap_start) === t ? ' on' : ''}" data-act="napset" data-date="${date}" data-t="${t}">${clock(t)}</button>`).join('')}</div>
    <div class="list frm" style="margin-top:10px">
      <label class="frow">Down<input type="time" class="dt sm" data-nap="nap_start" data-date="${date}" value="${hm(ov.nap_start) || ''}"></label>
      <label class="frow">Up<input type="time" class="dt sm" data-nap="nap_end" data-date="${date}" value="${hm(ov.nap_end) || ''}"></label>
    </div>
    ${ov.nap_start ? `<button class="ghost press" data-act="napclear" data-date="${date}" style="margin-top:12px">No nap today / clear</button>` : ''}`;
}

/* kids */
function kidsView() {
  const appts = kidsAll().filter((k) => k.kind === 'appointment').sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  const upcoming = appts.filter((a) => !a.starts_at || Date.parse(a.starts_at) > Date.now() - 2 * 3600000);
  const supplies = kidsAll().filter((k) => k.kind === 'supply').sort((a, b) => a.title.localeCompare(b.title));
  const today = todayStr();
  const apptRow = (a) => `<div class="it appt${quietForMe(a) ? ' qt' : ''}"><button class="nm" data-act="kitem" data-id="${a.id}">${esc(a.title)}<span class="when">${a.starts_at ? `${S.dueLabel(D.localDateOf(Date.parse(a.starts_at), TZ), today)} · ${timeOf(a.starts_at)}` : 'No time set'}${takerLine(a) ? ` · ${esc(takerLine(a))}` : ''}${quietForMe(a) ? ' · you’re at work' : ''}</span>${a.location ? `<span class="when">${esc(a.location)}</span>` : ''}</button>${a.starts_at && !quietForMe(a) ? addBtn(a) : ''}</div>`;
  const hloK = (k) => { const b = (s2, label) => `<button class="${k.status === s2 ? s2[0] : ''}" data-act="kstat" data-id="${k.id}" data-s="${s2}" aria-pressed="${k.status === s2}">${label}</button>`; return `<span class="hlo">${b('have', 'Have')}${b('low', 'Low')}${b('out', 'Out')}</span>`; };
  const supRow = (k) => {
    const sub = k.status === 'out' || k.status === 'low' ? (onGrocery(k.title) ? `<span class="onlist">${ic('check')}On grocery</span>` : `<span class="send press" data-act="ksend" data-id="${k.id}" role="button">${ic('plus')}Grocery</span>`) : '';
    return `<div class="it"><div class="nm"><button class="nmb" data-act="kitem" data-id="${k.id}">${esc(k.title)}</button>${sub}</div>${hloK(k)}</div>`;
  };
  const lowN = supplies.filter((k) => k.status !== 'have').length;
  return `${header('Both kids', 'Kids')}
  <main>
    <form class="qa slim rise" data-form="kappt" autocomplete="off" style="margin-top:0">
      <div class="row"><input class="fld" name="name" type="text" placeholder="Add an appointment" maxlength="120" enterkeyhint="next" aria-label="Appointment"><button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div>
      <div class="row when2"><input class="dt" name="when" type="datetime-local" aria-label="When"></div>
    </form>
    ${upcoming.length ? `${sec('Appointments', upcoming.length)}<div class="list">${upcoming.map(apptRow).join('')}</div>` : `<p class="empty">No appointments coming up.</p>`}
    ${sec('Every week', live('routines').length || '')}
    ${live('routines').length ? `<div class="list">${live('routines').sort((a, b) => a.title.localeCompare(b.title)).map((r) => { const br = R.breakOn(r, today), nb = R.nextBreak(r, today); return `<div class="it"><button class="nm" data-act="rtitem" data-id="${r.id}">${esc(r.title)}<span class="when">${esc(R.daysLabel(r.weekdays))} · ${esc(span(r.start_time, r.end_time))} · ${esc(routineWho(r))}</span>${br ? `<span class="when">On break until ${esc(shortDay(br.to, { month: 'short', day: 'numeric' }))}</span>` : nb ? `<span class="when">Next break ${esc(shortDay(nb.from, { month: 'short', day: 'numeric' }))}</span>` : ''}</button></div>`; }).join('')}</div>` : ''}
    <button class="more press" data-act="rtnew">${ic('plus')}Add something weekly (preschool, a class…)</button>
    ${sec('Supplies', lowN ? `${lowN} low or out` : '')}
    <form class="qa slim" data-form="ksup" autocomplete="off" style="margin:0 0 8px"><div class="row"><input class="fld" name="name" type="text" placeholder="Add a supply (diapers, wipes…)" maxlength="120" enterkeyhint="done" aria-label="Supply"><button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div></form>
    ${supplies.length ? `<div class="list">${supplies.map(supRow).join('')}</div>` : ''}
  </main>
  ${dock('home')}`;
}

function routineSheet(r) {
  if (!r || r.deleted_at) return '';
  const days = r.weekdays || [], who = !r.who ? 'kids' : r.who;
  const whoOpts = [['kids', 'Kids'], [myId(), myName() || 'Me'], ...(partnerId() ? [[partnerId(), userName(partnerId())]] : []), ['family', 'Family']];
  const today = todayStr();
  return `<h2><input class="ttl" data-rtf="title" data-id="${r.id}" value="${esc(r.title)}" maxlength="80" aria-label="Name" enterkeyhint="done"><button class="lnk" data-act="close">Done</button></h2>
    <div class="scroll">
      <div class="list frm">
        <div class="frow">For<span class="seg sm">${whoOpts.map(([v, l]) => `<button class="${who === v ? 'on' : ''}" data-act="rtwho" data-id="${r.id}" data-v="${v}">${esc(l)}</button>`).join('')}</span></div>
        <div class="frow">Time<span class="pair"><input type="time" class="dt sm" data-rtf="start_time" data-id="${r.id}" value="${hm(r.start_time)}" aria-label="Starts"><span class="evl">to</span><input type="time" class="dt sm" data-rtf="end_time" data-id="${r.id}" value="${hm(r.end_time)}" aria-label="Ends"></span></div>
      </div>
      ${sec('Days')}
      <div class="months days7">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<button class="press${days.includes(i) ? ' on' : ''}" data-act="rtday" data-id="${r.id}" data-d="${i}" aria-pressed="${days.includes(i)}">${d}</button>`).join('')}</div>
      ${sec('Breaks', 'Holidays, summer')}
      ${(r.breaks || []).length ? `<div class="list">${r.breaks.map((b, i) => `<div class="it"><span class="nm">${esc(b.label || 'Break')}<span class="when">${esc(shortDay(b.from, { month: 'short', day: 'numeric' }))} – ${esc(shortDay(b.to, { month: 'short', day: 'numeric', year: 'numeric' }))}${b.to < today ? ' · over' : ''}</span></span><button class="plus press" data-act="rtbrkdel" data-id="${r.id}" data-i="${i}" aria-label="Remove break">${ic('x')}</button></div>`).join('')}</div>` : '<p class="hint">No breaks yet. Add the dates it doesn’t happen, like winter break or summer.</p>'}
      <form class="brk" data-form="rtbrk" data-id="${r.id}" autocomplete="off">
        <input class="in" name="label" type="text" placeholder="Break name (Winter break)" maxlength="40">
        <div class="pair2"><label>From<input class="dt" name="from" type="date" required></label><label>To<input class="dt" name="to" type="date" required></label></div>
        <button class="ghost press" type="submit">${ic('plus')}Add break</button>
      </form>
      <button class="ghost press" data-act="rtdel" data-id="${r.id}" style="margin-top:14px">Delete</button>
    </div>`;
}

function kidSheet(k) {
  if (!k || k.deleted_at) return '';
  const local = k.starts_at ? `${D.localDateOf(Date.parse(k.starts_at), TZ)}T${hhmmOf(k.starts_at)}` : '';
  return `<h2><input class="ttl" data-kf="title" data-id="${k.id}" value="${esc(k.title)}" maxlength="120" aria-label="Name" enterkeyhint="done"><button class="lnk" data-act="close">Done</button></h2>
    <div class="list frm">${k.kind === 'appointment' ? `<label class="frow">When<input type="datetime-local" class="dt" data-kf="starts_at" data-id="${k.id}" value="${local}"></label>
      <label class="frow">Address<input class="txt" data-kf="location" data-id="${k.id}" value="${esc(k.location || '')}" placeholder="Optional" maxlength="200" autocomplete="street-address"></label>
      <div class="frow">Who’s taking it<span class="seg sm">${[...state.members.map((id) => [id, id === myId() ? (myName() || 'Me') : userName(id)]), ['both', 'Both']].map(([v, l]) => `<button class="${takerOf(k) === v ? 'on' : ''}" data-act="ktaker" data-id="${k.id}" data-v="${v}" aria-pressed="${takerOf(k) === v}">${esc(l)}</button>`).join('')}</span></div>` : ''}</div>
    ${k.kind === 'appointment' && k.location ? `<a class="src press" href="${mapsLink(k.location)}" target="_blank" rel="noopener">${ic('arr')}Directions in ${calApp() === 'apple' ? 'Apple' : 'Google'} Maps</a>` : ''}
    ${k.kind === 'appointment' && atWork(k) ? `<p class="hint">${calOwner() === myId() ? 'You’re working then' : `${esc(ownerName())}’s working then`}${k.taker ? '' : `, so ${esc(userName(otherParent()) || 'the other parent')} is set to take it`}.</p>` : ''}
    ${sec('Notes')}<textarea class="ta" data-kf="notes" data-id="${k.id}" rows="3" placeholder="Optional">${esc(k.notes || '')}</textarea>
    ${k.kind === 'appointment' && k.starts_at && !quietForMe(k) ? `<div class="acts2" style="margin-top:12px">${calButtons(k)}</div>` : ''}
    <button class="ghost press" data-act="kdel" data-id="${k.id}" style="margin-top:12px">Delete</button>`;
}

// Which calendar "Add" opens on this phone: 'google', 'apple', or null (ask each time). Per phone.
const calApp = () => (PREVIEW ? Q.get('calapp') || null : ls.get(K.calapp, null));
function addBtn(k) {
  if (calApp() === 'google') return `<a class="cal press" target="_blank" rel="noopener" href="${gcalLink(k)}">${ic('cal')}Add</a>`;
  if (calApp() === 'apple') return `<button class="cal press" data-act="ics" data-id="${k.id}">${ic('cal')}Add</button>`;
  return `<button class="cal press" data-act="addcal" data-id="${k.id}">${ic('cal')}Add</button>`;
}
function calButtons(k) {
  const g = (cls) => `<a class="${cls} press" target="_blank" rel="noopener" href="${gcalLink(k)}">${ic('cal')}Google Calendar</a>`;
  const a = (cls) => `<button class="${cls} press" data-act="ics" data-id="${k.id}">${ic('cal')}Apple Calendar</button>`;
  return calApp() === 'apple' ? a('pri') + g('ghost') : g('pri') + a('ghost');
}
// Backup: one file with everything this phone has (no calendar links or passwords are stored here).
function downloadBackup() {
  const data = { app: 'home', version: VERSION, saved_at: new Date().toISOString(), profiles: state.profiles, ...Object.fromEntries(TABLES.filter((t) => t !== 'calendar_sync').map((t) => [t, state.rows[t]])) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `home-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  ls.set(K.backup, new Date().toISOString());
}
const icsStamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function gcalLink(k) {
  const end = new Date(Date.parse(k.starts_at) + 3600000).toISOString();
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(k.title)}&dates=${icsStamp(k.starts_at)}/${icsStamp(end)}${k.location ? `&location=${encodeURIComponent(k.location)}` : ''}`;
}
// Directions in the maps app that matches this phone's calendar choice.
function mapsLink(addr) {
  return calApp() === 'apple' ? `https://maps.apple.com/?q=${encodeURIComponent(addr)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
}
function downloadIcs(k) {
  const end = new Date(Date.parse(k.starts_at) + 3600000).toISOString();
  const icsEsc = (t) => String(t).replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Home//EN', 'BEGIN:VEVENT', `UID:${k.id}@home`, `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(k.starts_at)}`, `DTEND:${icsStamp(end)}`, `SUMMARY:${icsEsc(k.title)}`, ...(k.location ? [`LOCATION:${icsEsc(k.location)}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(k.title)}`, 'TRIGGER:-PT1H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
  a.download = `${k.title.replace(/[^\w -]+/g, '').slice(0, 40) || 'appointment'}.ics`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* event medicine shifts: a list from the calendar, ready to copy for checking against the pay email */
const eventShifts = () => calRows().filter((r) => r.kind === 'event_shift').sort((a, b) => String(b.starts_at || b.start_date).localeCompare(String(a.starts_at || a.start_date)));
const shiftHours = (e) => (e.starts_at && e.ends_at ? Math.round(((Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 3600000) * 4) / 4 : 0);
const fmtHrs = (h) => `${+h.toFixed(2)} hr${h === 1 ? '' : 's'}`;
const shiftDay = (e) => new Date(S.parse(e.start_date)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shiftLine = (e) => `${shiftDay(e)} · ${e.title} · ${e.starts_at ? D.hoursLabel(e.starts_at, e.ends_at, TZ) : 'all day'} · ${fmtHrs(shiftHours(e))}`;

function eventsView() {
  const today = todayStr();
  const all = eventShifts();
  const past = all.filter((e) => e.start_date <= today), next = all.filter((e) => e.start_date > today).reverse();
  const byMonth = new Map();
  for (const e of past) { const k = e.start_date.slice(0, 7); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(e); }
  const row = (e) => `<div class="it"><span class="nm">${esc(e.title)}<span class="meta"><b>${esc(shiftDay(e).replace(/, \d{4}$/, ''))}</b> · ${e.starts_at ? D.hoursLabel(e.starts_at, e.ends_at, TZ) : 'All day'} · ${fmtHrs(shiftHours(e))}</span></span></div>`;
  const months = [...byMonth.entries()].map(([k, es]) => {
    const label = new Date(`${k}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `<div class="sec"><b>${esc(label)}</b><button class="clear press" data-act="ecopy" data-m="${k}">Copy · ${fmtHrs(es.reduce((t, e) => t + shiftHours(e), 0))}</button></div><div class="list">${es.map(row).join('')}</div>`;
  }).join('');
  const recent = past.length;
  return `${header(recent ? `${plural(recent, 'shift')} worked · ${fmtHrs(past.reduce((t, e) => t + shiftHours(e), 0))}` : 'Event medicine', 'Event shifts')}
  <main>
    <p class="rs-sum">From your calendar’s “Event Physician” entries. Copy a month and paste it to Claude with your pay email to check nothing was missed.</p>
    ${next.length ? `${sec('Coming up', next.length)}<div class="list">${next.map(row).join('')}</div>` : ''}
    ${months || (!next.length ? `<p class="empty">No event shifts found yet. They show up once the calendar is connected.</p>` : '')}
  </main>
  ${dock('home')}`;
}

async function copyShifts(month, btn) {
  const es = eventShifts().filter((e) => e.start_date.startsWith(month) && e.start_date <= todayStr()).reverse(); // worked only
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const text = `Event medicine shifts, ${label} (from my calendar):\n${es.map(shiftLine).join('\n')}\nTotal: ${es.length} shifts, ${fmtHrs(es.reduce((t, e) => t + shiftHours(e), 0))}\n\nPlease compare these against my pay email and list any shift or hours that are missing or different.`;
  try { await navigator.clipboard.writeText(text); btn.classList.add('jelly'); btn.textContent = 'Copied'; setTimeout(() => render({ soft: true, keepFocus: '__none' }), 1400); }
  catch { prompt('Copy this:', text); }
}

/* activation */
function activationSheet(date) {
  const ov = findRow('day_overrides', date) || {};
  const local = (iso) => (iso ? `${D.localDateOf(Date.parse(iso), TZ)}T${hhmmOf(iso)}` : '');
  const nowLocal = `${todayStr()}T${hhmmOf(new Date().toISOString())}`;
  return `<h2>Activated<button class="lnk" data-act="close">Done</button></h2>
    <p class="hint" style="margin-top:0">Shared with both phones. If it runs overnight, the next day shows Post call for ${daySet().post_call_hours} hours after you get back.</p>
    <div class="list frm">
      <label class="frow">Went in<input type="datetime-local" class="dt" data-af="activated_from" data-date="${date}" value="${local(ov.activated_from) || nowLocal}"></label>
      <label class="frow">Got back<input type="datetime-local" class="dt" data-af="activated_to" data-date="${date}" value="${local(ov.activated_to)}"></label>
    </div>
    <div class="acts2" style="margin-top:12px">${ov.activated_from ? '' : `<button class="pri press" data-act="actsave" data-date="${date}">${ic('check')}I’m going in</button>`}${ov.activated_from ? `<button class="ghost press" data-act="actclear" data-date="${date}">Not activated after all</button>` : ''}</div>`;
}

/* --- bottom sheets --- */
function sheetView() {
  const s = ui.sheet;
  if (!s) return '';
  let body = '';
  if (s.type === 'addfrom') body = addFromSheet(s.tab);
  else if (s.type === 'gitem') body = groceryItemSheet(findRow('grocery_items', s.id));
  else if (s.type === 'pitem') body = pantryItemSheet(findRow('pantry_items', s.id));
  else if (s.type === 'chore') body = choreSheet(findRow('tasks', s.id));
  else if (s.type === 'task') body = taskSheet(findRow('tasks', s.id));
  else if (s.type === 'kid') body = kidSheet(findRow('kid_items', s.id));
  else if (s.type === 'activation') body = activationSheet(s.date);
  else if (s.type === 'nap') body = napSheet(s.date);
  else if (s.type === 'meal') body = mealSheet(s.slot);
  else if (s.type === 'recipe') body = recipeSheet(findRow('recipes', s.id));
  else if (s.type === 'ingr') body = ingrSheet();
  else if (s.type === 'ai') body = aiSheet();
  else if (s.type === 'paste') body = pasteSheet();
  else if (s.type === 'planpaste') body = planPasteSheet();
  else if (s.type === 'routine') body = routineSheet(findRow('routines', s.id));
  else if (s.type === 'plan') body = planSheet();
  else if (s.type === 'addcal') { const k = findRow('kid_items', s.id); body = k && k.starts_at ? `<h2>${esc(k.title)}</h2><div class="list opts"><a class="opt press" target="_blank" rel="noopener" href="${gcalLink(k)}">Google Calendar${ic('chev')}</a><button class="opt press" data-act="ics" data-id="${k.id}">Apple Calendar, with a 1 hour alert${ic('chev')}</button></div><p class="hint">To skip this step, pick your calendar in Settings.</p>` : ''; }
  if (!body) { ui.sheet = null; return ''; }
  return `<div class="scrim" data-act="close"></div><div class="bs${['addfrom', 'chore', 'meal', 'recipe', 'ingr', 'ai', 'paste', 'planpaste', 'plan', 'routine'].includes(s.type) ? '' : ' short'}" role="dialog" aria-modal="true">
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
    <p class="gt">This phone</p>
    <div class="grp rise d1">
      <div class="fl">Add to calendar<span class="seg sm">${[['google', 'Google'], ['apple', 'Apple'], ['', 'Ask']].map(([v, l]) => `<button class="${(calApp() || '') === v ? 'on' : ''}" data-act="calapp" data-v="${v}" aria-pressed="${(calApp() || '') === v}">${l}</button>`).join('')}</span></div>
    </div>
    <p class="gt">Theme</p>
    <div class="grp rise d1">
      <div class="tiles" role="radiogroup" aria-label="Theme">${tile('blush')}${tile('roast')}${tile('night')}</div>
      ${th.theme === 'night' ? `<button class="fl swr" role="switch" aria-checked="${th.dimOn}" data-act="dim">Dim 10 PM to 6 AM<span class="tg" aria-hidden="true"></span></button>` : ''}
    </div>
    <p class="gt">Day</p>
    <div class="grp rise d1">
      <label class="fl">Nap window<span class="pair"><input type="time" class="dt sm" data-dset="nap_start" value="${hm(daySet().nap_start)}" aria-label="Nap window starts"><span class="evl">to</span><input type="time" class="dt sm" data-dset="nap_end" value="${hm(daySet().nap_end)}" aria-label="Nap window ends"></span></label>
      <label class="fl">Nap length<select class="sel" data-dset="nap_minutes">${[60, 90, 120, 150, 180].map((m) => `<option value="${m}"${+daySet().nap_minutes === m ? ' selected' : ''}>${napLen(m)}</option>`).join('')}</select></label>
      <label class="fl">Dinner<input type="time" class="dt sm" data-dset="dinner" value="${hm(daySet().dinner)}"></label>
      <label class="fl">Bed<input type="time" class="dt sm" data-dset="bed" value="${hm(daySet().bed)}"></label>
      <button class="fl swr" role="switch" aria-checked="${lunchOn()}" data-act="lunchplan">Plan lunch too<span class="tg" aria-hidden="true"></span></button>
      <button class="fl swr" role="switch" aria-checked="${autoGrocery()}" data-act="autogro">Add what meals need to grocery<span class="tg" aria-hidden="true"></span></button>
      ${mine() ? `<label class="fl">Union hours<span class="pair"><input type="time" class="dt sm" data-dset="union_start" value="${hm(daySet().union_start)}" aria-label="Union office opens"><span class="evl">to</span><input type="time" class="dt sm" data-dset="union_end" value="${hm(daySet().union_end)}" aria-label="Union office closes"></span></label>
      <label class="fl">Post call<span class="pair"><input type="number" class="num" min="0" max="24" inputmode="numeric" data-dset="post_call_hours" value="${daySet().post_call_hours}"><span class="evl">hours</span></span></label>` : ''}
    </div>
    <p class="gt" style="margin-top:18px">Cooking with</p>
    <div class="grp rise d1"><div class="gear">${GEAR.map(([k, l]) => `<button class="pick press${gear().includes(k) ? ' on' : ''}" data-act="gear" data-v="${k}" aria-pressed="${gear().includes(k)}">${l}</button>`).join('')}</div>
      <p class="hint" style="margin:0 0 14px">Shared. Copy for AI only suggests ways to cook that you have.</p></div>
    <p class="gt" style="margin-top:18px">Calendar</p>
    <div class="grp rise d1">
      <div class="fl">Shifts belong to<span class="seg sm"><button class="${calOwner() === myId() ? 'on' : ''}" data-act="calowner" data-v="me" aria-pressed="${calOwner() === myId()}">${esc(myName() || 'Me')}</button>${partnerId() ? `<button class="${calOwner() && calOwner() === partnerId() ? 'on' : ''}" data-act="calowner" data-v="partner" aria-pressed="${calOwner() === partnerId()}">${esc(userName(partnerId()))}</button>` : ''}</span></div>
      ${!mine() ? `<p class="hint" style="margin:0 0 12px">You see ${esc(ownerName())}’s calendar. The activation and union buttons are only on their phone.</p>` : ''}
      ${!mine() ? '' : calSync().setup ? calSync().rows.map((r) => `<div class="fl">${r.source === 'google' ? 'Google' : 'Outlook'}<span class="v">${r.last_error ? esc(r.last_error) : r.last_ok_at ? `Updated ${timeOf(r.last_ok_at)}` : 'Waiting'}</span></div>`).join('') : '<div class="fl">Not connected<span class="v">See README, step 10</span></div>'}
      ${mine() ? `<button class="fl press" data-act="calsync">Sync now<span class="v">${ic('reset')}</span></button>
      <a class="fl press" href="#/events">Event shifts<span class="v">${ic('chev')}</span></a>` : ''}
    </div>
    ${partnerId() ? `<p class="gt">Notes for ${esc(userName(partnerId()))}</p>
    <div class="grp rise d1 notes">
      <p class="hint" style="margin:12px 0 8px">Little notes that pop up for ${esc(userName(partnerId()))} now and then when they finish something. They won’t see this list.</p>
      <form class="qa slim" data-form="cheeradd" autocomplete="off" style="margin:0 0 10px"><div class="row"><input class="fld" name="name" type="text" placeholder="I love you. Thanks for everything you do." maxlength="200" enterkeyhint="done" aria-label="Note"><button class="add press" type="submit" aria-label="Add">${ic('plus')}</button></div></form>
      ${myNotes().map((n) => `<div class="fl note"><span>${esc(n.text)}</span><button class="plus press" data-act="cheerdel" data-id="${n.id}" aria-label="Remove note">${ic('x')}</button></div>`).join('')}
      <button class="fl press" data-act="cheertry">Preview a cheer<span class="v">${ic('star')}</span></button>
    </div>` : ''}
    <p class="gt">Lists</p>
    <div class="grp rise d1">
      <label class="fl press">Import Costco list<span class="v">${costco ? `${costco} items` : 'CSV file'}</span><input class="hide" type="file" accept=".csv,text/csv" data-act="costcocsv"></label>
      <button class="fl press" data-act="backup">Back up everything<span class="v">${ls.get(K.backup, null) ? new Date(ls.get(K.backup, null)).toLocaleDateString() : 'Never'}</span></button>
      <label class="fl press">Import chores<span class="v">${choresAll().length ? `${choresAll().length} chores` : 'CSV file'}</span><input class="hide" type="file" accept=".csv,text/csv" data-act="chorescsv"></label>
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

/* ---------- chores CSV import ----------
   columns: name, group, repeat_mode (fixed | after_completion | once), every, unit, week_of_month,
   months (Mar;Jun), day (Tue), owner (Me | Either), active (yes | no), notes, howto, start_date */
async function importChores(file) {
  const rows = parseCsv(await file.text());
  const head = (rows.shift() || []).map(norm);
  const col = (n) => head.indexOf(n);
  const get = (r, n) => (col(n) < 0 ? '' : (r[col(n)] || '').trim());
  if (col('name') < 0) { alert('That file needs a "name" column.'); return; }
  const today = todayStr();
  const have = new Set(live('tasks').map((t) => norm(t.title)));
  let chores = 0, tasks = 0, off = 0;
  for (const r of rows) {
    const title = get(r, 'name').slice(0, 120);
    if (!title || have.has(norm(title))) continue;
    const mode = norm(get(r, 'repeat_mode'));
    const base = { title, notes: get(r, 'notes') || null, howto: get(r, 'howto') || null, priority: false, done_at: null };
    if (mode === 'once') {
      insertRow('tasks', { ...base, kind: 'task', category: 'House', priority: true, active: true, repeat_mode: 'once', every: 1, unit: 'week', due_date: get(r, 'start_date') || null });
      tasks++; have.add(norm(title)); continue;
    }
    const day = get(r, 'day').slice(0, 3).toLowerCase();
    const months = get(r, 'months').split(/[;,]/).map((m) => S.MONTHS.findIndex((x) => x.toLowerCase() === m.trim().slice(0, 3).toLowerCase()) + 1).filter((m) => m > 0);
    const unit = ['day', 'week', 'month', 'year'].includes(norm(get(r, 'unit'))) ? norm(get(r, 'unit')) : 'week';
    const c = {
      ...base, kind: 'chore', category: get(r, 'group') || null,
      assignee: norm(get(r, 'owner')) === 'me' ? myId() : null,
      active: norm(get(r, 'active')) !== 'no',
      repeat_mode: mode === 'fixed' ? 'fixed' : 'after',
      every: Math.max(1, parseInt(get(r, 'every'), 10) || 1), unit,
      week_of_month: parseInt(get(r, 'week_of_month'), 10) || null,
      weekday: day ? S.WEEKDAYS.findIndex((d) => d.toLowerCase() === day) : null,
      months: months.length && months.length < 12 ? months : null,
      start_date: get(r, 'start_date') || null
    };
    if (c.weekday < 0) c.weekday = null;
    c.anchor_date = c.due_date = S.initialDue(c, today);
    delete c.start_date;
    insertRow('tasks', c);
    chores++; if (!c.active) off++; have.add(norm(title));
  }
  alert(chores || tasks ? `Added ${plural(chores, 'chore')}${off ? ` (${off} switched off)` : ''}${tasks ? ` and ${plural(tasks, 'task')}` : ''}.` : 'Everything in that file is already here.');
  render({ soft: true });
}

/* ---------- render + events ---------- */
let current = '';
const ROUTES = ['home', 'grocery', 'kitchen', 'chores', 'reset', 'settings', 'calendar', 'kids', 'events'];
function route() {
  if (!api.getSession()) return 'signin';
  if (PREVIEW && PREVIEW !== 'signin' && !location.hash) return PREVIEW;
  const h = location.hash.replace('#/', '');
  return ROUTES.includes(h) ? h : 'home';
}

const VIEWS = { signin: signinView, home: homeView, grocery: groceryView, kitchen: kitchenView, chores: choresView, reset: resetView, settings: settingsView, calendar: calendarView, kids: kidsView, events: eventsView };

function render({ soft = false, keepFocus = null, fx = null } = {}) {
  const r = route();
  // Never lose what someone is typing. The name field just waits; add boxes keep their text and focus across a redraw.
  const act = $app.contains(document.activeElement) && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.type !== 'file' ? document.activeElement : null;
  if (soft && !keepFocus && r === current && act && (act.id === 'nm' || act.tagName === 'TEXTAREA' || act.dataset.rf)) return updateBadge();
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
  if (kind === 'kappt' || kind === 'ksup') {
    const name = f.name.value.trim();
    if (!name) return;
    let starts = null;
    if (kind === 'kappt' && f.when.value) starts = new Date(f.when.value).toISOString(); // local time typed -> UTC
    const k = insertRow('kid_items', kind === 'kappt' ? { kind: 'appointment', title: name.slice(0, 120), starts_at: starts, status: null } : { kind: 'supply', title: name.slice(0, 120), status: 'have' });
    render({ soft: true, keepFocus: `[data-form="${kind}"] .fld`, fx: [[`.it:has([data-id="${k.id}"])`, 'pop']] });
    return;
  }
  if (kind === 'rtbrk') {
    const r = findRow('routines', f.dataset.id); if (!r) return;
    let from = f.from.value, to = f.to.value;
    if (!from || !to) return;
    if (to < from) [from, to] = [to, from];
    updateRow('routines', r.id, { breaks: [...(r.breaks || []), { from, to, label: f.label.value.trim().slice(0, 40) || 'Break' }].sort((a, b) => a.from.localeCompare(b.from)) });
    render({ soft: true, keepFocus: '__none' });
    return;
  }
  if (kind === 'cheeradd') {
    const text = f.name.value.trim().slice(0, 200);
    if (!text || !partnerId()) return;
    insertRow('cheers', { to_user: partnerId(), created_by: myId(), text });
    render({ soft: true, keepFocus: '[data-form="cheeradd"] .fld' });
    return;
  }
  if (kind === 'radd') {
    const name = f.name.value.trim();
    if (!name) return;
    const r = insertRow('recipes', { title: name.slice(0, 120), ingredients: null, steps: null, source_url: null, notes: null });
    ui.sheet = { type: 'recipe', id: r.id };
    render({ soft: true, keepFocus: '.bs [data-rf="ingredients"]' });
    return;
  }
  if (kind === 'swap') { const b = f.querySelector('[data-act="swapcopy"]'); if (b) copySwap(b.dataset.slot, f.want.value, b); return; }
  if (kind === 'mtext') {
    const slot = ui.sheet?.slot, text = f.name.value.trim().slice(0, 120);
    if (!slot) return;
    setMeal(slot, { text: text || null });
    ui.sheet = null;
    render({ soft: true, keepFocus: '__none', fx: [[`[data-slot="${slot}"]`, 'pop']] });
    return;
  }
  if (kind === 'tadd') {
    const name = f.name.value.trim();
    if (!name) return;
    const lists = taskLists(), cat = lists.includes(ui.taskCat) ? ui.taskCat : lists[0];
    const t = insertRow('tasks', { kind: 'task', title: name.slice(0, 120), category: cat, priority: false, active: true, repeat_mode: 'once', every: 1, unit: 'week', due_date: null, done_at: null });
    render({ soft: true, keepFocus: '[data-form="tadd"] .fld', fx: [[`.it:has([data-id="${t.id}"])`, 'pop']] });
    return;
  }
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
    case 'gcheck': { const was = groceryOpen().length; toggleGrocery(id); if (was > 0 && !groceryOpen().length) setTimeout(() => cheer('grocery', true), 300); return soft([[`[data-act="gcheck"][data-id="${id}"]`, 'jelly']]); }
    case 'gstorepick': ui.gstore = t.dataset.v; ls.set(K.gstore, ui.gstore); return soft();
    case 'gclear': { const gone = groceryDone().map((g) => ({ ...g })); gone.forEach((g) => removeRow('grocery_items', g.id)); offerUndo(`Cleared ${plural(gone.length, 'item')}`, () => gone.forEach((g) => restoreRow('grocery_items', g))); return soft(); }
    case 'gitem': ui.sheet = { type: 'gitem', id }; return soft();
    case 'gstore': {
      const g = findRow('grocery_items', id), store = t.dataset.store || null;
      updateRow('grocery_items', id, { store });
      if (g && store) { state.storeMemory[norm(g.name)] = store; ls.set(K.stores, state.storeMemory); } // next time it goes straight there
      ui.sheet = null; return soft();
    }
    case 'gdel': { const g = { ...findRow('grocery_items', id) }; removeRow('grocery_items', id); offerUndo(`Removed ${g.name}`, () => restoreRow('grocery_items', g)); ui.sheet = null; return soft(); }
    // add-from sheet
    case 'addfrom': ui.sheet = { type: 'addfrom', tab: t.dataset.tab }; ui.newGroup = null; return soft();
    case 'edit': ui.edit = !ui.edit; return soft();
    case 'newgroup': ui.newGroup = t.dataset.g; return soft();
    case 'addstaple': { const x = findRow('staples', id); if (x) addGrocery(x.name, { store: x.store || (x.list === 'costco' ? 'costco' : null) }); return soft([[`[data-sid="${id}"]`, 'pop']]); }
    case 'delstaple': removeRow('staples', id); return soft();
    case 'close': ui.sheet = null; ui.edit = false; ui.ingrDays = null; return soft();
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
    case 'pdel': { const p = { ...findRow('pantry_items', id) }; removeRow('pantry_items', id); offerUndo(`Removed ${p.name}`, () => restoreRow('pantry_items', p)); ui.sheet = null; return soft(); }
    // meals and recipes
    case 'ktab': ui.ktab = t.dataset.v; ls.set(K.ktab, ui.ktab); return soft();
    case 'wk': ui.week = +t.dataset.v === 0 ? 0 : ui.week + +t.dataset.v; return soft();
    case 'mslot': ui.sheet = { type: 'meal', slot: t.dataset.slot }; return soft();
    case 'mpick': {
      const slot = t.dataset.slot;
      setMeal(slot, { recipe_id: id });
      ui.sheet = null; return soft([[`[data-slot="${slot}"]`, 'pop']]);
    }
    case 'mclear': { const m = { ...(findRow('meal_plan', t.dataset.slot) || {}) }; setMeal(t.dataset.slot, {}); offerUndo(`Cleared ${mealTitle(m) || 'meal'}`, () => setMeal(m.slot, { recipe_id: m.recipe_id, text: m.text })); ui.sheet = null; return soft(); }
    case 'rfav': { const r = findRow('recipes', id); if (r) updateRow('recipes', id, { favorite: !r.favorite }); return soft([[`[data-act="rfav"][data-id="${id}"]`, 'jelly']]); }
    case 'rmethod': { const r = findRow('recipes', id); if (r) updateRow('recipes', id, { method: r.method === t.dataset.k ? null : t.dataset.k }); return soft([[`[data-act="rmethod"][data-k="${t.dataset.k}"]`, 'jelly']]); }
    case 'rtag': { const r = findRow('recipes', id); if (r) updateRow('recipes', id, { [t.dataset.k]: !r[t.dataset.k] }); return soft(); }
    case 'ragain': {
      const d = t.dataset.date, slot = M.slotOf(d), cur = findRow('meal_plan', slot);
      setMeal(slot, cur?.recipe_id === id ? {} : { recipe_id: id });
      return soft([[`[data-act="ragain"][data-date="${d}"]`, 'jelly']]);
    }
    case 'thawed': {
      t.classList.add('jelly');
      (t.dataset.ids || '').split(',').filter(Boolean).forEach((pid) => updateRow('pantry_items', pid, { location: 'fridge' }));
      setTimeout(() => soft(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 300);
      return;
    }
    case 'ritem': ui.sheet = { type: 'recipe', id }; return soft();
    case 'rdel': if (!confirm('Delete this recipe? Planned meals keep their name.')) return; {
      const r = findRow('recipes', id);
      // Meals that used it keep the title as text, so the plan still reads right.
      if (r) live('meal_plan').filter((m) => m.recipe_id === id).forEach((m) => saveKeyed('meal_plan', m.slot, { date: m.date, meal: m.meal, recipe_id: null, text: r.title }));
      removeRow('recipes', id); ui.sheet = null; return soft();
    }
    case 'iopen': ui.ingr = {}; ui.ingrDays = null; ui.sheet = { type: 'ingr' }; return soft();
    case 'shopsoon': ui.ingr = {}; ui.ingrDays = soonDays(); ui.sheet = { type: 'ingr' }; return soft();
    case 'plannext': ui.ktab = 'meals'; ls.set(K.ktab, 'meals'); ui.week = 1; location.replace('#/kitchen'); return;
    case 'wantadd': {
      const f = $app.querySelector('[data-form="swap"]'); if (!f) return;
      const v = t.dataset.v, parts = f.want.value.split(',').map((x) => x.trim()).filter(Boolean);
      const on = parts.some((x) => x.toLowerCase() === v.toLowerCase());
      f.want.value = (on ? parts.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...parts, v]).join(', ');
      t.classList.toggle('on', !on); t.classList.add('jelly'); setTimeout(() => t.classList.remove('jelly'), 400);
      return;
    }
    case 'autogro': saveKeyed('day_settings', 1, { auto_grocery: !autoGrocery() }); return soft();
    case 'swapcopy': { const f = $app.querySelector('[data-form="swap"]'); copySwap(t.dataset.slot, f ? f.want.value : '', t); return; }
    case 'itog': { const k = t.dataset.k, x = ingrGroups().flatMap((g) => g.items).find((i) => i.key === k); if (x) ui.ingr[k] = !x.on; return soft([[`[data-k="${k}"] .cb`, 'jelly']]); }
    case 'iadd': {
      if (t.classList.contains('ld') || t.disabled) return;
      const items = ingrGroups().flatMap((g) => g.items).filter((x) => x.on);
      t.classList.add('ld');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => t.classList.add('ok'), still ? 0 : 280);
      setTimeout(() => {
        for (const x of items) addGrocery(x.name, { note: x.qty || null });
        ui.sheet = null; ui.ingr = {}; ui.ingrDays = null; soft();
      }, still ? 0 : 820);
      return;
    }
    case 'aiopen': ui.sheet = { type: 'ai' }; return soft();
    case 'aicopy': copyPrompt(t); return;
    case 'pasteopen': ui.sheet = { type: 'paste' }; render({ soft: true, keepFocus: '#pastebox' }); return;
    case 'pastesave': {
      const box = $app.querySelector('#pastebox'), text = box ? box.value : '';
      if (!text.trim()) { box?.focus(); return; }
      const r = insertRow('recipes', M.parsePasted(text));
      ui.sheet = { type: 'recipe', id: r.id }; return soft();
    }
    case 'gear': { const v = t.dataset.v, g = gear(); saveKeyed('day_settings', 1, { appliances: g.includes(v) ? g.filter((x) => x !== v) : [...g, v] }); return soft([[`[data-act="gear"][data-v="${v}"]`, 'jelly']]); }
    case 'wkclear': {
      const ms = clearable();
      if (!ms.length || !confirm(`Clear ${plural(ms.length, 'planned meal')} for ${weekRange(weekDays())}? Recipes stay saved.`)) return;
      const was = ms.map((m) => ({ ...m }));
      ms.forEach((m) => setMeal(m.slot, {}));
      offerUndo(`Cleared ${plural(was.length, 'meal')}`, () => was.forEach((m) => setMeal(m.slot, { recipe_id: m.recipe_id, text: m.text })));
      return soft();
    }
    case 'planopen': ui.planErr = null; ui.sheet = { type: 'planpaste' }; render({ soft: true, keepFocus: '#planbox' }); return;
    case 'planread': {
      const box = $app.querySelector('#planbox'), text = box ? box.value : '';
      if (!text.trim()) { box?.focus(); return; }
      const p = readPlan(text);
      if (!p.slots.length && !p.recipes.length) {
        ui.planErr = 'Couldn’t find any days in that. Make sure it has a PLAN line, then lines like “Thu: Meal name”.';
        render({ soft: true, keepFocus: '__none' }); const b = $app.querySelector('#planbox'); if (b) b.value = text; return;
      }
      ui.plan = p; ui.sheet = { type: 'plan' }; return soft();
    }
    case 'ptog': { const x = ui.plan?.slots[+t.dataset.i]; if (x) x.on = !x.on; return soft([[`[data-act="ptog"][data-i="${t.dataset.i}"] .cb`, 'jelly']]); }
    case 'rtog': { const x = ui.plan?.recipes[+t.dataset.i]; if (x) x.on = !x.on; return soft([[`[data-act="rtog"][data-i="${t.dataset.i}"] .cb`, 'jelly']]); }
    case 'planapply': {
      if (t.classList.contains('ld') || t.disabled) return;
      t.classList.add('ld');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => t.classList.add('ok'), still ? 0 : 280);
      setTimeout(() => { applyPlan(); ui.plan = null; ui.sheet = null; soft(); }, still ? 0 : 820);
      return;
    }
    case 'lunchplan': saveKeyed('day_settings', 1, { lunch_plan: !lunchOn() }); return soft();
    // chores
    case 'ctab': ui.choreTab = t.dataset.v; ls.set(K.choreTab, ui.choreTab); return soft();
    case 'cwhof': ui.who = t.dataset.v; ls.set(K.who, ui.who); return soft();
    case 'citem': ui.sheet = { type: 'chore', id }; return soft();
    case 'howto': ui.howto = ui.howto === id ? null : id; return soft();
    case 'clater': ui.showLater = !ui.showLater; return soft();
    case 'cdone': case 'cskip': {
      const c = findRow('tasks', id); if (!c) return;
      if (a === 'cdone' && t.classList.contains('cb')) {
        // Check, squish, then the row moves on to its next date.
        t.classList.add('on', 'jelly'); t.innerHTML = ic('check');
        const prev = { due_date: c.due_date, done_at: c.done_at || null };
        setTimeout(() => { const ev = closeChore(c, 'done'); soft(); offerUndo(`Done: ${c.title}`, () => undoClose(c, prev, ev)); cheerAfterDone('chore'); }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 380);
        return;
      }
      const prev = { due_date: c.due_date, done_at: c.done_at || null }, ev = closeChore(c, a === 'cdone' ? 'done' : 'skip');
      offerUndo(`${a === 'cdone' ? 'Done' : 'Skipped'}: ${c.title}`, () => undoClose(c, prev, ev));
      return soft(ui.sheet ? [['.bs .hint', 'pop']] : null);
    }
    case 'cdonehero': {
      const c = findRow('tasks', id); if (!c || t.classList.contains('ld')) return;
      t.classList.add('ld');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => t.classList.add('ok'), still ? 0 : 280);
      const prev = { due_date: c.due_date, done_at: c.done_at || null };
      setTimeout(() => { const ev = closeChore(c, 'done'); soft(); offerUndo(`Done: ${c.title}`, () => undoClose(c, prev, ev)); cheerAfterDone('chore'); }, still ? 0 : 820);
      return;
    }
    case 'cnew': { const c = newChore(); ui.sheet = { type: 'chore', id: c.id }; render({ soft: true, keepFocus: '.bs .ttl' }); $app.querySelector('.bs .ttl')?.select(); return; }
    case 'cwho': { const v = t.dataset.v; updateRow('tasks', id, { assignee: v === 'me' ? myId() : v === 'partner' ? partnerId() : null }); return soft(); }
    case 'csize': updateRow('tasks', id, { effort: t.dataset.v }); return soft();
    case 'cmove': { updateRow('tasks', id, { due_date: t.dataset.date }); return soft([[`.it:has([data-id="${id}"])`, 'pop']]); }
    case 'cmode': updateRow('tasks', id, { repeat_mode: t.dataset.v }); return soft();
    case 'cmonth': {
      const c = findRow('tasks', id); if (!c) return;
      const m = +t.dataset.m;
      let ms = c.months && c.months.length ? [...c.months] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      ms = ms.includes(m) ? ms.filter((x) => x !== m) : [...ms, m].sort((x, y) => x - y);
      if (!ms.length) return; // at least one month
      updateRow('tasks', id, { months: ms.length === 12 ? null : ms }); return soft();
    }
    case 'cactive': {
      const c = findRow('tasks', id); if (!c) return;
      const on = !c.active;
      updateRow('tasks', id, on && !c.due_date ? { active: on, due_date: S.initialDue(c, todayStr()) } : { active: on }); return soft();
    }
    case 'cdel': if (!confirm('Delete this chore? Its history is kept.')) return; removeRow('tasks', id); ui.sheet = null; return soft();
    // tasks
    case 'tcat': ui.taskCat = t.dataset.v; return soft();
    case 'tnewcat': {
      const n = (prompt('Name the new list') || '').trim().slice(0, 40);
      if (!n) return;
      ls.set(K.lists, [...new Set([...ls.get(K.lists, []), n])]); ui.taskCat = n; return soft();
    }
    case 'tdone': {
      const x = findRow('tasks', id); if (!x) return;
      if (x.done_at) updateRow('tasks', id, { done_at: null });
      else { const ev = recordEvent(x, 'done', x.due_date || todayStr()); updateRow('tasks', id, { done_at: new Date().toISOString() }); offerUndo(`Done: ${x.title}`, () => undoClose(x, { done_at: null }, ev)); setTimeout(() => cheerAfterDone('task'), 250); }
      return soft([[`[data-act="tdone"][data-id="${id}"]`, 'jelly']]);
    }
    case 'titem': ui.sheet = { type: 'task', id }; return soft();
    case 'tflag': { const x = findRow('tasks', id); if (x) updateRow('tasks', id, { priority: !x.priority }); return soft([[`.flag[data-id="${id}"]`, 'jelly']]); }
    case 'tshowdone': ui.showDone = !ui.showDone; return soft();
    case 'tdel': { const x = { ...findRow('tasks', id) }; removeRow('tasks', id); offerUndo(`Deleted ${x.title}`, () => restoreRow('tasks', x)); ui.sheet = null; return soft(); }
    // today + calendar
    case 'napnow': { const n = nowHM(); saveKeyed('day_overrides', t.dataset.date, { nap_start: n, nap_end: addMin(n, +daySet().nap_minutes || 120) }); return soft([['.tl .r.now', 'pop']]); }
    case 'napup': saveKeyed('day_overrides', t.dataset.date, { nap_end: nowHM() }); return soft();
    case 'napedit': ui.sheet = { type: 'nap', date: t.dataset.date }; return soft();
    case 'napset': { const v = t.dataset.t; saveKeyed('day_overrides', t.dataset.date, { nap_start: v, nap_end: addMin(v, +daySet().nap_minutes || 120) }); ui.sheet = null; return soft(); }
    case 'napclear': saveKeyed('day_overrides', t.dataset.date, { nap_start: null, nap_end: null }); ui.sheet = null; return soft();
    case 'cheerdel': { const n = { ...findRow('cheers', id) }; removeRow('cheers', id); offerUndo('Note removed', () => restoreRow('cheers', n)); return soft(); }
    case 'cheertry': cheer('chore', true); return;
    case 'rate': {
      const m = findRow('meal_plan', t.dataset.slot); if (!m) return;
      const v = t.dataset.v;
      saveKeyed('meal_plan', m.slot, { date: m.date, meal: m.meal, rating: v });
      if (m.recipe_id && v === 'loved') updateRow('recipes', m.recipe_id, { favorite: true, never_again: false });
      if (m.recipe_id && v === 'never') updateRow('recipes', m.recipe_id, { never_again: true, favorite: false });
      offerUndo(v === 'loved' ? 'Starred it' : v === 'never' ? 'Won’t suggest it again' : 'Thanks', () => { saveKeyed('meal_plan', m.slot, { date: m.date, meal: m.meal, rating: null }); });
      return soft();
    }
    case 'lodone': { const p = { ...findRow('pantry_items', id) }; removeRow('pantry_items', id); offerUndo(t.dataset.v === 'ate' ? `Ate the ${p.name.toLowerCase()}` : `Tossed the ${p.name.toLowerCase()}`, () => restoreRow('pantry_items', p)); return soft(); }
    case 'leftover': {
      const f = $app.querySelector('[data-form="padd"]'), typed = f ? f.name.value.trim() : '';
      const td = todayStr(), m = mealOf(M.slotOf(td)) || mealOf(M.slotOf(S.addDays(td, -1)));
      const name = (typed || (m ? mealTitle(m) : 'Leftovers')).slice(0, 70);
      const row = insertRow('pantry_items', { name: /^leftover/i.test(name) ? name : `Leftover ${name.toLowerCase()}`, location: 'fridge', status: 'have', made_on: td });
      ui.loc = 'fridge'; ls.set(K.loc, 'fridge');
      return render({ soft: true, keepFocus: '__none', fx: [[`.it:has([data-id="${row.id}"])`, 'pop']] });
    }
    case 'moreheads': ui.allHeads = !ui.allHeads; return soft();
    case 'recap': cheer('allDone', true, `This week you two did ${t.dataset.n} things together. That’s a team.`); return;
    case 'backup': downloadBackup(); return soft([[`[data-act="backup"]`, 'jelly']]);
    case 'calowner': saveKeyed('day_settings', 1, { calendar_owner: t.dataset.v === 'me' ? myId() : partnerId() }); return soft();
    case 'union': { const d = t.dataset.date; saveKeyed('day_overrides', d, { union_day: !unionOn(d) }); return soft([['.hero.shift', 'pop']]); }
    case 'actopen': ui.sheet = { type: 'activation', date: t.dataset.date }; return soft();
    case 'actsave': {
      const inp = $app.querySelector('[data-af="activated_from"]');
      saveKeyed('day_overrides', t.dataset.date, { activated_from: inp && inp.value ? new Date(inp.value).toISOString() : new Date().toISOString() });
      return soft();
    }
    case 'actclear': saveKeyed('day_overrides', t.dataset.date, { activated_from: null, activated_to: null }); ui.sheet = null; return soft();
    case 'caltab': ui.calTab = t.dataset.v; return soft();
    case 'calforce': {
      if (state.rows.calendar_sync.length) { state.rows.calendar_sync.forEach((r) => { r.last_error = r.last_error ? 'Retrying…' : r.last_error; }); }
      kickCalendar(true); return soft();
    }
    // kids
    case 'ktaker': { const k = findRow('kid_items', id); if (k) updateRow('kid_items', id, { taker: takerOf(k) === t.dataset.v && k.taker ? null : t.dataset.v }); return soft(); }
    case 'rtnew': { const r = insertRow('routines', { title: 'New weekly thing', who: 'kids', weekdays: [], start_time: '09:00', end_time: '10:00', breaks: [] }); ui.sheet = { type: 'routine', id: r.id }; render({ soft: true, keepFocus: '.bs .ttl' }); $app.querySelector('.bs .ttl')?.select(); return; }
    case 'rtitem': ui.sheet = { type: 'routine', id }; return soft();
    case 'rtwho': updateRow('routines', id, { who: t.dataset.v }); return soft();
    case 'rtday': { const r = findRow('routines', id); if (!r) return; const d = +t.dataset.d, w = r.weekdays || []; updateRow('routines', id, { weekdays: (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]).sort((a, b) => a - b) }); return soft(); }
    case 'rtbrkdel': { const r = findRow('routines', id); if (!r) return; const was = [...(r.breaks || [])]; updateRow('routines', id, { breaks: was.filter((_, i) => i !== +t.dataset.i) }); offerUndo('Break removed', () => updateRow('routines', id, { breaks: was })); return soft(); }
    case 'rtdel': { const r = { ...findRow('routines', id) }; removeRow('routines', id); offerUndo(`Deleted ${r.title}`, () => restoreRow('routines', r)); ui.sheet = null; return soft(); }
    case 'kitem': ui.sheet = { type: 'kid', id }; return soft();
    case 'kstat': updateRow('kid_items', id, { status: t.dataset.s }); return soft([[`[data-act="kstat"][data-id="${id}"][data-s="${t.dataset.s}"]`, 'jelly']]);
    case 'ksend': { const k = findRow('kid_items', id); if (k) addGrocery(k.title); return soft([[`.it:has([data-id="${id}"]) .onlist`, 'pop']]); }
    case 'kdel': { const k = { ...findRow('kid_items', id) }; removeRow('kid_items', id); offerUndo(`Deleted ${k.title}`, () => restoreRow('kid_items', k)); ui.sheet = null; return soft(); }
    case 'calapp': if (t.dataset.v) ls.set(K.calapp, t.dataset.v); else ls.del(K.calapp); return soft([[`[data-act="calapp"][data-v="${t.dataset.v}"]`, 'jelly']]);
    case 'addcal': ui.sheet = { type: 'addcal', id }; return soft();
    case 'ics': { const k = findRow('kid_items', id); if (k && k.starts_at) downloadIcs(k); ui.sheet = null; return soft(); }
    // event shifts
    case 'ecopy': copyShifts(t.dataset.m, t); return;
    case 'calsync': kickCalendar(true); return soft([['[data-act="calsync"]', 'jelly']]);
    case 'resetweek': {
      if (t.classList.contains('ld')) return;
      t.classList.add('ld');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => t.classList.add('ok'), still ? 0 : 320);
      setTimeout(() => { ui.resetCount = resetWeek(); soft(); }, still ? 0 : 900);
      return;
    }
  }
});
let verTaps = 0, verTimer = 0;

$app.addEventListener('change', (e) => {
  if (e.target.id === 'nm') saveName(e.target.value);
  if (e.target.dataset.act === 'costcocsv' && e.target.files[0]) importCostco(e.target.files[0]);
  if (e.target.dataset.act === 'chorescsv' && e.target.files[0]) importChores(e.target.files[0]);
  const ds = e.target.dataset;
  if (ds.kf && ds.id) {
    let v = e.target.value;
    if (ds.kf === 'title') { v = v.trim().slice(0, 120); if (!v) return render({ soft: true, keepFocus: '__none' }); }
    else if (ds.kf === 'starts_at') v = v ? new Date(v).toISOString() : null;
    else v = v.trim() || null;
    updateRow('kid_items', ds.id, { [ds.kf]: v });
    return render({ soft: true, keepFocus: '__none' });
  }
  if (ds.rtf && ds.id) {
    let v = e.target.value;
    if (ds.rtf === 'title') { v = v.trim().slice(0, 80); if (!v) return render({ soft: true, keepFocus: '__none' }); }
    else if (!v) return render({ soft: true, keepFocus: '__none' });
    updateRow('routines', ds.id, { [ds.rtf]: v });
    return render({ soft: true, keepFocus: '__none' });
  }
  if (ds.rf && ds.id) {
    let v = e.target.value;
    if (ds.rf === 'title') { v = v.trim().slice(0, 120); if (!v) return render({ soft: true, keepFocus: '__none' }); }
    else if (ds.rf === 'source_url') { v = v.trim().slice(0, 500); if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`; v = v || null; }
    else v = v.replace(/\s+$/, '') || null;
    updateRow('recipes', ds.id, { [ds.rf]: v });
    return render({ soft: true, keepFocus: '__none' });
  }
  if (ds.nap && ds.date) {
    const v = e.target.value || null, ov = findRow('day_overrides', ds.date) || {};
    const patch = { [ds.nap]: v };
    if (ds.nap === 'nap_start' && v && !ov.nap_end) patch.nap_end = addMin(v, +daySet().nap_minutes || 120);
    if (ds.nap === 'nap_start' && !v) patch.nap_end = null;
    saveKeyed('day_overrides', ds.date, patch);
    return render({ soft: true, keepFocus: '__none' });
  }
  if (ds.af && ds.date) {
    saveKeyed('day_overrides', ds.date, { [ds.af]: e.target.value ? new Date(e.target.value).toISOString() : null });
    return render({ soft: true, keepFocus: '__none' });
  }
  if (ds.dset) {
    let v = e.target.value;
    if (ds.dset === 'post_call_hours') v = Math.max(0, Math.min(24, parseInt(v, 10) || 0));
    else if (ds.dset === 'nap_minutes') v = Math.max(15, Math.min(300, parseInt(v, 10) || 120));
    else if (!v) return render({ soft: true, keepFocus: '__none' });
    saveKeyed('day_settings', 1, { [ds.dset]: v });
    return render({ soft: true, keepFocus: '__none' });
  }
  const f = ds.field, fid = ds.id;
  if (f && fid) {
    const row = findRow('tasks', fid); if (!row) return;
    let v = e.target.value;
    const patch = {};
    if (f === 'title') { v = v.trim().slice(0, 120); if (!v) return render({ soft: true, keepFocus: '__none' }); patch.title = v; }
    else if (f === 'every') patch.every = Math.max(1, Math.min(365, parseInt(v, 10) || 1));
    else if (f === 'week_of_month' || f === 'weekday') patch[f] = v === '' ? null : +v;
    else if (f === 'due_date') patch.due_date = v || null;
    else if (f === 'unit') { patch.unit = v; if (v === 'day') { patch.weekday = null; patch.week_of_month = null; } if (v === 'week') patch.week_of_month = null; }
    else patch[f] = v.trim() || null;
    if (patch.due_date && row.kind === 'chore') patch.anchor_date = patch.due_date; // fixed monthly schedules keep this day
    updateRow('tasks', fid, patch);
    render({ soft: true, keepFocus: '__none' });
  }
});
function syncAddButton(input) {
  const b = input?.form?.querySelector('.add');
  if (b && (input.form.dataset.form === 'gadd' || input.form.dataset.form === 'tadd')) b.classList.toggle('ready', !!input.value.trim());
}
$app.addEventListener('input', (e) => { if (e.target.classList.contains('fld')) syncAddButton(e.target); });

const RIPPLE = '.pday .m,.pri,.add,.chip,.tag,.plus,.opt,.send,.seg > button,.dock a,.hlo button,.clear,.ghost,.tile,.card,.hero.press,.it .nm,.lnk,.pick,.fchip,.skipb,.more,.flag,.qbtn,.months button';
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
  if ((e.target.id === 'nm' || e.target.classList.contains('ttl') || e.target.classList.contains('txt')) && e.key === 'Enter') e.target.blur();
  if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; ui.edit = false; render({ soft: true, keepFocus: '__none' }); }
});

addEventListener('hashchange', () => { ui.sheet = null; ui.edit = false; ui.resetCount = null; render(); });
addEventListener('online', () => { state.netFail = false; pull(); rt.wake(); });
addEventListener('offline', updateBadge);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { T.apply(); pull(); rt.wake(); kickCalendar(); } });
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
kickCalendar();
