/* Mock news results.
   Thumbnails are inline SVG data URIs (no network dependency). */
const { dataUri } = require('./_thumb.js');

function thumb(seed, label) { return dataUri(seed, 120, 90, label); }

module.exports = [
  { title: "Stonehenge solstice draws record crowd",                outlet: "BBC News",        publishedAt: "4 hours ago",  url: "https://bbc.co.uk/news/stonehenge-solstice-2026",        snippet: "Tens of thousands gathered at the prehistoric monument as the summer sun rose over the heel stone.",                                       thumbUrl: thumb('news1', 'BBC'),  aiLikely: 1 },
  { title: "Researchers identify quarry source of pyramid stones",  outlet: "Reuters",         publishedAt: "Yesterday",    url: "https://reuters.com/science/pyramid-quarry",             snippet: "A multi-year geochemical survey has narrowed down the most likely site where Old Kingdom workers extracted limestone blocks.",            thumbUrl: thumb('news2', 'R'),    aiLikely: 4 },
  { title: "Indie developer launches 'stone-themed' search engine", outlet: "TechCrunch",      publishedAt: "2 days ago",   url: "https://techcrunch.com/stone-search-launch",             snippet: "Stone Search positions itself as a 'human web' alternative, automatically filtering pages that score above 25% AI-generated.",            thumbUrl: thumb('news3', 'TC'),   aiLikely: 7 },
  { title: "Quarry workers' strike enters third week",              outlet: "AP",              publishedAt: "3 days ago",   url: "https://apnews.com/quarry-strike",                       snippet: "Negotiations between the union and the holding company have stalled over safety provisions and overtime pay.",                            thumbUrl: thumb('news4', 'AP'),   aiLikely: 2 },
  { title: "Local mason wins national award for restoration",       outlet: "Local Herald",    publishedAt: "5 days ago",   url: "https://localherald.example.com/mason-award",            snippet: "Hand-tooled limestone work on the courthouse facade earned recognition from the Heritage Preservation Council.",                          thumbUrl: thumb('news5', 'LH'),   aiLikely: 11 },
  { title: "AI-written article farm claims stone deposit discovery", outlet: "contentfarm.example.com", publishedAt: "Today", url: "https://contentfarm.example.com/stone-deposit-claim", snippet: "In a stunning breakthrough that experts are calling unprecedented, sources indicate that...",                                            thumbUrl: thumb('news6', 'AI'),   aiLikely: 88 },
];
