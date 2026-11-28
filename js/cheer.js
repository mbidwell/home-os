// Little cheers when something gets done. Pure functions (tests in tests/cheer.test.mjs).

// Short, warm, a little silly. {p} is the partner's name; lines with it are skipped if there's no name.
export const LINES = {
  chore: [
    'Look at you. Running a household like it’s nothing.',
    'Done. The house says thank you.',
    'One less thing. You’re on a roll.',
    'The dishes fear you. As they should.',
    'Chore defeated. Victory dance optional, but encouraged.',
    'That counts. That totally counts.',
    'Future you is very grateful.',
    'Crushed it. Quietly. Like a pro.',
    '{p} would be proud. ({p} is proud.)',
    'Small win. Those add up.'
  ],
  task: [
    'Checked off. That one’s been waiting.',
    'Done and done.',
    'Look at you go.',
    'Another one off the list. Hero behavior.',
    'You said you’d do it, and you did it.'
  ],
  grocery: [
    'Groceries: handled. The fridge thanks you.',
    'Shopping done. You deserve a snack from the bag.',
    'Full cart, full heart.',
    'Everyone eats this week because of you.'
  ],
  meals: [
    'Dinners planned. Future-you says thanks.',
    'A whole week of dinners. That’s real love.',
    'No “what’s for dinner?” this week. Legendary.'
  ],
  allDone: [
    'Everything for today is done. Go sit down. Seriously.',
    'All clear. You earned the rest of the day.',
    'Today: conquered.',
    'That’s everything. You’re amazing, you know that?'
  ]
};

/** Every so often, not every time: always for big moments, about half the time for small ones. */
export function shouldCheer(kind, roll) {
  if (kind === 'allDone' || kind === 'meals' || kind === 'grocery') return true;
  return roll < 0.5;
}

/**
 * Pick a cheer. notes: [{ id, text, from }] written for this person. seen: ids already shown on this phone.
 * About half the time (always for allDone) a note from the partner wins, unseen ones first.
 * Returns { text, from: name | null, noteId: id | null }.
 */
export function pickCheer(kind, { partner = '', notes = [], seen = [], roll = Math.random(), roll2 = Math.random() } = {}) {
  const useNote = notes.length && (kind === 'allDone' || roll2 < 0.5);
  if (useNote) {
    const fresh = notes.filter((n) => !seen.includes(n.id));
    const pool = fresh.length ? fresh : notes;
    const n = pool[Math.floor(roll * pool.length) % pool.length];
    return { text: n.text, from: n.from || partner || null, noteId: n.id };
  }
  const lines = (LINES[kind] || LINES.chore).filter((l) => partner || !l.includes('{p}'));
  const l = lines[Math.floor(roll * lines.length) % lines.length];
  return { text: l.replaceAll('{p}', partner), from: null, noteId: null };
}
