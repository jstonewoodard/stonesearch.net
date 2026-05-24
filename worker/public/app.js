// Stone Search — UI logic
(() => {
  const form = document.getElementById('searchForm');
  const input = document.getElementById('q');
  const statusEl = document.getElementById('status');
  const resultsEl = document.getElementById('results');

  // Re-run from URL ?q=
  const initialQ = new URL(location.href).searchParams.get('q');
  if (initialQ) {
    input.value = initialQ;
    runSearch(initialQ);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const url = new URL(location.href);
    url.searchParams.set('q', q);
    history.pushState({}, '', url);
    runSearch(q);
  });

  async function runSearch(q) {
    statusEl.textContent = 'Searching…';
    resultsEl.innerHTML = '';
    const start = performance.now();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) {
        statusEl.textContent = `Error: ${data.error || res.statusText}`;
        return;
      }
      const elapsed = Math.round(performance.now() - start);
      statusEl.textContent = `${data.result_count} results in ${elapsed} ms` +
        (data.cached ? ' (cached)' : '') +
        (data.providers_used?.length ? ` · via ${data.providers_used.join(', ')}` : '');
      render(data);
    } catch (err) {
      statusEl.textContent = `Network error: ${err.message}`;
    }
  }

  function render(data) {
    if (!data.results?.length) {
      resultsEl.innerHTML = `<li class="result"><div class="snippet">No results.${data.message ? ' ' + data.message : ''}</div></li>`;
      return;
    }
    resultsEl.innerHTML = data.results.map((r, i) => `
      <li class="result">
        <div class="domain">${escapeHtml(r.domain || '')}</div>
        <a class="title" href="${escapeAttr(r.url)}" target="_blank" rel="noopener"
           data-pos="${i}" data-ad="${r.is_ad ? 1 : 0}">${escapeHtml(r.title || r.url)}</a>
        <span class="provider">${escapeHtml(r.provider || '')}</span>
        <p class="snippet">${escapeHtml(r.snippet || '')}</p>
      </li>
    `).join('');

    // Click tracking (best-effort)
    resultsEl.querySelectorAll('a.title').forEach((a) => {
      a.addEventListener('click', () => {
        navigator.sendBeacon?.('/api/click', new Blob([JSON.stringify({
          query_id: 0,
          position: Number(a.dataset.pos),
          url: a.href,
          is_ad: a.dataset.ad === '1',
        })], { type: 'application/json' }));
      }, { capture: true });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
