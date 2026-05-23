/* Mock image results. Each item has: title, sourceUrl, imageUrl, w, h, source, aiLikely (0-100).
   aiLikely is the simulated Hive image-detection score so the Images tab can demo filtering. */
module.exports = [
  { title: "Stone wall, dry-stack",           sourceUrl: "https://stonemasonsguild.org/gallery/wall-1",   imageUrl: "https://picsum.photos/seed/stone1/400/300",  w: 400, h: 300, source: "stonemasonsguild.org",   aiLikely: 2 },
  { title: "Granite quarry photograph",       sourceUrl: "https://nationalgeographic.com/quarry",         imageUrl: "https://picsum.photos/seed/stone2/400/300",  w: 400, h: 300, source: "nationalgeographic.com", aiLikely: 1 },
  { title: "AI-generated 'cyberpunk stone'",  sourceUrl: "https://aiart.example.com/cyberpunk-stone",     imageUrl: "https://picsum.photos/seed/stone3/400/300",  w: 400, h: 300, source: "aiart.example.com",      aiLikely: 94 },
  { title: "Limestone cathedral facade",      sourceUrl: "https://wikipedia.org/cathedral-facade",        imageUrl: "https://picsum.photos/seed/stone4/400/300",  w: 400, h: 300, source: "wikipedia.org",          aiLikely: 0 },
  { title: "Polished marble countertop",      sourceUrl: "https://homedepot.com/marble-counter",          imageUrl: "https://picsum.photos/seed/stone5/400/300",  w: 400, h: 300, source: "homedepot.com",          aiLikely: 4 },
  { title: "Stonehenge at sunrise",           sourceUrl: "https://english-heritage.org.uk/stonehenge",    imageUrl: "https://picsum.photos/seed/stone6/400/300",  w: 400, h: 300, source: "english-heritage.org.uk", aiLikely: 1 },
  { title: "'Stone dragon' MidJourney art",   sourceUrl: "https://aiart.example.com/stone-dragon",        imageUrl: "https://picsum.photos/seed/stone7/400/300",  w: 400, h: 300, source: "aiart.example.com",      aiLikely: 97 },
  { title: "River stones, macro photograph",  sourceUrl: "https://unsplash.com/river-stones",             imageUrl: "https://picsum.photos/seed/stone8/400/300",  w: 400, h: 300, source: "unsplash.com",           aiLikely: 3 },
  { title: "Mason at work, 1920s archive",    sourceUrl: "https://loc.gov/photos/mason-1920s",            imageUrl: "https://picsum.photos/seed/stone9/400/300",  w: 400, h: 300, source: "loc.gov",                aiLikely: 0 },
  { title: "Stable diffusion 'rune stone'",   sourceUrl: "https://civitai.example.com/runestone",         imageUrl: "https://picsum.photos/seed/stone10/400/300", w: 400, h: 300, source: "civitai.example.com",    aiLikely: 91 },
  { title: "Slate roof close-up",             sourceUrl: "https://thisoldhouse.com/slate-roof",           imageUrl: "https://picsum.photos/seed/stone11/400/300", w: 400, h: 300, source: "thisoldhouse.com",       aiLikely: 5 },
  { title: "Cobblestone street, Prague",      sourceUrl: "https://travel.example.com/prague-cobble",      imageUrl: "https://picsum.photos/seed/stone12/400/300", w: 400, h: 300, source: "travel.example.com",     aiLikely: 8 },
];
