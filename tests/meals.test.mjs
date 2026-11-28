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
  assert.match(buildPrompt({ ...base, gear: ['oven', 'air fryer'] }), /We cook with: oven, air fryer\./);
  assert.doesNotMatch(buildPrompt(base), /cook with/);
});
