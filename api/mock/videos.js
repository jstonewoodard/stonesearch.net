/* Mock video results. aiLikely is the deepfake / AI-generation score.
   Thumbnails are inline SVG data URIs (no network dependency). */
const { dataUri } = require('./_thumb.js');

function thumb(seed, label) { return dataUri(seed, 320, 180, label); }

module.exports = [
  { title: "Master mason builds dry-stone wall (no narration)",          channel: "Old Crafts",            duration: "12:47", views: "1.2M", postedAt: "3 years ago", url: "https://youtube.com/watch?v=mock1",  thumbUrl: thumb('vid1', 'Wall'),    aiLikely: 2 },
  { title: "How marble is quarried in Carrara, Italy",                   channel: "Insider",               duration: "9:21",  views: "8.4M", postedAt: "5 years ago", url: "https://youtube.com/watch?v=mock2",  thumbUrl: thumb('vid2', 'Carrara'), aiLikely: 3 },
  { title: "AI-generated 'stone giant' fight scene [Sora]",              channel: "AI Cinema",             duration: "2:08",  views: "340K", postedAt: "2 weeks ago", url: "https://youtube.com/watch?v=mock3",  thumbUrl: thumb('vid3', 'Sora'),    aiLikely: 96 },
  { title: "Stonehenge documentary (BBC)",                               channel: "BBC Earth",             duration: "47:12", views: "12M",  postedAt: "8 years ago", url: "https://youtube.com/watch?v=mock4",  thumbUrl: thumb('vid4', 'BBC'),     aiLikely: 1 },
  { title: "DIY stone fireplace install — full build",                   channel: "This Old House",        duration: "23:55", views: "2.1M", postedAt: "4 years ago", url: "https://youtube.com/watch?v=mock5",  thumbUrl: thumb('vid5', 'DIY'),     aiLikely: 4 },
  { title: "Deepfake history lecturer 'explains' Stonehenge (FAKE)",     channel: "uploads_2024_archive",  duration: "5:32",  views: "44K",  postedAt: "6 months ago",url: "https://youtube.com/watch?v=mock6",  thumbUrl: thumb('vid6', 'Fake'),    aiLikely: 89 },
  { title: "Working with limestone — masonry tips",                      channel: "Trade Tips Daily",      duration: "8:09",  views: "560K", postedAt: "1 year ago",  url: "https://youtube.com/watch?v=mock7",  thumbUrl: thumb('vid7', 'Tips'),    aiLikely: 6 },
];
