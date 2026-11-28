// Run: node --test tests/meals.test.mjs   (sample data is made up)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekStart, ingredientLines, parseIngredient, inKitchen, parsePasted, buildPrompt } from '../js/meals.js';

test('weeks start on Monday', () => {
  assert.equal(weekStart('2026-11-30'), '2026-11-30'); // Monday
  assert.equal(weekStart('2026-12-03'), '2026-11-30');
  assert.equal(weekStart('2026-12-06'), '2026-11-30'); // Sunday belongs to the week before it
  assert.equal(weekStart('2026-11-28'), '2026-11-23');
});

test('ingredient lines drop bullets, numbers, blanks, and section headers', () => {
  assert.deepEqual(ingredientLines('Ingredients\n- 2 limes\n• 1 onion\n\nFor the sauce:\n3) salt\n▢ 1 cup rice'), ['2 limes', '1 onion', 'salt', '1 cup rice']);
});

test('quantities and units come off the name; prep notes are dropped', () => {
  assert.deepEqual(parseIngredient('1 1/2 lb chicken thighs, trimmed'), { name: 'chicken thighs', qty: '1 1/2 lb' });
  assert.deepEqual(parseIngredient('½ cup shredded cheese'), { name: 'shredded cheese', qty: '½ cup' });
  assert.deepEqual(parseIngredient('2-3 cloves garlic, minced'), { name: 'garlic', qty: '2-3 cloves' });
  assert.deepEqual(parseIngredient('1 (15 oz) can black beans'), { name: 'black beans', qty: '1 (15 oz) can' });
  assert.deepEqual(parseIngredient('2 cups of milk'), { name: 'milk', qty: '2 cups' });
  assert.deepEqual(parseIngredient('Taco seasoning'), { name: 'Taco seasoning', qty: '' });
  assert.deepEqual(parseIngredient('8 small tortillas'), { name: 'small tortillas', qty: '8' });
  assert.equal(parseIngredient('Salt (to taste)').name, 'Salt');
});

test('kitchen match is loose on plurals but whole-word', () => {
  const k = ['Chicken thigh', 'Shredded cheese', 'Olive oil', 'Foil', 'Rice'];
  assert.ok(inKitchen('chicken thighs', k));
  assert.ok(inKitchen('cheese', k));
  assert.ok(inKitchen('olive oil', k));
  assert.ok(!inKitchen('oil', ['Foil']));
  assert.ok(!inKitchen('limes', k));
  assert.ok(!inKitchen('rice vinegar', ['Ric']));
  assert.ok(inKitchen('rice', k));
});

test('a pasted recipe splits into title, ingredients, steps, notes', () => {
  const r = parsePasted('## One-Pan Lemon Chicken\nQuick weeknight dinner.\n\n**Ingredients:**\n- 4 chicken thighs\n- 2 lemons\n\n**Steps:**\n1. Heat the pan.\n2. Sear the chicken.\n\nNotes\nKids like extra lemon.\nhttps://example.com/lemon-chicken');
  assert.equal(r.title, 'One-Pan Lemon Chicken');
  assert.equal(r.ingredients, '4 chicken thighs\n2 lemons');
  assert.equal(r.steps, 'Heat the pan.\nSear the chicken.');
  assert.equal(r.notes, 'Quick weeknight dinner.\nKids like extra lemon.');
  assert.equal(r.source_url, 'https://example.com/lemon-chicken');
});

test('pasting with no headings still keeps the text', () => {
  const r = parsePasted('Leftover fried rice\nUse yesterday’s rice.');
  assert.equal(r.title, 'Leftover fried rice');
  assert.equal(r.notes, 'Use yesterday’s rice.');
  assert.equal(r.ingredients, null);
});

test('prompt lists the kitchen, the plan, open days, and recipes', () => {
  const p = buildPrompt({
    range: 'Nov 30 – Dec 6',
    kitchen: { Fridge: ['Yogurt'], Freezer: ['Frozen peas'], Pantry: [] },
    low: ['Rice'], out: ['Milk'],
    days: [{ label: 'Mon', dinner: 'Chicken tacos' }, { label: 'Tue', dinner: null }],
    recipes: [{ title: 'Chicken tacos', ingredients: '1 lb chicken\n8 tortillas' }]
  });
  assert.match(p, /dinners for Nov 30 – Dec 6/);
  assert.match(p, /one-pot and sheet-pan/);
  assert.match(p, /Fridge: Yogurt/);
  assert.doesNotMatch(p, /Pantry:/);
  assert.match(p, /Running low: Rice/);
  assert.match(p, /Out: Milk/);
  assert.match(p, /Dinners planned: Mon Chicken tacos\./);
  assert.match(p, /Dinners still open: Tue\./);
  assert.match(p, /- Chicken tacos \(chicken, tortillas\)/);
  assert.doesNotMatch(p, /unch/);
});

