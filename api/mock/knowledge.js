/* Mock knowledge-card data keyed by query (case-insensitive substring).
   Each card has: title, kind, image, summary, facts[], source.
   Card images are inline SVG data URIs (no network dependency). */
const { dataUri } = require('./_thumb.js');
const kimg = (seed, label) => dataUri(seed, 160, 160, label);

const cards = [
  {
    match: ['stone masonry', 'masonry', 'mason'],
    card: {
      title: 'Stonemasonry',
      kind: 'Craft / trade',
      image: kimg('k-masonry', 'Mason'),
      summary: 'Stonemasonry is the craft of shaping rough pieces of rock into accurate geometrical shapes, mostly simple, but some of considerable complexity, and then arranging the resulting stones, often together with mortar, to form structures.',
      facts: [
        ['Discipline', 'Construction trade'],
        ['Origin',     'Pre-history'],
        ['Modern body','Stone Federation Great Britain'],
        ['Apprenticeship', '3–4 years typical'],
      ],
      source: 'Wikipedia (cached)',
    },
  },
  {
    match: ['stonehenge'],
    card: {
      title: 'Stonehenge',
      kind: 'Prehistoric monument · Wiltshire, England',
      image: kimg('k-stonehenge', 'Henge'),
      summary: 'Stonehenge is a prehistoric megalithic structure on Salisbury Plain in Wiltshire, England. It consists of an outer ring of vertical sarsen standing stones, each around 13 ft (4.0 m) high.',
      facts: [
        ['Built',     'c. 3000 – 2000 BC'],
        ['Type',      'Henge monument'],
        ['Material',  'Sarsen sandstone, bluestone'],
        ['Owner',     'The Crown'],
        ['UNESCO',    'World Heritage Site, 1986'],
      ],
      source: 'Wikipedia (cached)',
    },
  },
  {
    match: ['the beatles', 'beatles'],
    card: {
      title: 'The Beatles',
      kind: 'English rock band',
      image: kimg('k-beatles', 'Beatles'),
      summary: 'The Beatles were an English rock band formed in Liverpool in 1960. The group, whose best-known line-up comprised John Lennon, Paul McCartney, George Harrison and Ringo Starr, are widely regarded as the most influential band of all time.',
      facts: [
        ['Origin',  'Liverpool, England'],
        ['Active',  '1960 – 1970'],
        ['Genres',  'Rock, pop, psychedelic'],
        ['Labels',  'Parlophone, Apple, Capitol'],
      ],
      source: 'Wikipedia (cached)',
    },
  },
  {
    match: ['ai', 'artificial intelligence'],
    card: {
      title: 'Artificial intelligence',
      kind: 'Field of computer science',
      image: kimg('k-ai', 'AI'),
      summary: 'Artificial intelligence is the capability of computational systems to perform tasks typically associated with human intelligence, such as learning, reasoning, problem-solving, perception, and decision-making.',
      facts: [
        ['Founded',     '1956 (Dartmouth workshop)'],
        ['Subfields',   'Machine learning, NLP, computer vision'],
        ['Modern era',  'Deep learning, ~2012–present'],
      ],
      source: 'Wikipedia (cached)',
    },
  },
  {
    match: ['stone search'],
    card: {
      title: 'Stone Search',
      kind: 'Search engine',
      image: kimg('k-stonesearch', 'SS'),
      summary: 'Stone Search is a search engine that automatically filters AI-generated content out of results. Pages scoring above 25% AI-generated are hidden by default; pages between 5% and 25% are surfaced with a warning badge.',
      facts: [
        ['Launched',   '2026'],
        ['Operator',   'Stone Tech LLC'],
        ['Detection',  'Hive Moderation'],
        ['Filter',     '25% threshold (configurable)'],
      ],
      source: 'stonesearch.net',
    },
  },
];

function find(q) {
  if (!q) return null;
  const lower = q.toLowerCase();
  for (const c of cards) {
    if (c.match.some(m => lower.includes(m))) return c.card;
  }
  return null;
}

module.exports = { find, cards };
