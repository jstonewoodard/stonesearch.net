/* HTML fetcher + text/image extraction — ESM, runs in Workers.
   Web fetch is global in CF Workers/Pages; no Node dependencies.
*/

export async function fetchPage(url, { timeoutMs = 4000, maxBytes = 500_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'StoneSearchBot/0.1 (+https://stonesearch.net/bot)' },
    });
    if (!r.ok) return { ok: false, status: r.status, html: '' };
    // Cap response size — read as text but reject oversized payloads early.
    const cl = parseInt(r.headers.get('content-length') || '0', 10);
    if (cl && cl > maxBytes) {
      return { ok: false, status: r.status, html: '', error: `too-large:${cl}` };
    }
    const html = await r.text();
    if (html.length > maxBytes) {
      return { ok: true, status: r.status, html: html.slice(0, maxBytes), truncated: true };
    }
    return { ok: true, status: r.status, html };
  } catch (err) {
    return { ok: false, status: 0, error: err.message, html: '' };
  } finally {
    clearTimeout(t);
  }
}

export function extractText(html) {
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

export function extractImages(html, baseUrl, { maxImages = 5 } = {}) {
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
    out.push({
      url: absolutize(src, baseUrl),
      area_px: w && h ? w * h : 200_000,
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
  try { return new URL(src, baseUrl).toString(); } catch { return src; }
}
