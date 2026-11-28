// Meal planning helpers. Pure functions, no DOM, no storage: tested in tests/meals.test.mjs.
import * as S from './schedule.js';

/** Monday of the week that holds `date` ('YYYY-MM-DD'). */
export function weekStart(date) {
  const wd = S.weekdayOf(date); // 0 = Sunday
  return S.addDays(date, wd === 0 ? -6 : 1 - wd);
}

export const slotOf = (date, meal = 'dinner') => `${date}:${meal}`;

const FRAC = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const UNITS = ['lb', 'lbs', 'pound', 'pounds', 'oz', 'ounce', 'ounces', 'cup', 'cups', 'c', 'tbsp', 'tbs', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'g', 'gram', 'grams', 'kg', 'ml', 'l', 'liter', 'liters', 'qt', 'quart', 'quarts', 'pt', 'pint', 'pints', 'gal', 'gallon',
  'can', 'cans', 'jar', 'jars', 'clove', 'cloves', 'pkg', 'package', 'packages', 'bag', 'bags', 'box', 'boxes', 'bunch', 'bunches',
  'pinch', 'dash', 'dozen', 'head', 'heads', 'stick', 'sticks', 'slice', 'slices', 'sprig', 'sprigs', 'handful'];
const UNIT_RE = new RegExp(`^(?:${UNITS.join('|')})\\.?(?=\\s|$)`, 'i');
const NUM = String.raw`(?:\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?\s*[¼½¾⅓⅔⅛]?|[¼½¾⅓⅔⅛])`;
const QTY_RE = new RegExp(String.raw`^(?:about\s+)?${NUM}(?:\s*(?:-|–|to)\s*${NUM})?`, 'i');

/** Ingredient lines from pasted text: bullets and numbering removed, blanks and section headers ("For the sauce:") skipped. */
export function ingredientLines(text) {
  return String(text || '').split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·▢□◦]|\d+[.)](?!\d))\s*/, '').trim())
    .filter((l) => l && !/:$/.test(l) && !/^ingredients?$/i.test(l));
}

/** "1 1/2 lb chicken thighs, trimmed" -> { name: 'chicken thighs', qty: '1 1/2 lb' }. */
export function parseIngredient(line) {
  let rest = String(line || '').trim(), qty = '';
  const q = rest.match(QTY_RE);
  if (q && q[0].trim()) {
    qty = q[0].trim();
    rest = rest.slice(q[0].length).trim();
    const paren = rest.match(/^\([^)]*\)\s*/); // "1 (15 oz) can"
    if (paren) { qty += ` ${paren[0].trim()}`; rest = rest.slice(paren[0].length); }
    const u = rest.match(UNIT_RE);
    if (u) { qty += ` ${u[0]}`; rest = rest.slice(u[0].length).trim(); }
    rest = rest.replace(/^of\s+/i, '');
  }
  // Prep notes after a comma aren't part of what to buy.
  let name = rest.split(/,\s*/)[0].replace(/\s*\((?:optional|to taste)\)\s*$/i, '').trim();
  if (!name) name = String(line || '').trim();
  return { name: name.slice(0, 80), qty };
}

const stem = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  .split(' ').map((w) => (w.length > 3 ? w.replace(/(?:es|s)$/, '') : w)).join(' ');

/** Whether an ingredient is something already in the kitchen (by name, loosely: "chicken thighs" ~ "Chicken thigh"). */
export function inKitchen(name, kitchenNames) {
  const n = stem(name);
  if (!n) return false;
  return kitchenNames.some((k) => {
    const s = stem(k);
    if (!s) return false;
    if (s === n) return true;
    // Whole-word containment either way: "shredded cheese" has "cheese"; "olive oil" isn't "oil" in "foil".
    const pad = (x) => ` ${x} `;
    return (s.length >= 4 && pad(n).includes(pad(s))) || (n.length >= 4 && pad(s).includes(pad(n)));
  });
}

const HEAD = {
  ingredients: /^(?:ingredients?)\s*:?\s*$/i,
  steps: /^(?:steps?|instructions?|directions?|method|preparation|how to make it)\s*:?\s*$/i,
  notes: /^(?:notes?|tips?)\s*:?\s*$/i
};

