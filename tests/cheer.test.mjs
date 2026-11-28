// Run: node --test tests/cheer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINES, shouldCheer, pickCheer } from '../js/cheer.js';

test('big moments always cheer; small ones about half the time', () => {
  assert.ok(shouldCheer('allDone', 0.99));
  assert.ok(shouldCheer('grocery', 0.99));
  assert.ok(shouldCheer('chore', 0.2));
  assert.ok(!shouldCheer('chore', 0.8));
});

test('lines fill in the partner name, and skip name lines when there is none', () => {
  const withName = LINES.chore.map((_, i) => pickCheer('chore', { partner: 'Alex', roll: i / LINES.chore.length + 0.001, roll2: 0.9 }).text);
  assert.ok(withName.some((t) => t.includes('Alex')));
  assert.ok(withName.every((t) => !t.includes('{p}')));
  for (let i = 0; i < 20; i++) assert.ok(!pickCheer('chore', { roll: i / 20, roll2: 0.9 }).text.includes('{p}'));
});

test('a partner note wins half the time, always when all done, unseen first', () => {
  const notes = [{ id: 'a', text: 'Love you', from: 'Alex' }, { id: 'b', text: 'Thank you', from: 'Alex' }];
  assert.equal(pickCheer('chore', { notes, roll: 0, roll2: 0.9 }).noteId, null);
  assert.equal(pickCheer('chore', { notes, seen: ['a'], roll: 0, roll2: 0.1 }).noteId, 'b');
  const all = pickCheer('allDone', { notes, seen: ['a', 'b'], roll: 0.6, roll2: 0.99 });
  assert.equal(all.noteId, 'b');
  assert.equal(all.from, 'Alex');
});
