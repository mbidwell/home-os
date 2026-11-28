// Run: node --test tests/fit.test.mjs   (sample data is made up)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessSize, sizeOf, slackFor, betterDay } from '../js/fit.js';

test('size guesses from the name, and a set size wins', () => {
  assert.equal(guessSize('Clean the bathrooms'), 'big');
  assert.equal(guessSize('Mow the lawn'), 'big');
  assert.equal(guessSize('Wash the bedding'), 'big');
  assert.equal(guessSize('Water the plants'), 'quick');
  assert.equal(guessSize('Take out recycling'), 'quick');
  assert.equal(guessSize('Change the air filter'), 'quick');
  assert.equal(sizeOf({ title: 'Water the plants', effort: 'big' }), 'big');
});

test('slack grows with how often a chore repeats', () => {
  assert.equal(slackFor({ every: 1, unit: 'week' }), 2);
  assert.equal(slackFor({ every: 1, unit: 'month' }), 7);
  assert.equal(slackFor({ every: 3, unit: 'month' }), 14);
});

const week = { '2026-12-01': 'busy', '2026-12-02': 'light', '2026-12-03': 'busy', '2026-12-04': 'free', '2026-12-05': 'free', '2026-11-30': 'busy', '2026-12-06': 'busy' };
const loadOf = (d) => week[d] || 'unknown';

test('busy due date moves to the nearest free day', () => {
  assert.equal(betterDay('2026-12-03', '2026-11-30', 2, loadOf), '2026-12-04');
});
test('a free day beats a closer light day', () => {
  assert.equal(betterDay('2026-12-01', '2026-11-30', 7, loadOf), '2026-12-04');
});
test('light is used when nothing is free in reach', () => {
  assert.equal(betterDay('2026-12-01', '2026-11-30', 1, loadOf), '2026-12-02');
});
test('never before today, and nothing to do on a free day or an overdue chore', () => {
  assert.equal(betterDay('2026-12-04', '2026-11-30', 7, loadOf), null);
  assert.equal(betterDay('2026-11-30', '2026-12-01', 7, loadOf), null);
  assert.equal(betterDay('2026-12-06', '2026-12-06', 0, loadOf), null); // nowhere to go
});