/** A recipe pasted back from an AI chat (or a website): title, ingredients, steps, notes, and a link if there is one. */
/** How a recipe is cooked. Keys are stored; labels are shown and sent to the AI. */
export const METHODS = [['stove', 'Stove'], ['oven', 'Oven'], ['sheet_pan', 'Sheet pan'], ['air_fryer', 'Air fryer'], ['pressure_cooker', 'Pressure cooker'],
  ['slow_cooker', 'Slow cooker'], ['grill', 'Grill'], ['microwave', 'Microwave'], ['no_cook', 'No cook']];
export const methodLabel = (k) => (METHODS.find((m) => m[0] === k) || [null, ''])[1];
/** "Slow cooker (low 6 hours)" -> 'slow_cooker'. Most specific first: "sheet pan in the oven" is a sheet pan. */
export function methodKey(text) {
  const t = String(text || '').toLowerCase();
  const rules = [['sheet_pan', /sheet[ -]?pan/], ['slow_cooker', /slow[ -]?cooker|crock[ -]?pot/], ['pressure_cooker', /pressure[ -]?cooker|instant[ -]?pot/],
    ['air_fryer', /air[ -]?fr/], ['grill', /grill/], ['microwave', /microwave/], ['no_cook', /no[ -]?cook/], ['oven', /oven|bake|roast/], ['stove', /stove|skillet|pan|pot|saut/]];
  const hit = rules.find(([, re]) => re.test(t));
  return hit ? hit[0] : null;
}

export function parsePasted(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = { title: '', ingredients: [], steps: [], notes: [], source_url: null, method: null };
  let part = null;
  for (let raw of lines) {
    const l = raw.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    if (!l) continue;
    const url = l.match(/https?:\/\/\S+/);
    if (url && !out.source_url) { out.source_url = url[0].replace(/[).,]+$/, ''); if (l === url[0]) continue; }
    const mm = l.match(/^(?:method|how to cook|cook(?:ing)? method|cook with)\s*:\s*(.+)$/i);
    if (mm) { out.method = methodKey(mm[1]); continue; }
    const h = Object.keys(HEAD).find((k) => HEAD[k].test(l));
    if (h) { part = h; continue; }
    if (!out.title && !part) { out.title = l.replace(/^(?:recipe|title)\s*:\s*/i, '').replace(/[:.]$/, ''); continue; }
    if (part === 'ingredients') out.ingredients.push(...ingredientLines(l));
    else if (part === 'steps') out.steps.push(l.replace(/^\s*(?:[-*•]|\d+[.)](?!\d)|step \d+[:.]?)\s*/i, ''));
    else if (part) out.notes.push(l);
    else out.notes.push(l); // text between the title and the first heading
  }
  return {
    title: (out.title || 'New recipe').slice(0, 120),
    ingredients: out.ingredients.join('\n') || null,
    steps: out.steps.join('\n') || null,
    notes: out.notes.join('\n') || null,
    source_url: out.source_url,
    method: out.method
  };
}

/**
 * The Copy for AI message.
 * kitchen: { Fridge: [...], Freezer: [...], ... }, low: [...], out: [...]
 * days: [{ label: 'Mon', dinner: 'Chicken tacos' | null, lunch?: string | null }]
 * recipes: [{ title, ingredients }]
 */
