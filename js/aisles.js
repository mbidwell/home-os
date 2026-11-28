// Store mode: guess a grocery item's aisle from its name so the list follows the store. Pure (tests in tests/aisles.test.mjs).

export const AISLES = ['Produce', 'Bakery', 'Meat & seafood', 'Deli', 'Dairy & eggs', 'Frozen', 'Pantry', 'Snacks', 'Drinks', 'Baby & kids', 'Household', 'Other'];

// First match wins, so more specific aisles come first (frozen peas are Frozen, not Produce).
const RULES = [
  ['Frozen', /\bfrozen\b|ice cream|popsicle|waffles?\b|tater tots|\bpizza rolls/],
  ['Baby & kids', /\bdiapers?\b|\bwipes\b|formula|baby food|pouches|sippy|pull-?ups|kids'? (?:tylenol|motrin)/],
  ['Household', /paper towels?|toilet paper|tissues?|trash bags?|dish soap|detergent|dishwasher|sponges?|foil|plastic wrap|ziploc|zip ?lock|batteries|light ?bulbs?|cleaner|bleach|napkins|shampoo|conditioner|toothpaste|soap\b|deodorant|razors?|candles?/],
  ['Drinks', /\bmilk\b(?!.*chocolate chips)|\bjuice\b|coffee|\btea\b|soda|sparkling|seltzer|water\b|kombucha|\bbeer\b|\bwine\b|lemonade|gatorade/],
  ['Dairy & eggs', /\beggs?\b|cheese|yogurt|yoghurt|butter|cream\b|sour cream|half and half|cottage|cream cheese|creamer/],
  ['Meat & seafood', /chicken|beef|steak|pork|bacon|sausage|turkey(?! sandwich)|ground (?:beef|turkey)|salmon|shrimp|fish|tilapia|cod\b|tuna steak|lamb|ribs|meatballs/],
  ['Deli', /deli|sliced turkey|\bham\b|salami|prosciutto|hummus|rotisserie/],
  ['Pantry', /crushed tomatoes|diced tomatoes|canned|\bcan of|tomato (?:sauce|paste)|(?<!green )beans\b|olive oil/], // before Produce: canned tomatoes aren't fresh
  ['Bakery', /bread|bagels?|buns?\b|rolls?\b|tortillas?|pita|muffins?|croissants?|sourdough|baguette|naan/],
  ['Produce', /apples?|bananas?|berries|strawberr|blueberr|raspberr|grapes?|oranges?|lemons?|limes?|avocados?|tomato(?!es? (?:sauce|paste))|onions?|garlic|potato|carrots?|celery|lettuce|spinach|kale|broccoli|cauliflower|peppers?\b|cucumbers?|zucchini|squash|mushrooms?|herbs?|basil|cilantro|parsley|ginger|green beans|corn\b|peaches|pears?|melon|watermelon|pineapple|mango|salad/],
  ['Snacks', /chips|crackers|pretzels|popcorn|cookies|granola|bars?\b|goldfish|nuts\b|almonds|trail mix|candy|chocolate/],
  ['Pantry', /rice|pasta|noodles|spaghetti|flour|sugar|oil\b|olive oil|vinegar|sauce|salsa|beans|lentils|cereal|oats|oatmeal|peanut butter|jelly|jam|honey|syrup|spices?|seasoning|salt|pepper\b|broth|stock\b|soup|canned|can of|tuna|crushed tomatoes|tomato sauce|tomato paste|baking|vanilla|chili powder|cumin|paprika|ketchup|mustard|mayo|dressing/]
];

/** The aisle for an item. A Costco-list category (Fridge, Freezer, Pantry, Household, Kids) helps when the name doesn't. */
export function aisleOf(name, category = null) {
  const n = String(name || '').toLowerCase();
  for (const [aisle, re] of RULES) if (re.test(n)) return aisle;
  const byCat = { freezer: 'Frozen', pantry: 'Pantry', household: 'Household', kids: 'Baby & kids', fridge: 'Dairy & eggs' }[String(category || '').toLowerCase()];
  return byCat || 'Other';
}

export const aisleRank = (a) => { const i = AISLES.indexOf(a); return i < 0 ? AISLES.length : i; };