test('lunch shows up only when it is turned on', () => {
  const p = buildPrompt({ range: 'x', kitchen: {}, low: [], out: [], days: [{ label: 'Mon', dinner: 'Soup', lunch: null }], recipes: [], lunch: true });
  assert.match(p, /lunches and dinners/);
  assert.match(p, /Lunches still open: Mon\./);
});

test('cooking gear is mentioned when set, and left out when not', () => {
  const base = { range: 'x', kitchen: {}, low: [], out: [], days: [], recipes: [] };
  assert.match(buildPrompt({ ...base, gear: ['oven', 'air fryer'] }), /Appliances we have: oven, air fryer\. Only use these\./);
  assert.doesNotMatch(buildPrompt(base), /Appliances/);
});

import { parsePlan, sameTitle } from '../js/meals.js';
const WEEK = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];

test('the prompt asks for a PLAN block and RECIPE blocks', () => {
  const p = buildPrompt({ range: 'x', kitchen: {}, low: [], out: [], days: [{ label: 'Mon', dinner: 'Tacos' }, { label: 'Thu', dinner: null }, { label: 'Sun', dinner: null }], recipes: [] });
  assert.match(p, /\nPLAN\nThu: Meal name\nSun: Meal name/);
  assert.match(p, /RECIPE: Title/);
  assert.match(p, /\nEND$/);
});

test('a pasted reply fills days and brings new recipes', () => {
  const reply = `Here are some ideas for your open nights!

**PLAN**
- **Thursday:** Sheet pan gnocchi (new)
- Sun – Chicken tacos
Wed lunch: Turkey wraps
Fri: Pizza night

RECIPE: Sheet pan gnocchi
Ingredients
- 1 lb gnocchi
- 1 pint cherry tomatoes
Steps
1. Heat the oven to 425.
2. Roast everything 20 minutes.
END

Enjoy!`;
  const r = parsePlan(reply, WEEK);
  assert.deepEqual(r.slots, [
    { date: '2026-12-03', meal: 'dinner', title: 'Sheet pan gnocchi' },
    { date: '2026-12-06', meal: 'dinner', title: 'Chicken tacos' },
    { date: '2026-12-02', meal: 'lunch', title: 'Turkey wraps' },
    { date: '2026-12-04', meal: 'dinner', title: 'Pizza night' }
  ]);
  assert.equal(r.recipes.length, 1);
  assert.equal(r.recipes[0].title, 'Sheet pan gnocchi');
  assert.equal(r.recipes[0].ingredients, '1 lb gnocchi\n1 pint cherry tomatoes');
  assert.equal(r.recipes[0].steps, 'Heat the oven to 425.\nRoast everything 20 minutes.');
});

test('day lines outside a PLAN block still count when there is no PLAN line', () => {
  assert.deepEqual(parsePlan('Mon: Soup\nnothing else', WEEK).slots, [{ date: '2026-11-30', meal: 'dinner', title: 'Soup' }]);
  assert.deepEqual(parsePlan('just chatting, no plan here', WEEK).slots, []);
});

test('titles match saved recipes loosely', () => {
  assert.ok(sameTitle('Chicken Tacos!', 'chicken tacos'));
  assert.ok(!sameTitle('Chicken tacos', 'Fish tacos'));
});

test('favorites are called out in the prompt', () => {
  const p = buildPrompt({ range: 'x', kitchen: {}, low: [], out: [], days: [], recipes: [{ title: 'Chili', favorite: true }, { title: 'Soup' }] });
  assert.match(p, /Our favorites \(we’d happily have these again\): Chili\./);
  assert.doesNotMatch(buildPrompt({ range: 'x', kitchen: {}, low: [], out: [], days: [], recipes: [{ title: 'Soup' }] }), /favorites/);
});

import { freezerHits, agoLabel } from '../js/meals.js';

test('shift nights, on-call nights, recent dinners, and tags reach the prompt', () => {
  const p = buildPrompt({ range: 'x', kitchen: {}, low: [], out: [],
    days: [{ label: 'Thu', dinner: null, away: true }, { label: 'Fri', dinner: null, onCall: true }, { label: 'Sat', dinner: null }],
    recipes: [{ title: 'Tacos', quick: true, kid_friendly: true }, { title: 'Stew' }], recent: ['Chili', 'Soup'] });
  assert.match(p, /Shift nights: Thu\. One adult is at work over dinner/);
  assert.match(p, /On call: Fri\./);
  assert.match(p, /avoid repeating these\): Chili, Soup\./);
  assert.match(p, /- Tacos \[quick, kids like it\]/);
  assert.match(p, /- Stew\n/);
});