export function buildPrompt({ range, kitchen, low, out, days, recipes, lunch = false, gear = [], recent = [] }) {
  const L = [];
  L.push(`Help me plan ${lunch ? 'lunches and dinners' : 'dinners'} for ${range} for our family: two adults and two young kids. Keep weeknights simple; one-pot and sheet-pan meals are good options.`);
  if (gear.length) L.push(`Appliances we have: ${gear.join(', ')}. Only use these.`);
  L.push('');
  L.push('In the kitchen now:');
  const places = Object.entries(kitchen).filter(([, xs]) => xs.length);
  if (places.length) for (const [where, xs] of places) L.push(`${where}: ${xs.join(', ')}`);
  else L.push('(nothing tracked yet)');
  if (low.length) L.push(`Running low: ${low.join(', ')}`);
  if (out.length) L.push(`Out: ${out.join(', ')}`);
  L.push('');
  const meals = lunch ? ['dinner', 'lunch'] : ['dinner'];
  for (const m of meals) {
    const planned = days.filter((d) => d[m]).map((d) => `${d.label} ${d[m]}`);
    const open = days.filter((d) => !d[m]).map((d) => d.label);
    const word = m === 'dinner' ? 'Dinners' : 'Lunches';
    L.push(`${word} planned: ${planned.length ? planned.join('; ') : 'none yet'}.`);
    if (open.length) L.push(`${word} still open: ${open.join(', ')}.`);
  }
  const away = days.filter((d) => d.away).map((d) => d.label), call = days.filter((d) => d.onCall).map((d) => d.label);
  if (away.length) L.push(`Shift nights: ${away.join(', ')}. One adult is at work over dinner, so those dinners are just for one adult and the kids: smaller and quick.`);
  if (call.length) L.push(`On call: ${call.join(', ')}. One adult might get called in, so keep those dinners flexible.`);
  if (recent.length) L.push(`Recent dinners (we like variety, so avoid repeating these): ${recent.join(', ')}.`);
  L.push('');
  if (recipes.length) {
    const favs = recipes.filter((r) => r.favorite).map((r) => r.title);
    if (favs.length) L.push(`Our favorites (we’d happily have these again): ${favs.join(', ')}.`);
    L.push('Recipes we already like:');
    for (const r of recipes) {
      const ing = ingredientLines(r.ingredients).map((x) => parseIngredient(x).name);
      const tags = [methodLabel(r.method).toLowerCase(), r.quick && 'quick', r.kid_friendly && 'kids like it'].filter(Boolean);
      L.push(`- ${r.title}${tags.length ? ` [${tags.join(', ')}]` : ''}${ing.length ? ` (${ing.slice(0, 12).join(', ')})` : ''}`);
    }
    L.push('');
  }
  L.push('Suggest meals for the open days that use what we have first, and say what we’d need to buy.');
  L.push('');
  L.push('Then end your answer with these two parts exactly, so my app can read them:');
  L.push('1. A line that says PLAN, then one line per open day, like:');
  L.push('PLAN');
  const ex = days.filter((d) => !d.dinner).slice(0, 2).map((d) => d.label);
  L.push(`${ex[0] || 'Mon'}: Meal name`);
  if (lunch) L.push(`${ex[0] || 'Mon'} lunch: Meal name`);
  L.push(`${ex[1] || 'Tue'}: Meal name`);
  L.push('Use the exact title for any of our saved recipes.');
  L.push('2. For each meal that isn’t one of our saved recipes, a recipe in this shape:');
  L.push('RECIPE: Title');
  L.push(`Method: one of ${METHODS.map((m) => m[1].toLowerCase()).join(', ')}`);
  L.push('Ingredients');
  L.push('(one per line, with amounts)');
  L.push('Steps');
  L.push('(one per line)');
  L.push('END');
  return L.join('\n');
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const clean = (s) => String(s || '').replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*•]|\d+[.)](?!\d))\s*/, '').trim();
export const sameTitle = (a, b) => {
  const k = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return !!k(a) && k(a) === k(b);
};

/**
 * Read an AI reply: the PLAN lines and any RECIPE blocks.
 * days: the week's dates in order, Monday first ('YYYY-MM-DD').
 * Returns { slots: [{ date, meal, title }], recipes: [{ title, ingredients, steps, notes, source_url }] }.
 */
export function parsePlan(text, days) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const byDay = {};
  for (const d of days) byDay[DAYS[S.weekdayOf(d)]] = d;
  const slots = [], recipes = [];
  const start = lines.findIndex((l) => /^\s*(?:#+\s*)?\**\s*PLAN\b/i.test(l));
  const dayRe = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?(?:\s*\([^)]*\))?\s*(lunch|dinner)?\s*[:\-–—]\s*(.+)$/i;
  for (let i = start < 0 ? 0 : start + 1; i < lines.length; i++) {
    const l = clean(lines[i]);
    if (/^RECIPE\s*:/i.test(l)) break;
    const m = l.match(dayRe);
    if (!m) { if (start >= 0 && slots.length && !l) continue; continue; }
    const date = byDay[m[1].toLowerCase().slice(0, 3)];
    let title = m[3].replace(/\s*[([](?:new|new recipe|saved|recipe below)[)\]]\s*/gi, ' ').replace(/\s+[-–—]\s+.*$/, '').replace(/[.]+$/, '').trim();
    if (!date || !title) continue;
    const meal = (m[2] || 'dinner').toLowerCase();
    const j = slots.findIndex((x) => x.date === date && x.meal === meal);
    if (j >= 0) slots[j].title = title.slice(0, 120); else slots.push({ date, meal, title: title.slice(0, 120) });
  }
  // RECIPE: Title ... END
  let cur = null;
  for (const raw of lines) {
    const l = clean(raw);
    const h = l.match(/^RECIPE\s*:\s*(.+)$/i);
    if (h) { if (cur) recipes.push(cur); cur = [h[1]]; continue; }
    if (!cur) continue;
    if (/^END\b/i.test(l)) { recipes.push(cur); cur = null; continue; }
    cur.push(raw);
  }
  if (cur) recipes.push(cur);
  return { slots, recipes: recipes.map((r) => parsePasted(r.join('\n'))).filter((r) => r.title && r.title !== 'New recipe') };
}

