/* Mock shopping results.
   Thumbnails are inline SVG data URIs (no network dependency). */
const { dataUri } = require('./_thumb.js');

function thumb(seed, label) { return dataUri(seed, 180, 180, label); }

module.exports = [
  { title: "Carrara Marble Cutting Board — 18\" x 12\"",        price: "$54.99",  shipping: "Free shipping",       rating: 4.7, reviews: 1287, seller: "kitchencraft.com",       url: "https://kitchencraft.com/marble-board",      thumbUrl: thumb('shop1', 'Board')  },
  { title: "Slate Coasters, set of 6",                          price: "$22.00",  shipping: "+$5 shipping",        rating: 4.5, reviews: 412,  seller: "etsy.com",               url: "https://etsy.com/listing/slate-coasters",    thumbUrl: thumb('shop2', 'Slate')  },
  { title: "Drystone Walling: A Practical Guide (book)",        price: "$28.50",  shipping: "Free shipping",       rating: 4.9, reviews: 84,   seller: "amazon.com",             url: "https://amazon.com/drystone-walling-book",   thumbUrl: thumb('shop3', 'Book')   },
  { title: "Diamond Stone-Cutting Wheel, 9\" — contractor grade", price: "$89.00",  shipping: "Free shipping",       rating: 4.6, reviews: 245,  seller: "homedepot.com",          url: "https://homedepot.com/diamond-wheel",        thumbUrl: thumb('shop4', 'Wheel')  },
  { title: "River Stones, decorative — 5lb bag",                price: "$12.49",  shipping: "Free with Prime",     rating: 4.3, reviews: 1102, seller: "amazon.com",             url: "https://amazon.com/river-stones",            thumbUrl: thumb('shop5', 'River')  },
  { title: "Granite Mortar & Pestle, large",                    price: "$45.00",  shipping: "Free shipping",       rating: 4.8, reviews: 633,  seller: "williams-sonoma.com",    url: "https://williams-sonoma.com/granite-mortar", thumbUrl: thumb('shop6', 'Mortar') },
];
