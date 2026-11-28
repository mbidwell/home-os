// Run: node --test tests/aisles.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aisleOf, aisleRank } from '../js/aisles.js';

test('items land in the right aisle', () => {
  assert.equal(aisleOf('Bananas'), 'Produce');
  assert.equal(aisleOf('Frozen peas'), 'Frozen');
  assert.equal(aisleOf('Frozen berries'), 'Frozen');
  assert.equal(aisleOf('Chicken thighs'), 'Meat & seafood');
  assert.equal(aisleOf('Shredded cheese'), 'Dairy & eggs');
  assert.equal(aisleOf('Eggs'), 'Dairy & eggs');
  assert.equal(aisleOf('Milk'), 'Drinks');
  assert.equal(aisleOf('Sourdough bread'), 'Bakery');
  assert.equal(aisleOf('Tortillas'), 'Bakery');
  assert.equal(aisleOf('Crushed tomatoes'), 'Pantry');
  assert.equal(aisleOf('Tomatoes'), 'Produce');
  assert.equal(aisleOf('Olive oil'), 'Pantry');
  assert.equal(aisleOf('Paper towels'), 'Household');
  assert.equal(aisleOf('Diapers'), 'Baby & kids');
  assert.equal(aisleOf('Coffee beans'), 'Drinks');
  assert.equal(aisleOf('Birthday candles'), 'Household');
  assert.equal(aisleOf('Green beans'), 'Produce');
  assert.equal(aisleOf('Black beans'), 'Pantry');
});

test('a Costco category helps when the name does not', () => {
  assert.equal(aisleOf('Mystery item', 'Freezer'), 'Frozen');
  assert.equal(aisleOf('Mystery item'), 'Other');
  assert.ok(aisleRank('Produce') < aisleRank('Frozen'));
  assert.equal(aisleRank('Nope'), 12);
});