/** Freezer items a recipe needs: the freezer names whose item shows up in its ingredients. */
export function freezerHits(ingredientsText, freezerNames) {
  const ing = ingredientLines(ingredientsText).map((l) => parseIngredient(l).name);
  return freezerNames.filter((f) => ing.some((n) => inKitchen(n, [f])));
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago". */
export function agoLabel(date, today) {
  const d = Math.round((S.parse(today) - S.parse(date)) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}

/**
 * Ask for one replacement meal. want: what sounds good ("something lighter", "Mexican").
 * Shares the kitchen and recipe context with buildPrompt, and asks for the same PLAN / RECIPE ending.
 */
export function buildSwapPrompt({ day, meal = 'dinner', current, want, kitchen, low, out, recipes, gear = [], away = false, recent = [] }) {
  const L = [];
  const what = meal === 'lunch' ? 'lunch' : 'dinner';
  L.push(`Help me pick a different ${what} for ${day} for our family: two adults and two young kids.${current ? ` We had planned ${current}, but we’d like something else.` : ''}`);
  if (want && want.trim()) L.push(`What sounds good: ${want.trim()}.`);
  if (away) L.push('One adult is at work over dinner that night, so it’s just for one adult and the kids: smaller and quick.');
  if (gear.length) L.push(`Appliances we have: ${gear.join(', ')}. Only use these.`);
  L.push('');
  const places = Object.entries(kitchen).filter(([, xs]) => xs.length);
  if (places.length) { L.push('In the kitchen now:'); for (const [where, xs] of places) L.push(`${where}: ${xs.join(', ')}`); }
  if (low.length) L.push(`Running low: ${low.join(', ')}`);
  if (out.length) L.push(`Out: ${out.join(', ')}`);
  if (recent.length) L.push(`Recent dinners (avoid repeating): ${recent.join(', ')}.`);
  if (recipes.length) L.push(`Our saved recipes: ${recipes.map((r) => r.title).join(', ')}.`);
  L.push('');
  L.push('Give me two or three ideas, then pick the best one and end your answer exactly like this, so my app can read it:');
  L.push('PLAN');
  L.push(`${day}${meal === 'lunch' ? ' lunch' : ''}: Meal name`);
  L.push('If it isn’t one of our saved recipes, add:');
  L.push('RECIPE: Title');
  L.push(`Method: one of ${METHODS.map((m) => m[1].toLowerCase()).join(', ')}`);
  L.push('Ingredients');
  L.push('(one per line, with amounts)');
  L.push('Steps');
  L.push('(one per line)');
  L.push('END');
  return L.join('\n');
}

// Things nearly every kitchen has that aren't worth a grocery line.
const BASICS = ['salt', 'pepper', 'black pepper', 'salt and pepper', 'kosher salt', 'water', 'ice', 'cooking spray'];

/** What a recipe needs that isn't in the kitchen or already on the list: [{ name, qty }], names capitalized. */
export function missingFor(ingredientsText, haveNames, listedNames) {
  const out = [];
  for (const line of ingredientLines(ingredientsText)) {
    const p = parseIngredient(line);
    const n = p.name.toLowerCase().replace(/\s*\(.*\)$/, '').trim();
    if (!n || BASICS.includes(n) || /\bto taste\b/i.test(line)) continue;
    if (inKitchen(p.name, haveNames) || listedNames.some((l) => sameTitle(l, p.name) || inKitchen(p.name, [l]))) continue;
    if (out.some((o) => sameTitle(o.name, p.name))) continue;
    out.push({ name: p.name.charAt(0).toUpperCase() + p.name.slice(1), qty: p.qty });
  }
  return out;
}
