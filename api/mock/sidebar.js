/* Sidebar 'related entities' cards keyed by query (case-insensitive substring).
   Each entity has: label, value (line under label), image, url. */
const sets = [
  {
    match: ['stone masonry', 'masonry', 'mason'],
    entities: [
      { label: 'Related craft', value: 'Bricklaying',  image: 'https://picsum.photos/seed/sb-brick/80/80',    url: 'https://en.wikipedia.org/wiki/Bricklayer' },
      { label: 'Related craft', value: 'Carpentry',    image: 'https://picsum.photos/seed/sb-carp/80/80',     url: 'https://en.wikipedia.org/wiki/Carpentry' },
      { label: 'Material',      value: 'Limestone',    image: 'https://picsum.photos/seed/sb-lime/80/80',     url: 'https://en.wikipedia.org/wiki/Limestone' },
      { label: 'Material',      value: 'Granite',      image: 'https://picsum.photos/seed/sb-gran/80/80',     url: 'https://en.wikipedia.org/wiki/Granite' },
    ],
  },
  {
    match: ['stonehenge'],
    entities: [
      { label: 'Nearby site', value: 'Avebury',          image: 'https://picsum.photos/seed/sb-avebury/80/80', url: 'https://en.wikipedia.org/wiki/Avebury' },
      { label: 'Era',         value: 'Neolithic Britain',image: 'https://picsum.photos/seed/sb-neo/80/80',     url: 'https://en.wikipedia.org/wiki/Neolithic_British_Isles' },
      { label: 'Operator',    value: 'English Heritage', image: 'https://picsum.photos/seed/sb-eh/80/80',      url: 'https://www.english-heritage.org.uk/' },
    ],
  },
  {
    match: ['the beatles', 'beatles'],
    entities: [
      { label: 'Member',  value: 'John Lennon',    image: 'https://picsum.photos/seed/sb-john/80/80',   url: 'https://en.wikipedia.org/wiki/John_Lennon' },
      { label: 'Member',  value: 'Paul McCartney', image: 'https://picsum.photos/seed/sb-paul/80/80',   url: 'https://en.wikipedia.org/wiki/Paul_McCartney' },
      { label: 'Member',  value: 'George Harrison',image: 'https://picsum.photos/seed/sb-george/80/80', url: 'https://en.wikipedia.org/wiki/George_Harrison' },
      { label: 'Album',   value: 'Abbey Road',     image: 'https://picsum.photos/seed/sb-abbey/80/80',  url: 'https://en.wikipedia.org/wiki/Abbey_Road' },
    ],
  },
  {
    match: ['ai', 'artificial intelligence'],
    entities: [
      { label: 'Subfield', value: 'Machine learning', image: 'https://picsum.photos/seed/sb-ml/80/80',  url: 'https://en.wikipedia.org/wiki/Machine_learning' },
      { label: 'Subfield', value: 'Computer vision',  image: 'https://picsum.photos/seed/sb-cv/80/80',  url: 'https://en.wikipedia.org/wiki/Computer_vision' },
      { label: 'Tool',     value: 'Hive Moderation',  image: 'https://picsum.photos/seed/sb-hive/80/80',url: 'https://thehive.ai' },
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
