/* ============================================================
   _thumb.js — self-contained SVG data-URI thumbnail generator
   - No network dependency (replaces picsum.photos, which was
     unreachable from the sandbox and rate-limited in the wild)
   - Deterministic color from seed string
   - Optional centered label (first 2 chars of seed by default)
   ============================================================ */

// 12 Win95-ish saturated/muted palette colors
const PALETTE = [
  '#5a7a9a', '#8a6a4a', '#4a7a5a', '#a06040',
  '#605070', '#8a8a4a', '#4a6080', '#7a5060',
  '#506a4a', '#90704a', '#4a5a70', '#a06080',
];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colorFor(seed) {
  return PALETTE[hash(seed) % PALETTE.length];
}

/**
 * Build an inline SVG data URI for use as <img src>.
 * @param {string} seed   - stable identifier (used for color + default label)
 * @param {number} w      - width
 * @param {number} h      - height
 * @param {string} [label] - optional text drawn centered (truncated)
 */
function dataUri(seed, w, h, label) {
  const bg = colorFor(seed);
  const text = (label || seed.slice(0, 2)).toUpperCase().slice(0, 14);
  const fontSize = Math.min(w, h) * (text.length > 4 ? 0.18 : 0.34);
  // Use base64 to avoid encoding issues with URL-special chars in the seed/label
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
      `<rect width="${w}" height="${h}" fill="${bg}"/>` +
      `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" ` +
        `font-family="MS Sans Serif, Tahoma, sans-serif" font-size="${fontSize.toFixed(0)}" ` +
        `font-weight="bold" fill="rgba(255,255,255,0.85)">${escapeXml(text)}</text>` +
    `</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  }[c]));
}

module.exports = { dataUri, colorFor };
