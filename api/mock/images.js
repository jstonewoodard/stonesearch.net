/* Mock image results. Each item has: title, sourceUrl, imageUrl, w, h, source, aiLikely (0-100).
   aiLikely is the simulated Hive image-detection score so the Images tab can demo filtering.
   Thumbnails are now generated as inline SVG data URIs (no network dependency). */
const { dataUri } = require('./_thumb.js');

function img(seed, label) { return dataUri(seed, 400, 300, label); }

module.exports = [
  { title: "Stone wall, dry-stack",           sourceUrl: "https://stonemasonsguild.org/gallery/wall-1",   imageUrl: img('stone1',  'Wall'),    w: 400, h: 300, source: "stonemasonsguild.org",   aiLikely: 2 },
  { title: "Granite quarry photograph",       sourceUrl: "https://nationalgeographic.com/quarry",         imageUrl: img('stone2',  'Quarry'),  w: 400, h: 300, source: "nationalgeographic.com", aiLikely: 1 },
  { title: "AI-generated 'cyberpunk stone'",  sourceUrl: "https://aiart.example.com/cyberpunk-stone",     imageUrl: img('stone3',  'AI'),      w: 400, h: 300, source: "aiart.example.com",      aiLikely: 94 },
  { title: "Limestone cathedral facade",      sourceUrl: "https://wikipedia.org/cathedral-facade",        imageUrl: img('stone4',  'Facade'),  w: 400, h: 300, source: "wikipedia.org",          aiLikely: 0 },
  { title: "Polished marble countertop",      sourceUrl: "https://homedepot.com/marble-counter",          imageUrl: img('stone5',  'Marble'),  w: 400, h: 300, source: "homedepot.com",          aiLikely: 4 },
  { title: "Stonehenge at sunrise",           sourceUrl: "https://english-heritage.org.uk/stonehenge",    imageUrl: img('stone6',  'Henge'),   w: 400, h: 300, source: "english-heritage.org.uk", aiLikely: 1 },
  { title: "'Stone dragon' MidJourney art",   sourceUrl: "https://aiart.example.com/stone-dragon",        imageUrl: img('stone7',  'AI'),      w: 400, h: 300, source: "aiart.example.com",      aiLikely: 97 },
  { title: "River stones, macro photograph",  sourceUrl: "https://unsplash.com/river-stones",             imageUrl: img('stone8',  'River'),   w: 400, h: 300, source: "unsplash.com",           aiLikely: 3 },
  { title: "Mason at work, 1920s archive",    sourceUrl: "https://loc.gov/photos/mason-1920s",            imageUrl: img('stone9',  'Mason'),   w: 400, h: 300, source: "loc.gov",                aiLikely: 0 },
  { title: "Stable diffusion 'rune stone'",   sourceUrl: "https://civitai.example.com/runestone",         imageUrl: img('stone10', 'AI'),      w: 400, h: 300, source: "civitai.example.com",    aiLikely: 91 },
  { title: "Slate roof close-up",             sourceUrl: "https://thisoldhouse.com/slate-roof",           imageUrl: img('stone11', 'Slate'),   w: 400, h: 300, source: "thisoldhouse.com",       aiLikely: 5 },
  { title: "Cobblestone street, Prague",      sourceUrl: "https://travel.example.com/prague-cobble",      imageUrl: img('stone12', 'Cobble'),  w: 400, h: 300, source: "travel.example.com",     aiLikely: 8 },
];
