/* Sidebar 'related entities' cards keyed by query (case-insensitive substring).
   Each entity has: label, value (line under label), image, url.
   Images are inline SVG data URIs (no network dependency). */
const { dataUri } = require('./_thumb.js');
const simg = (seed, label) => dataUri(seed, 80, 80, label);

const sets = [
  {
    match: ['stone masonry', 'masonry', 'mason'],
    entities: [
      { label: 'Related craft', value: 'Bricklaying',  image: simg('sb-brick', 'Br'),    url: 'https://en.wikipedia.org/wiki/Bricklayer' },
      { label: 'Related craft', value: 'Carpentry',    image: simg('sb-carp',  'Ca'),    url: 'https://en.wikipedia.org/wiki/Carpentry' },
      { label: 'Material',      value: 'Limestone',    image: simg('sb-lime',  'Li'),    url: 'https://en.wikipedia.org/wiki/Limestone' },
      { label: 'Material',      value: 'Granite',      image: simg('sb-gran',  'Gr'),    url: 'https://en.wikipedia.org/wiki/Granite' },
    ],
  },
  {
    match: ['stonehenge'],
    entities: [
      { label: 'Nearby site', value: 'Avebury',          image: simg('sb-avebury', 'Av'), url: 'https://en.wikipedia.org/wiki/Avebury' },
      { label: 'Era',         value: 'Neolithic Britain',image: simg('sb-neo',     'Ne'), url: 'https://en.wikipedia.org/wiki/Neolithic_British_Isles' },
      { label: 'Operator',    value: 'English Heritage', image: simg('sb-eh',      'EH'), url: 'https://www.english-heritage.org.uk/' },
    ],
  },
  {
    match: ['the beatles', 'beatles'],
    entities: [
      { label: 'Member',  value: 'John Lennon',    image: simg('sb-john',   'JL'),  url: 'https://en.wikipedia.org/wiki/John_Lennon' },
      { label: 'Member',  value: 'Paul McCartney', image: simg('sb-paul',   'PM'),  url: 'https://en.wikipedia.org/wiki/Paul_McCartney' },
      { label: 'Member',  value: 'George Harrison',image: simg('sb-george', 'GH'),  url: 'https://en.wikipedia.org/wiki/George_Harrison' },
      { label: 'Album',   value: 'Abbey Road',     image: simg('sb-abbey',  'AR'),  url: 'https://en.wikipedia.org/wiki/Abbey_Road' },
    ],
  },
  {
    match: ['ai', 'artificial intelligence'],
    entities: [
      { label: 'Subfield', value: 'Machine learning', image: simg('sb-ml',   'ML'), url: 'https://en.wikipedia.org/wiki/Machine_learning' },
      { label: 'Subfield', value: 'Computer vision',  image: simg('sb-cv',   'CV'), url: 'https://en.wikipedia.org/wiki/Computer_vision' },
      { label: 'Tool',     value: 'Hive Moderation',  image: simg('sb-hive', 'Hi'), url: 'https://thehive.ai' },
    ],
  },
];

function find(q) {
  if (!q) return [];
  const lower = q.toLowerCase();
  for (const s of sets) {
    if (s.match.some(m => lower.includes(m))) return s.entities;
  }
  return [];
}

module.exports = { find };
