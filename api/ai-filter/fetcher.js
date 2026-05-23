/* Minimal HTML fetcher + parser — text body + image refs only.
   Zero dependencies; uses a forgiving regex pass that is good
   enough for v0 prototype. Replace with cheerio or jsdom in
   production for better fidelity (alt text, computed styles).
*/
'use strict';

async function fetchPage(url, { timeoutMs = 4000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) return { ok: false, status: r.status, html: '' };
    const html = await r.text();
    return { ok: true, status: r.status, html };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, html: '' };
  } finally {
    clearTimeout(t);
  }
}

/** Strip scripts/styles, then collapse remaining tags to plain text. */
function extractText(html) {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pull <img src=...> and best-effort width/height. */
function extractImages(html, baseUrl, { maxImages = 5 } = {}) {
  if (!html) return [];
  const out = [];
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null && out.length < maxImages) {
    const tag = m[0];
    const src = attr(tag, 'src');
    if (!src) continue;
    const w = parseInt(attr(tag, 'width')  || '0', 10) || 0;
    const h = parseInt(attr(tag, 'height') || '0', 10) || 0;
    const url = absolutize(src, baseUrl);
    out.push({
      url,
      area_px: w && h ? w * h : 200_000,  // default to ~450x450 if unknown
      alt: attr(tag, 'alt') || '',
    });
  }
  return out;
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  return m ? (m[2] || m[3] || m[4] || '') : null;
}

function absolutize(src, baseUrl) {
  try { return new URL(src, baseUrl).toString(); }
  catch { return src; }
}

module.exports = { fetchPage, extractText, extractImages };