test('thaw: freezer items a recipe uses', () => {
  assert.deepEqual(freezerHits('1.5 lb chicken thighs\n8 tortillas\n2 cups frozen peas', ['Chicken thigh', 'Frozen peas', 'Ice cream']), ['Chicken thigh', 'Frozen peas']);
  assert.deepEqual(freezerHits('', ['Chicken']), []);
});

test('last had labels', () => {
  assert.equal(agoLabel('2026-11-28', '2026-11-28'), 'today');
  assert.equal(agoLabel('2026-11-27', '2026-11-28'), 'yesterday');
  assert.equal(agoLabel('2026-11-20', '2026-11-28'), '8 days ago');
  assert.equal(agoLabel('2026-11-07', '2026-11-28'), '3 weeks ago');
  assert.equal(agoLabel('2026-08-28', '2026-11-28'), '3 months ago');
});

import { methodKey, methodLabel } from '../js/meals.js';
test('how to cook: read from text, most specific first', () => {
  assert.equal(methodKey('Slow cooker, low 6 hours'), 'slow_cooker');
  assert.equal(methodKey('Crock-Pot'), 'slow_cooker');
  assert.equal(methodKey('sheet pan in the oven'), 'sheet_pan');
  assert.equal(methodKey('Instant Pot'), 'pressure_cooker');
  assert.equal(methodKey('Air fryer'), 'air_fryer');
  assert.equal(methodKey('Bake at 400'), 'oven');
  assert.equal(methodKey('skillet'), 'stove');
  assert.equal(methodKey('whatever'), null);
  assert.equal(methodLabel('sheet_pan'), 'Sheet pan');
});

test('a pasted recipe keeps its method, and the prompt asks for one', () => {
  assert.equal(parsePasted('Gnocchi\nMethod: Sheet pan\nIngredients\n- gnocchi').method, 'sheet_pan');
  assert.equal(parsePasted('Gnocchi\nIngredients\n- gnocchi').method, null);
  const p = buildPrompt({ range: 'x', kitchen: {}, low: [], out: [], days: [], recipes: [{ title: 'Chili', method: 'slow_cooker', quick: true }] });
  assert.match(p, /RECIPE: Title\nMethod: one of stove, oven, sheet pan/);
  assert.match(p, /- Chili \[slow cooker, quick\]/);
});

import { buildSwapPrompt } from '../js/meals.js';
test('swap prompt asks for one meal for that day, with the request', () => {
  const p = buildSwapPrompt({ day: 'Thu', current: 'Chili', want: 'something lighter, maybe fish', kitchen: { Fridge: ['Yogurt'] }, low: [], out: [], recipes: [{ title: 'Tacos' }], away: true });
  assert.match(p, /different dinner for Thu/);
  assert.match(p, /We had planned Chili/);
  assert.match(p, /What sounds good: something lighter, maybe fish\./);
  assert.match(p, /smaller and quick/);
  assert.match(p, /\nPLAN\nThu: Meal name\n/);
  assert.match(p, /Our saved recipes: Tacos\./);
  // and the reply reads back as one slot
  const r = parsePlan('Ideas...\nPLAN\nThu: Lemon salmon\nRECIPE: Lemon salmon\nMethod: sheet pan\nIngredients\n2 salmon fillets\nSteps\nBake.\nEND', WEEK);
  assert.deepEqual(r.slots, [{ date: '2026-12-03', meal: 'dinner', title: 'Lemon salmon' }]);
  assert.equal(r.recipes[0].method, 'sheet_pan');
});

test('a decimal amount is not mistaken for list numbering', () => {
  assert.deepEqual(ingredientLines('1.5 lb chicken thighs\n2. 1 onion\n0.5 cup rice'), ['1.5 lb chicken thighs', '1 onion', '0.5 cup rice']);
  assert.deepEqual(parseIngredient(ingredientLines('1.5 lb chicken thighs')[0]), { name: 'chicken thighs', qty: '1.5 lb' });
});

import { missingFor } from '../js/meals.js';
test('auto-add: only what is missing, never basics', () => {
  const ing = '1.5 lb chicken thighs\n8 tortillas\n1 cup shredded cheese\nSalt and pepper\n2 limes\nOlive oil, to taste\n2 limes';
  assert.deepEqual(missingFor(ing, ['Shredded cheese', 'Chicken thigh'], ['Tortillas']), [{ name: 'Limes', qty: '2' }]);
  assert.deepEqual(missingFor('', [], []), []);
});
