// "Say it all": turn a dictated stock list into kitchen items. Pure (tests in tests/stock.test.mjs).
//   "Fridge: milk, eggs, shredded cheese is low. Freezer: chicken thighs. We're out of olive oil."

const PLACES = [
  ['garage_freezer', /\bgarage(?: freezer)?\b/],
  ['freezer', /\bfreezer\b|\bfrozen section\b/],
  ['pantry', /\bpantry\b|\bcabinets?\b|\bcupboards?\b/],
  ['fridge', /\bfridge\b|\brefrigerator\b/]
];
const placeIn = (t) => (PLACES.find(([, re]) => re.test(t)) || [null])[0];

const OUT = /\b(?:we(?:'re| are) out of|out of|no more|none left|ran out of|used up|all out of|we need|need)\b|\b(?:is|are) out\b|\bout\b$|\bgone\b$/;
const LOW = /\b(?:running low on|low on|almost out of|nearly out of|getting low|running low|is low|are low|low)\b/;
const FILLER = /^(?:and|also|plus|then|we have|we've got|we got|there's|there is|there are|got|have|some|a few|a couple of|a lot of|lots of|a bag of|a box of|a bottle of|a jar of|a carton of|the|a|an)\s+/;

const tidy = (s) => s.replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Returns [{ name, location, status }] in the order said. `fallback` is where items go when no place was named.
 * A place word ("Freezer:", "in the freezer") applies to what follows until another place is named;
 * "in the pantry" at the end of one item applies to that item only.
 */
export function parseStock(text, fallback = 'fridge') {
  const out = [];
  let place = null;
  const chunks = String(text || '').replace(/\r/g, '').split(/[\n.;!?]+/);
  for (let chunk of chunks) {
    chunk = chunk.toLowerCase().trim();
    if (!chunk) continue;
    // A heading like "freezer:" or "in the freezer we have" sets the place for what follows.
    const head = chunk.match(/^(?:in (?:the )?)?((?:garage )?freezer|fridge|refrigerator|pantry|garage|cabinets?|cupboards?)\s*(?::|-|we have|we've got|has|there's|there is|there are)?\s*/);
    if (head && placeIn(head[1])) { place = placeIn(head[1]); chunk = chunk.slice(head[0].length); }
    // "out of X and Y" / "low on X, Y" at the start of a sentence applies to the whole sentence.
    let sentenceStatus = null;
    const lead = chunk.match(/^(?:we(?:'re| are) )?(?:(out of|no more|ran out of|all out of|need)|(running low on|low on|almost out of|nearly out of))\s+/);
    if (lead) { sentenceStatus = lead[1] ? 'out' : 'low'; chunk = chunk.slice(lead[0].length); }
    for (let part of chunk.split(/\s*,\s*|\s+and\s+|\s+&\s+/)) {
      part = tidy(part);
      if (!part) continue;
      let status = sentenceStatus || 'have';
      if (OUT.test(part)) status = 'out'; else if (LOW.test(part)) status = 'low';
      let loc = place;
      const where = part.match(/\s+(?:in|from) (?:the )?((?:garage )?freezer|fridge|refrigerator|pantry|garage|cabinets?|cupboards?)$/);
      if (where) { loc = placeIn(where[1]); part = part.slice(0, where.index); }
      let name = part
        .replace(OUT, ' ').replace(LOW, ' ')
        .replace(/\b(?:is|are|we have|we've got|left|still|only|about|maybe)\b/g, ' ');
      name = tidy(name);
      for (let i = 0; i < 3; i++) name = name.replace(FILLER, '');
      name = tidy(name.replace(/^(?:\d+|one|two|three|four|five|six)\s+/, ''));
      if (!name || name.length < 2 || /^(?:that'?s it|that is it|thats all|that's all|nothing|um|uh)$/.test(name)) continue;
      out.push({ name: cap(name).slice(0, 80), location: loc || fallback, status });
    }
  }
  // Said twice? Keep the last mention.
  const seen = new Map();
  for (const x of out) seen.set(x.name.toLowerCase(), x);
  return [...seen.values()];
}
