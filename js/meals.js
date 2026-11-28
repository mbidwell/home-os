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
    .map((l) => l.replace(/^\s*(?:[-*•·▢□◦]|\d+[.)])\s*/, '').trim())
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
export function parsePasted(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = { title: '', ingredients: [], steps: [], notes: [], source_url: null };
  let part = null;
  for (let raw of lines) {
    const l = raw.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    if (!l) continue;
    const url = l.match(/https?:\/\/\S+/);
    if (url && !out.source_url) { out.source_url = url[0].replace(/[).,]+$/, ''); if (l === url[0]) continue; }
    const h = Object.keys(HEAD).find((k) => HEAD[k].test(l));
    if (h) { part = h; continue; }
    if (!out.title && !part) { out.title = l.replace(/^(?:recipe|title)\s*:\s*/i, '').replace(/[:.]$/, ''); continue; }
    if (part === 'ingredients') out.ingredients.push(...ingredientLines(l));
    else if (part === 'steps') out.steps.push(l.replace(/^\s*(?:[-*•]|\d+[.)]|step \d+[:.]?)\s*/i, ''));
    else if (part) out.notes.push(l);
    else out.notes.push(l); // text between the title and the first heading
  }
  return {
    title: (out.title || 'New recipe').slice(0, 120),
    ingredients: out.ingredients.join('\n') || null,
    steps: out.steps.join('\n') || null,
    notes: out.notes.join('\n') || null,
    source_url: out.source_url
  };
}

/**
 * The Copy for AI message.
 * kitchen: { Fridge: [...], Freezer: [...], ... }, low: [...], out: [...]
 * days: [{ label: 'Mon', dinner: 'Chicken tacos' | null, lunch?: string | null }]
 * recipes: [{ title, ingredients }]
 */
export function buildPrompt({ range, kitchen, low, out, days, recipes, lunch = false, gear = [] }) {
  const L = [];
  L.push(`Help me plan ${lunch ? 'lunches and dinners' : 'dinners'} for ${range} for our family: two adults and two young kids. Keep weeknights simple; one-pot and sheet-pan meals are good options.`);
  if (gear.length) L.push(`We cook with: ${gear.join(', ')}. Recipes that use these are great.`);
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
  L.push('');
  if (recipes.length) {
    L.push('Recipes we already like:');
    for (const r of recipes) {
      const ing = ingredientLines(r.ingredients).map((x) => parseIngredient(x).name);
      L.push(`- ${r.title}${ing.length ? ` (${ing.slice(0, 12).join(', ')})` : ''}`);
    }
    L.push('');
  }
  L.push('Suggest meals for the open days that use what we have first, and say what we’d need to buy.');
  L.push('For any new idea, write it as a recipe with a title line, then "Ingredients" (one per line), then "Steps", so I can paste it straight into my recipe box.');
  return L.join('\n');
}
