// Run: node --test tests/stock.test.mjs   (sample lists are made up)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStock } from '../js/stock.js';

const by = (xs) => Object.fromEntries(xs.map((x) => [x.name, `${x.location}/${x.status}`]));

test('places as headings, with low and out', () => {
  const r = by(parseStock('Fridge: milk, eggs, shredded cheese is low. Freezer: chicken thighs and frozen peas. Pantry: rice, we\'re out of olive oil.'));
  assert.deepEqual(r, {
    Milk: 'fridge/have', Eggs: 'fridge/have', 'Shredded cheese': 'fridge/low',
    'Chicken thighs': 'freezer/have', 'Frozen peas': 'freezer/have',
    Rice: 'pantry/have', 'Olive oil': 'pantry/out'
  });
});

test('natural speech, no punctuation between places', () => {
  const r = by(parseStock("in the fridge we have yogurt and butter\nin the garage freezer there's ice cream and burgers\nwe're out of coffee"));
  assert.equal(r.Yogurt, 'fridge/have');
  assert.equal(r.Butter, 'fridge/have');
  assert.equal(r['Ice cream'], 'garage_freezer/have');
  assert.equal(r.Burgers, 'garage_freezer/have');
  assert.equal(r.Coffee, 'garage_freezer/out');
});

test('a place at the end of one item applies to just that item', () => {
  const r = by(parseStock('milk, cereal in the pantry, bread', 'fridge'));
  assert.deepEqual(r, { Milk: 'fridge/have', Cereal: 'pantry/have', Bread: 'fridge/have' });
});

test('running low on a few things at once', () => {
  const r = by(parseStock('Pantry: running low on pasta, flour and sugar.'));
  assert.deepEqual(r, { Pasta: 'pantry/low', Flour: 'pantry/low', Sugar: 'pantry/low' });
});

test('filler words and counts are dropped; repeats keep the last', () => {
  const r = by(parseStock('we have a bag of carrots, two avocados, some apples. that\'s it. apples are low'));
  assert.deepEqual(r, { Carrots: 'fridge/have', Avocados: 'fridge/have', Apples: 'fridge/low' });
});
