/* ===========================================================
   Stone Search — results page logic
   - Fetches /api/search?q=...
   - For each result, fetches /api/analyze to get the page envelope
   - Verdict tiers (server-driven; see spec §4.7):
       BLOCK     -> hide (above 25%)
       WARN_HIGH -> yellow "Likely AI" badge (10-25%)
       WARN_LOW  -> subtle gray indicator (under 10%, but >0)
       CLEAN     -> no indicator
   - Legacy thresholds kept as fallback when server returns no `verdict`.
   ============================================================ */

const FILTER_THRESHOLD = 25;
const WARN_HIGH_THRESHOLD = 10;

(function () {
  const params = new URLSearchParams(window.location.search);
  const q = (params.get('q') || '').trim();
  const filterEnabled = params.get('filter') !== '0';
  const flagEnabled   = params.get('flag') !== '0';

  const input        = document.getElementById('q');
  const listEl       = document.getElementById('results-list');
  const statsEl      = document.getElementById('result-stats');
  const filterBanner = document.getElementById('filter-summary');
  const filterToggle = document.getElementById('filter-toggle');
  const flagToggle   = document.getElementById('flag-toggle');
  // Status bar elements were removed in the redesign; refs are optional.
  const statusTextEl   = document.getElementById('status-text');
  const statusFilterEl = document.getElementById('status-filter');
  const setStatus = (t) => { if (statusTextEl)   statusTextEl.textContent   = t; };
  const setFilter = (t) => { if (statusFilterEl) statusFilterEl.textContent = t; };

  input.value = q;
  filterToggle.checked = filterEnabled;
  flagToggle.checked   = flagEnabled;
  setFilter('Filter: ' + (filterEnabled ? 'ON' : 'OFF'));

  if (!q) {
    listEl.innerHTML = '<div class="loading" style="color:#ffd0d0;">No query provided. Go back to the homepage.</div>';
    statsEl.textContent = '';
    setStatus('Idle');
    return;
  }

  document.title = q + ' - Stone Search';

  let allResults = [];

  // Refresh display when toggles change (no need to refetch)
  filterToggle.addEventListener('change', () => render(allResults));
  flagToggle.addEventListener('change', () => render(allResults));

  fetchResults(q).then(results => {
    allResults = results;
    render(results);
  }).catch(err => {
    listEl.innerHTML = `<div class="loading" style="color:#ffd0d0;">Error: ${escapeHtml(err.message)}</div>`;
    setStatus('Error');
  });

  // -------- fetch + analyze --------
  async function fetchResults(query) {
    setStatus('Searching...');
    const res = await fetch('/api/search?q=' + encodeURIComponent(query));
    if (!res.ok) throw new Error('Search request failed: ' + res.status);
    const data = await res.json();
    const items = data.results || [];

    setStatus('Analyzing ' + items.length + ' results...');

    // Analyze all results in parallel
    const analyzed = await Promise.all(items.map(async (item) => {
      try {
        const a = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: item.url, snippet: item.snippet, title: item.title }),
        });
        if (!a.ok) throw new Error('analyze ' + a.status);
        const j = await a.json();
        return {
          ...item,
          aiScore: j.aiScore,
          verdict: j.verdict || deriveVerdict(j.aiScore),
          modality: j.modality || null,
          weights: j.weights || null,
          provenance: j.provenance || [],
          aiSource: j.source || 'unknown',
        };
      } catch (e) {
        return { ...item, aiScore: null, aiError: e.message };
      }
    }));

    return analyzed;
  }

  // -------- render --------
  function render(results) {
    const filterOn = filterToggle.checked;
    const flagOn   = flagToggle.checked;
    setFilter('Filter: ' + (filterOn ? 'ON' : 'OFF'));

    let hidden = 0;
    let flagged = 0;
    let clean = 0;
    const visible = [];

    for (const r of results) {
      const v = r.verdict || deriveVerdict(r.aiScore);
      if (filterOn && v === 'BLOCK') { hidden++; continue; }
      visible.push(r);
      if (v === 'WARN_HIGH' || v === 'WARN_LOW') flagged++;
      else clean++;
    }

    // Banner
    if (hidden > 0 && filterOn) {
      filterBanner.style.display = 'block';
      filterBanner.innerHTML =
        '&#9888; <strong>' + hidden + '</strong> result' + (hidden === 1 ? '' : 's') +
        ' hidden for scoring over ' + FILTER_THRESHOLD + '% AI-generated. ' +
        '<a href="#" id="show-hidden">Show anyway</a>';
      const showLink = filterBanner.querySelector('#show-hidden');
      showLink.addEventListener('click', (e) => {
        e.preventDefault();
        filterToggle.checked = false;
        render(allResults);
      });
    } else {
      filterBanner.style.display = 'none';
    }

    // Stats
    statsEl.innerHTML =
      'About <strong>' + results.length + '</strong> results for <strong>"' +
      escapeHtml(q) + '"</strong> &middot; ' +
      visible.length + ' shown' +
      (flagOn && flagged > 0 ? ' (' + flagged + ' flagged)' : '');

    // Render
    if (visible.length === 0) {
      listEl.innerHTML = '<div class="loading">No results to show.</div>';
    } else {
      listEl.innerHTML = visible.map(r => renderResult(r, flagOn)).join('');
    }

    setStatus('Done');
  }

  function renderResult(r, flagOn) {
    const score = r.aiScore;
    const v = r.verdict || deriveVerdict(score);
    const tip = score == null
      ? 'AI score unavailable'
      : buildTooltip(r);

    let badge = '';
    if (score == null) {
      badge = `<span class="ai-badge" title="${escapeAttr(tip)}">AI: ?</span>`;
    } else if (v === 'WARN_HIGH' && flagOn) {
      badge = `<span class="ai-badge flagged" title="${escapeAttr(tip)}">&#9888; Likely AI: ${score.toFixed(0)}%</span>`;
    } else if (v === 'WARN_LOW' && flagOn) {
      // Subtle indicator — gray dot, no big badge.
      badge = `<span class="ai-badge subtle" title="${escapeAttr(tip)}" aria-label="Trace AI content">&#9679;</span>`;
    } else if (v === 'WARN_HIGH' || v === 'WARN_LOW') {
      // Filter off but still surface a hover tip.
      badge = `<span class="ai-badge clean" title="${escapeAttr(tip)}">AI: ${score.toFixed(0)}%</span>`;
    } else {
      // CLEAN — no badge by default.
      badge = '';
    }

    return `
      <div class="result">
        <div class="result-url">${escapeHtml(r.url)}</div>
        <div class="result-title">
          <a href="${escapeAttr(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.title)}</a>
          ${badge}
        </div>
        <div class="result-snippet">${escapeHtml(r.snippet || '')}</div>
      </div>
    `;
  }

  function buildTooltip(r) {
    const parts = [`Page AI score: ${r.aiScore.toFixed(1)}% (${r.verdict})`];
    if (r.modality?.text)  parts.push(`text ${r.modality.text.score.toFixed(0)}% (conf ${r.modality.text.confidence})`);
    if (r.modality?.image) parts.push(`image ${r.modality.image.score.toFixed(0)}% across ${r.modality.image.count} (conf ${r.modality.image.confidence})`);
    if (r.weights) parts.push(`weights: text ${r.weights.text}, image ${r.weights.image}`);
    return parts.join(' · ');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();

// Fallback for older /api/analyze responses without a verdict field.
function deriveVerdict(score) {
  if (score == null) return null;
  if (score > 25) return 'BLOCK';
  if (score >= 10) return 'WARN_HIGH';
  if (score >  0) return 'WARN_LOW';
  return 'CLEAN';
}
