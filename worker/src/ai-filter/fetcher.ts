/* HTML fetcher + text/image extraction — Worker runtime (TypeScript).
   Web fetch is global in CF Workers; no Node dependencies.
*/

export interface FetchedPage {
  ok: boolean;
  status: number;
  html: string;
  truncated?: boolean;
  error?: string;
}

export interface ImageRef {
  url: string;
  area_px: number;
  alt: string;
}

export async function fetchPage(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const maxBytes = opts.maxBytes ?? 500_000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'StoneSearchBot/0.1 (+https://stonesearch.net/bot)' },
    });
    if (!r.ok) return { ok: false, status: r.status, html: '' };
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
    return { ok: false, status: 0, error: (err as Error).message, html: '' };
  } finally {
    clearTimeout(t);
  }
}

export function extractText(html: string): string {
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

export function extractImages(html: string, baseUrl: string, opts: { maxImages?: number } = {}): ImageRef[] {
  const maxImages = opts.maxImages ?? 5;
  if (!html) return [];
  const out: ImageRef[] = [];
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
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

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  return m ? (m[2] || m[3] || m[4] || '') : null;
}

function absolutize(src: string, baseUrl: string): string {
  try { return new URL(src, baseUrl).toString(); } catch { return src; }
}
