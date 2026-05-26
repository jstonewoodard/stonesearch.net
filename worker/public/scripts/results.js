/* ===========================================================
   Stone Search — results page logic
   - Tab-aware: ?tab=all|images|videos|news|forums|shopping|maps
   - For each Web result, calls /api/analyze to get the AI envelope
   - For Image results, uses the per-result aiLikely score directly
   - Renders the right layout per tab
   - Fetches knowledge card + sidebar in parallel
   ============================================================ */

const FILTER_THRESHOLD    = 25;
const WARN_HIGH_THRESHOLD = 10;

const VALID_TABS = ['all', 'images', 'videos', 'news', 'forums', 'shopping', 'maps'];

(function () {
  const params = new URLSearchParams(window.location.search);
  const q   = (params.get('q')   || '').trim();
  let   tab = (params.get('tab') || 'all').toLowerCase();
  if (!VALID_TABS.includes(tab)) tab = 'all';
  const filterEnabled = params.get('filter') !== '0';
  const flagEnabled   = params.get('flag')   !== '0';

  // DOM refs
  const input        = document.getElementById('q');
  const tabInput     = document.getElementById('tab-input');
  const listEl       = document.getElementById('results-list');
  const statsEl      = document.getElementById('result-stats');
  const filterStatus = document.getElementById('filter-status');
  const blockedBar   = document.getElementById('blocked-bar');
  const spellSuggest = document.getElementById('spell-suggest');
  const filterToggle = document.getElementById('filter-toggle');
  const flagToggle   = document.getElementById('flag-toggle');
  const knowledgeEl  = document.getElementById('knowledge-card');
  const sidebarEl    = document.getElementById('sidebar-col');
  const resultsBody  = document.getElementById('results-body');
  const tabStrip     = document.getElementById('tab-strip');

  // Init form state
  input.value = q;
  if (tabInput) tabInput.value = tab;
  filterToggle.checked = filterEnabled;
  flagToggle.checked   = flagEnabled;

  // Highlight active tab (main 4)
  const MAIN_TABS = ['all', 'images', 'videos', 'news'];
  for (const a of tabStrip.querySelectorAll('.tab')) {
    const t = a.dataset.tab;
    if (t === tab) a.classList.add('active');
    if (!t) continue; // skip the More trigger
    a.addEventListener('click', (e) => {
      e.preventDefault();
      goToTab(t);
    });
  }
  // If the active tab lives under More, light up the More trigger
  if (!MAIN_TABS.includes(tab)) {
    document.getElementById('tab-more-trigger')?.classList.add('active');
  }

  // Wire up More dropdown
  const moreTrigger = document.getElementById('tab-more-trigger');
  const moreMenu    = document.getElementById('tab-more-menu');
  if (moreTrigger && moreMenu) {
    moreTrigger.addEventListener('click', (e) => {
      e.preventDefault();
      moreMenu.hidden = !moreMenu.hidden;
    });
    for (const item of moreMenu.querySelectorAll('.tab-more-item')) {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        goToTab(item.dataset.tab);
      });
    }
    document.addEventListener('click', (e) => {
      if (!moreTrigger.contains(e.target) && !moreMenu.contains(e.target)) moreMenu.hidden = true;
    });
  }

  function goToTab(nextTab) {
    const p = new URLSearchParams(window.location.search);
    p.set('tab', nextTab);
    if (!p.get('q')) return;
    window.location.href = '/results.html?' + p.toString();
  }

  if (!q) {
    listEl.innerHTML = '<div class="loading" style="color:#ffd0d0;">No query provided. Go back to the homepage.</div>';
    statsEl.textContent = '';
    return;
  }

  document.title = q + ' - Stone Search';

  // Hide filter toggles on tabs where they don't apply
  const filterApplicable = tab === 'all' || tab === 'images' || tab === 'videos' || tab === 'news' || tab === 'forums';
  if (!filterApplicable) {
    document.querySelector('.results-meta-controls')?.style.setProperty('display', 'none');
  }

  let allResults = [];

  filterToggle.addEventListener('change', () => render(allResults));
  flagToggle.addEventListener('change', () => render(allResults));

  // Kick off all three fetches in parallel
  Promise.all([
    fetchResults(q, tab),
    fetchKnowledge(q),
    fetchSidebar(q),
  ]).then(([results, card, entities]) => {
    allResults = results;
    renderKnowledge(card);
    renderSidebar(entities);
    render(results);
  }).catch(err => {
    listEl.innerHTML = `<div class="loading" style="color:#ffd0d0;">Error: ${escapeHtml(err.message)}</div>`;
  });

  // ============================================================
  //   FETCH
  // ============================================================
  async function fetchResults(query, tab) {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&tab=${tab}`);
    if (!res.ok) throw new Error('Search request failed: ' + res.status);
    const data = await res.json();
    const items = data.results || [];

    // "Did you mean..." — render the spell correction from Brave's
    // query.altered field (passed through by the Worker when it lands).
    // Tolerates several shape variants: data.altered (string), data.spellcheck,
    // data.spellSuggest, data.query?.altered. Hides itself if absent.
    renderSpellSuggest(data.altered || data.spellcheck || data.spellSuggest || (data.query && data.query.altered) || null);

    // Every tab gets routed through /api/analyze with whatever text we have
    // on the result (title + snippet). The live Worker returns web-shaped
    // Brave results regardless of ?tab=, so they all have text to score.
    // For dev-server runs where image/video results have a pre-computed
    // aiLikely, we honor that as a fast path and skip the round-trip.
    return Promise.all(items.map(async (item) => {
      // Dev-server mock fast path: pre-computed score available.
      if (typeof item.aiLikely === 'number') {
        return {
          ...item,
          aiScore: item.aiLikely,
          verdict: deriveVerdict(item.aiLikely),
          aiEnvelope: {
            aiScore: item.aiLikely,
            verdict: deriveVerdict(item.aiLikely),
            modality: { text: null, image: { score: item.aiLikely, count: 1 } },
            weights: { text: 0, image: 1 },
            source: 'per-modality-mock (dev only)',
            warnings: [],
          },
        };
      }
      try {
        const a = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: item.url, snippet: item.snippet || '', title: item.title }),
        });
        const j = await a.json();
        return {
          ...item,
          aiScore: j.aiScore,
          verdict: j.verdict || deriveVerdict(j.aiScore),
          modality: j.modality || null,
          aiEnvelope: j,
        };
      } catch (e) {
        return {
          ...item,
          aiScore: null,
          aiEnvelope: { aiScore: null, verdict: 'CLEAN', warnings: ['fetch:analyze-failed:' + e.message], source: 'degraded' },
        };
      }
    }));
  }

  async function fetchKnowledge(query) {
    try {
      const r = await fetch('/api/knowledge?q=' + encodeURIComponent(query));
      const j = await r.json();
      return j.card || null;
    } catch (e) { return null; }
  }

  async function fetchSidebar(query) {
    try {
      const r = await fetch('/api/sidebar?q=' + encodeURIComponent(query));
      const j = await r.json();
      return j.entities || [];
    } catch (e) { return []; }
  }

  // ============================================================
  //   RENDER — main results
  // ============================================================
  function render(results) {
    const filterOn = filterToggle.checked;
    const flagOn   = flagToggle.checked;

    let flagged = 0;
    let clean = 0;
    let unscored = 0;
    const visible = [];
    const blockedAll = [];     // all BLOCK-verdict items (blocked-bar uses this,
                               // independent of whether filter toggle is on)

    for (const r of results) {
      const v = r.verdict || deriveVerdict(r.aiScore);
      if (filterApplicable && v === 'BLOCK') blockedAll.push(r);
      if (filterOn && filterApplicable && v === 'BLOCK') continue;
      visible.push(r);
      if (r.aiScore == null) unscored++;
      if (v === 'WARN_HIGH' || v === 'WARN_LOW') flagged++;
      else clean++;
    }

    // Strict-mode detection: every visible result came back unscored. Show a
    // single banner instead of plastering "AI: ?" across every card.
    _bulkUnscored = filterApplicable && visible.length > 0 && unscored === visible.length;
    renderFilterStatusBanner(_bulkUnscored, results);

    // Persistent blocked-results bar under the search nav. Surfaces every
    // BLOCKed (>25% AI) item as a clickable chip — each opens the standard
    // diagnostics popover. Independent of the "Show anyway" toggle in the
    // banner above; this bar always shows what got filtered.
    renderBlockedBar(blockedAll);

    // Note: the "N results hidden / Show anyway / Why?" banner was removed
    // 2026-05-26 (user request) — the blocked-results bar above already
    // shows each blocked item with its own click-to-open diagnostics, and
    // the "Hide >25% AI" toggle in the results-meta-controls row still
    // works as the kill-switch.

    // Stats line
    statsEl.innerHTML =
      'About <strong>' + results.length + '</strong> ' + tabLabel(tab) +
      ' for <strong>"' + escapeHtml(q) + '"</strong> &middot; ' +
      visible.length + ' shown' +
      (flagOn && flagged > 0 ? ' (' + flagged + ' flagged)' : '');

    if (visible.length === 0) {
      listEl.innerHTML = '<div class="loading">No results to show.</div>';
      return;
    }

    // Dispatch to per-tab renderer
    const renderer = TAB_RENDERERS[tab] || renderWebList;
    listEl.innerHTML = renderer(visible, flagOn);
  }

  function tabLabel(t) {
    return ({
      all: 'results', images: 'images', videos: 'videos',
      news: 'news stories', forums: 'discussions', shopping: 'products', maps: 'places',
    }[t] || 'results');
  }

  // ============================================================
  //   PER-TAB RENDERERS
  // ============================================================
  const TAB_RENDERERS = {
    all:      renderWebList,
    web:      renderWebList,
    news:     renderNews,
    forums:   renderForums,
    images:   renderImages,
    videos:   renderVideos,
    shopping: renderShopping,
    maps:     renderMaps,
  };

  function renderWebList(results, flagOn) {
    return results.map(r => renderWebResult(r, flagOn)).join('');
  }
  function renderWebResult(r, flagOn) {
    const badge = aiBadge(r, flagOn);
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

  function renderImages(results, flagOn) {
    return `<div class="image-grid">${results.map((r, i) => {
      const src = r.imageUrl || placeholderSvg(seedFor(r, i), 400, 300, initials(r.title));
      const linkUrl = r.sourceUrl || r.url || '#';
      return `
      <a class="image-card" href="${escapeAttr(linkUrl)}" target="_blank" rel="noopener" title="${escapeAttr(r.title || '')}">
        <img src="${escapeAttr(src)}" alt="${escapeAttr(r.title || '')}" loading="lazy"
             onerror="this.src='${escapeAttr(placeholderSvg(seedFor(r, i), 400, 300, initials(r.title)))}'" />
        <div class="image-card-caption">${escapeHtml(r.title || '(untitled)')}</div>
        <div class="image-card-source">${escapeHtml(r.source || hostFor(linkUrl))}</div>
        ${aiBadge(r, flagOn)}
      </a>`;
    }).join('')}</div>`;
  }

  function renderVideos(results, flagOn) {
    return `<div class="video-list">${results.map((r, i) => {
      const thumb = r.thumbUrl || placeholderSvg(seedFor(r, i), 320, 180, initials(r.title));
      return `
      <a class="video-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <div class="video-thumb">
          <img src="${escapeAttr(thumb)}" alt="" loading="lazy"
               onerror="this.src='${escapeAttr(placeholderSvg(seedFor(r, i), 320, 180, initials(r.title)))}'" />
          ${r.duration ? `<span class="video-duration">${escapeHtml(r.duration)}</span>` : ''}
        </div>
        <div class="video-meta">
          <div class="video-title">${escapeHtml(r.title || '(untitled)')} ${aiBadge(r, flagOn)}</div>
          <div class="video-channel">${escapeHtml(r.channel || hostFor(r.url))}</div>
          <div class="video-stats">${r.views ? escapeHtml(r.views) + ' views' : ''}${r.views && r.postedAt ? ' &middot; ' : ''}${escapeHtml(r.postedAt || '')}</div>
        </div>
      </a>`;
    }).join('')}</div>`;
  }

  function renderNews(results, flagOn) {
    return `<div class="news-list">${results.map((r, i) => {
      const thumb = r.thumbUrl || placeholderSvg(seedFor(r, i), 120, 90, initials(r.title));
      return `
      <a class="news-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <div class="news-thumb"><img src="${escapeAttr(thumb)}" alt="" loading="lazy"
             onerror="this.src='${escapeAttr(placeholderSvg(seedFor(r, i), 120, 90, initials(r.title)))}'" /></div>
        <div>
          <div class="news-outlet">${escapeHtml(r.outlet || hostFor(r.url))}${r.publishedAt ? ' &middot; ' + escapeHtml(r.publishedAt) : ''}</div>
          <div class="news-headline">${escapeHtml(r.title || '(untitled)')} ${aiBadge(r, flagOn)}</div>
          <div class="news-snippet">${escapeHtml(r.snippet || '')}</div>
        </div>
      </a>`;
    }).join('')}</div>`;
  }

  function renderForums(results, flagOn) {
    return `<div class="forum-list">${results.map(r => `
      <a class="forum-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <div class="forum-meta"><strong>${escapeHtml(r.forum)}</strong> &middot; ${r.replies} replies &middot; ${escapeHtml(r.age)}</div>
        <div class="forum-title">${escapeHtml(r.title)} ${aiBadge(r, flagOn)}</div>
        <div class="forum-snippet">${escapeHtml(r.snippet)}</div>
      </a>
    `).join('')}</div>`;
  }

  function renderShopping(results) {
    return `<div class="shopping-grid">${results.map((r, i) => {
      const thumb = r.thumbUrl || placeholderSvg(seedFor(r, i), 180, 180, initials(r.title));
      return `
      <a class="product-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <img src="${escapeAttr(thumb)}" alt="" loading="lazy"
             onerror="this.src='${escapeAttr(placeholderSvg(seedFor(r, i), 180, 180, initials(r.title)))}'" />
        <div class="product-title">${escapeHtml(r.title || '(untitled)')}</div>
        ${r.price ? `<div class="product-price">${escapeHtml(r.price)}</div>` : ''}
        ${r.rating != null ? `<div class="product-rating">&#9733; ${r.rating}${r.reviews != null ? ' (' + r.reviews + ')' : ''}</div>` : ''}
        <div class="product-seller">${escapeHtml(r.seller || hostFor(r.url))}${r.shipping ? ' &middot; ' + escapeHtml(r.shipping) : ''}</div>
      </a>`;
    }).join('')}</div>`;
  }

  function renderMaps(results) {
    const mapGraphic = `
      <div class="map-canvas" aria-label="Map preview">
        <svg viewBox="0 0 600 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" width="100%" height="100%">
          <rect width="600" height="200" fill="#e8efe4"/>
          <path d="M0 80 Q150 60 300 90 T600 75" stroke="#9ab98a" stroke-width="3" fill="none"/>
          <path d="M0 150 Q200 130 400 155 T600 145" stroke="#9ab98a" stroke-width="3" fill="none"/>
          <path d="M120 0 L130 200" stroke="#c0b090" stroke-width="6" fill="none"/>
          <path d="M340 0 L355 200" stroke="#c0b090" stroke-width="6" fill="none"/>
          <path d="M480 0 L470 200" stroke="#c0b090" stroke-width="6" fill="none"/>
          <path d="M0 110 L600 105" stroke="#b89e6e" stroke-width="4" fill="none"/>
          <circle cx="180" cy="105" r="6" fill="#c00"/>
          <circle cx="320" cy="60"  r="6" fill="#c00"/>
          <circle cx="430" cy="130" r="6" fill="#c00"/>
          <circle cx="500" cy="80"  r="6" fill="#c00"/>
          <circle cx="100" cy="150" r="6" fill="#c00"/>
          <text x="10" y="195" font-family="MS Sans Serif, Tahoma, sans-serif" font-size="10" fill="#666">Map preview &mdash; live map coming soon</text>
        </svg>
      </div>`;
    if (!results || results.length === 0) {
      return mapGraphic + '<div class="loading" style="text-align:center;">No places found for this query.</div>';
    }
    const cards = results.map(r => {
      // Worker currently returns web-shaped results regardless of tab, so fall
      // back to title/snippet/url when the maps-specific fields are missing.
      const name    = r.name    || r.title || '(untitled place)';
      const type    = r.type    || hostFor(r.url);
      const address = r.address || r.snippet || '';
      const hasHours = !!r.hours;
      const openClass = hasHours && /open/i.test(r.hours) && !/closed/i.test(r.hours) ? 'map-hours-open' : 'map-hours-closed';
      const metaBits = [
        r.rating != null ? `&#9733; ${r.rating}${r.reviews != null ? ' &middot; ' + r.reviews + ' reviews' : ''}` : '',
      ].filter(Boolean).join('');
      const addrBits = [
        address ? escapeHtml(address) : '',
        hasHours ? `<span class="${openClass}">${escapeHtml(r.hours)}</span>` : '',
        r.phone ? escapeHtml(r.phone) : '',
      ].filter(Boolean).join(' &middot; ');
      return `
      <a class="map-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <div class="map-name">${escapeHtml(name)}</div>
        <div class="map-type">${escapeHtml(type)}</div>
        ${metaBits ? `<div class="map-rating">${metaBits}</div>` : ''}
        ${addrBits ? `<div class="map-address">${addrBits}</div>` : ''}
      </a>`;
    }).join('');
    return mapGraphic + `<div class="map-list">${cards}</div>`;
  }

  // ============================================================
  //   KNOWLEDGE CARD + SIDEBAR
  // ============================================================
  function renderKnowledge(card) {
    if (!card) { knowledgeEl.style.display = 'none'; return; }
    knowledgeEl.style.display = 'grid';
    const topFacts   = card.facts.slice(0, 3);
    const extraFacts = card.facts.slice(3);
    const factsHTML = topFacts.map(([k, v]) =>
      `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
    const moreHTML = extraFacts.length
      ? `<a href="#" class="knowledge-card-more" id="kc-more">+${extraFacts.length} more</a>`
      : '';
    knowledgeEl.innerHTML = `
      <img class="knowledge-card-image" src="${escapeAttr(card.image)}" alt="${escapeAttr(card.title)}" />
      <div class="knowledge-card-content">
        <h2>${escapeHtml(card.title)}</h2>
        <div class="knowledge-card-kind">${escapeHtml(card.kind)}</div>
        <div class="knowledge-card-summary">${escapeHtml(card.summary)}</div>
        <dl class="knowledge-card-facts" id="kc-facts">${factsHTML}</dl>
        <div class="knowledge-card-source">Source: ${escapeHtml(card.source)}${moreHTML}</div>
      </div>
    `;
    if (extraFacts.length) {
      const moreLink = document.getElementById('kc-more');
      const facts    = document.getElementById('kc-facts');
      moreLink.addEventListener('click', (e) => {
        e.preventDefault();
        facts.innerHTML = card.facts.map(([k, v]) =>
          `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('');
        moreLink.remove();
      });
    }
  }

  function renderSidebar(entities) {
    if (!entities || entities.length === 0) {
      sidebarEl.style.display = 'none';
      resultsBody.classList.add('no-sidebar');
      return;
    }
    sidebarEl.style.display = 'flex';
    resultsBody.classList.remove('no-sidebar');
    sidebarEl.innerHTML = `
      <div class="sidebar-card">
        <div class="sidebar-card-title">Related</div>
        <div class="sidebar-card-body">
          ${entities.map(e => `
            <a class="sidebar-entity" href="${escapeAttr(e.url)}" target="_blank" rel="noopener">
              <img src="${escapeAttr(e.image)}" alt="" />
              <div style="min-width:0;">
                <div class="sidebar-entity-label">${escapeHtml(e.label)}</div>
                <div class="sidebar-entity-value">${escapeHtml(e.value)}</div>
              </div>
            </a>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ============================================================
  //   AI BADGE / HELPERS
  // ============================================================
  // Stash each result's envelope so the popover can fetch it back by id when
  // a badge is clicked (DOM event handlers can't easily carry object refs).
  const ENVELOPE_REGISTRY = new Map();
  let _envelopeIdCounter = 0;
  function registerEnvelope(r) {
    const id = 'ai-env-' + (++_envelopeIdCounter);
    ENVELOPE_REGISTRY.set(id, r);
    return id;
  }

  // Set by render() before per-result aiBadge calls. When true, the analyzer
  // returned null for every visible item (strict mode, no detector configured).
  // In that case we suppress per-result "AI: ?" badges to avoid plastering the
  // entire page with shrugs — a single status banner explains it instead.
  let _bulkUnscored = false;

  function aiBadge(r, flagOn) {
    // flagOn now controls whether ANY inline AI badge shows. When off, the
    // user sees a clean result list with no AI annotation. Default = on.
    if (!flagOn) return '';
    const score = r.aiScore;
    const v = r.verdict || deriveVerdict(score);
    let cls, content, label;
    if (score == null) {
      // Strict mode / no detector — banner handles bulk case, suppress inline.
      // For one-off failures (e.g. analyze fetch error on a single item) show
      // a small unknown badge so user can click for the failure reason.
      if (_bulkUnscored) return '';
      cls = 'ai-badge unknown';
      content = 'AI: ?';
      label = 'AI score unavailable — click for details';
    } else if (v === 'BLOCK') {
      // BLOCK results normally filtered out of view; appears inline only when
      // user clicked "Show anyway" on the filtered banner OR they're rendered
      // in the blocked-results bar at the top.
      cls = 'ai-badge blocked';
      content = '&#9888; AI: ' + score.toFixed(0) + '%';
      label = 'Filtered: above ' + FILTER_THRESHOLD + '% AI — click for details';
    } else if (v === 'WARN_HIGH') {
      // 10–25%: yellow, always shown
      cls = 'ai-badge flagged';
      content = '&#9888; AI: ' + score.toFixed(0) + '%';
      label = 'Possibly AI-generated (' + score.toFixed(1) + '%) — click for details';
    } else {
      // <10% (CLEAN or WARN_LOW): green, always shown
      cls = 'ai-badge clean';
      content = '&#10003; AI: ' + score.toFixed(0) + '%';
      label = 'Human-likely (' + score.toFixed(1) + '%) — click for details';
    }
    const id = registerEnvelope(r);
    return `<button type="button" class="${cls}" data-env-id="${id}" aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}">${content}</button>`;
  }

  // ============================================================
  //   DIAGNOSTICS POPOVER ("fail loudly" surface for the AI filter)
  // ============================================================
  // Listens at document level so it works for badges injected by ANY renderer
  // (including ones added after the listener was wired up).
  document.addEventListener('click', (e) => {
    const badge = e.target.closest && e.target.closest('.ai-badge');
    if (badge && badge.dataset.envId) {
      e.preventDefault();
      e.stopPropagation();
      const r = ENVELOPE_REGISTRY.get(badge.dataset.envId);
      openDiagnosticsPopover(badge, r);
      return;
    }
    // Click outside an open popover → close it.
    if (!e.target.closest || !e.target.closest('.ai-popover')) {
      closeDiagnosticsPopover();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDiagnosticsPopover();
  });

  let _openPopoverEl = null;
  function closeDiagnosticsPopover() {
    if (_openPopoverEl) {
      _openPopoverEl.remove();
      _openPopoverEl = null;
    }
  }

  function openDiagnosticsPopover(anchorEl, r) {
    closeDiagnosticsPopover();
    const env = (r && r.aiEnvelope) || null;
    const score = r ? r.aiScore : null;
    const verdict = r ? (r.verdict || deriveVerdict(score)) : 'CLEAN';
    const pop = document.createElement('div');
    pop.className = 'ai-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'AI filter diagnostics');
    pop.innerHTML = renderDiagnostics(env, score, verdict, r);
    document.body.appendChild(pop);

    // Position next to the badge, clamped to viewport
    const rect = anchorEl.getBoundingClientRect();
    const popW = 340;
    let left = rect.left + window.scrollX;
    if (left + popW > window.scrollX + window.innerWidth - 8) {
      left = window.scrollX + window.innerWidth - popW - 8;
    }
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    pop.style.left = left + 'px';
    pop.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    pop.style.width = popW + 'px';

    // Close button inside
    const closeBtn = pop.querySelector('.ai-popover-close');
    if (closeBtn) closeBtn.addEventListener('click', closeDiagnosticsPopover);

    _openPopoverEl = pop;
  }

  function renderSpellSuggest(suggestion) {
    if (!spellSuggest) return;
    // suggestion can be: string (the corrected query) or null/undefined.
    if (!suggestion || typeof suggestion !== 'string' || suggestion.trim() === '' || suggestion.trim().toLowerCase() === q.trim().toLowerCase()) {
      spellSuggest.style.display = 'none';
      spellSuggest.innerHTML = '';
      return;
    }
    const corrected = suggestion.trim();
    // Build a results.html link at the corrected query, preserving current tab/toggles.
    const p = new URLSearchParams(window.location.search);
    p.set('q', corrected);
    spellSuggest.style.display = 'block';
    spellSuggest.innerHTML =
      'Did you mean: <a href="/results.html?' + escapeAttr(p.toString()) + '" id="spell-take"><i>' + escapeHtml(corrected) + '</i></a>?';
  }

  function renderBlockedBar(blockedAll) {
    if (!blockedBar) return;
    if (!blockedAll || blockedAll.length === 0) {
      blockedBar.style.display = 'none';
      blockedBar.innerHTML = '';
      return;
    }
    const chips = blockedAll.map(r => {
      const id    = registerEnvelope(r);
      const score = r.aiScore == null ? '?' : r.aiScore.toFixed(0) + '%';
      const host  = hostFor(r.url) || (r.title ? r.title.slice(0, 24) : 'unknown');
      const title = r.title || host;
      return `<button type="button" class="blocked-chip ai-badge blocked" data-env-id="${id}" ` +
             `title="${escapeAttr(title)} — click for details" ` +
             `aria-label="${escapeAttr(title)} — blocked at ${score} AI">` +
             `<span class="chip-host">${escapeHtml(host)}</span>` +
             `<span class="chip-score">&#9888; ${score}</span>` +
             `</button>`;
    }).join('');
    blockedBar.style.display = 'flex';
    blockedBar.innerHTML =
      `<span class="blocked-bar-label">` +
        `<span class="blocked-bar-icon" aria-hidden="true">&#9888;</span> ` +
        `<strong>${blockedAll.length}</strong> blocked &gt;${FILTER_THRESHOLD}% AI:` +
      `</span>` +
      `<div class="blocked-bar-chips">${chips}</div>`;
  }

  function renderFilterStatusBanner(bulkUnscored, results) {
    if (!filterStatus) return;
    if (!bulkUnscored) { filterStatus.style.display = 'none'; filterStatus.innerHTML = ''; return; }
    // Pull a representative envelope so the popover surfaces real warnings.
    const sample = results.find(r => r && r.aiEnvelope) || null;
    const id = registerEnvelope({
      title: 'AI filter status',
      url: '',
      aiScore: null,
      verdict: 'CLEAN',
      aiEnvelope: (sample && sample.aiEnvelope) || {
        aiScore: null,
        verdict: 'CLEAN',
        source: 'no-detector',
        warnings: ['no-real-backend:strict-mode'],
      },
    });
    filterStatus.style.display = 'block';
    filterStatus.innerHTML =
      '<span class="status-icon" aria-hidden="true">&#9432;</span> ' +
      '<strong>AI filter idle</strong> &mdash; no detector configured, all results shown unfiltered. ' +
      '<a href="#" data-status-env-id="' + id + '">Why?</a>';
    const link = filterStatus.querySelector('a[data-status-env-id]');
    if (link) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openStrictModeExplainer(e.currentTarget, ENVELOPE_REGISTRY.get(link.dataset.statusEnvId));
      });
    }
  }

  function openStrictModeExplainer(anchorEl, r) {
    closeDiagnosticsPopover();
    const env = (r && r.aiEnvelope) || {};
    const warnings = env.warnings || [];
    const warningsHtml = warnings.length
      ? '<ul class="ai-popover-list ai-popover-warnings">' + warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('') + '</ul>'
      : '<div class="ai-popover-empty">No warnings emitted &mdash; analyzer just declined to score.</div>';
    const pop = document.createElement('div');
    pop.className = 'ai-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'AI filter status');
    pop.innerHTML =
      '<div class="ai-popover-titlebar">' +
        '<span class="ai-popover-title">AI filter &mdash; idle (strict mode)</span>' +
        '<button type="button" class="ai-popover-close" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="ai-popover-body">' +
        '<div class="ai-popover-because">' +
          'The Stone Search AI detector refused to score these results because no real detection backend is configured on the Worker. ' +
          'Strict mode is on by default in production &mdash; the analyzer would rather return <b>null</b> than invent a score. ' +
        '</div>' +
        '<div class="ai-popover-section">' +
          '<div class="ai-popover-section-hdr">Source</div>' +
          '<div>' + escapeHtml(env.source || 'no-detector') + '</div>' +
        '</div>' +
        '<div class="ai-popover-section">' +
          '<div class="ai-popover-section-hdr">Diagnostics</div>' +
          warningsHtml +
        '</div>' +
        '<div class="ai-popover-section">' +
          '<div class="ai-popover-section-hdr">How to enable detection</div>' +
          '<ol class="ai-popover-howto">' +
            '<li>Set <code>HF_API_TOKEN</code> (free Hugging Face tier) <em>or</em> <code>HIVE_API_KEY</code> (paid) on the Worker:<br>' +
              '<code>wrangler secret put HF_API_TOKEN</code></li>' +
            '<li>Redeploy: <code>npm run deploy</code></li>' +
            '<li>Or for dev/preview only, set <code>ALLOW_MOCK=1</code> to fall back to mock scores.</li>' +
          '</ol>' +
        '</div>' +
        '<div class="ai-popover-foot">Until a backend is configured, all results pass through and the AI filter shows no badges.</div>' +
      '</div>';
    document.body.appendChild(pop);
    const rect = anchorEl.getBoundingClientRect();
    const popW = 380;
    let left = rect.left + window.scrollX;
    if (left + popW > window.scrollX + window.innerWidth - 8) left = window.scrollX + window.innerWidth - popW - 8;
    if (left < window.scrollX + 8) left = window.scrollX + 8;
    pop.style.left = left + 'px';
    pop.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    pop.style.width = popW + 'px';
    pop.querySelector('.ai-popover-close').addEventListener('click', closeDiagnosticsPopover);
    _openPopoverEl = pop;
  }

  // Note: openHiddenListPopover() was removed 2026-05-26 along with the
  // #filter-summary banner that called it — the blocked-results bar at the
  // top of the page now surfaces every hidden item with its own
  // click-to-open diagnostics, so the bulk popover became redundant.

  function renderDiagnostics(env, score, verdict, r) {
    // Em-dashes are real chars here, NOT &mdash;, because this text gets
    // escapeHtml-ed before being inserted (so entities would double-escape).
    const VERDICT_LABEL = {
      BLOCK:     { tag: 'Blocked',      why: 'Scored above the ' + FILTER_THRESHOLD + '% block threshold — the analyzer is confident this page is largely AI-generated. Hidden from results by default.', cls: 'v-block'   },
      WARN_HIGH: { tag: 'Flagged',      why: 'Scored in the ' + WARN_HIGH_THRESHOLD + '–' + FILTER_THRESHOLD + '% band — signs of AI involvement but not enough confidence to block. Shown with a yellow badge.', cls: 'v-warn-h' },
      WARN_LOW:  { tag: 'Likely human', why: 'Scored under ' + WARN_HIGH_THRESHOLD + '% — trace AI signal but most likely human-written. Shown with a green badge.', cls: 'v-warn-l' },
      CLEAN:     { tag: 'Likely human', why: 'Scored at or near 0% — analyzer found no meaningful AI signal. Shown with a green badge.', cls: 'v-clean' },
    };
    const meta = VERDICT_LABEL[verdict] || VERDICT_LABEL.CLEAN;

    const rows = [];
    rows.push(`<div class="ai-popover-row"><span class="lbl">Verdict</span><span class="val ${meta.cls}">${meta.tag}</span></div>`);
    rows.push(`<div class="ai-popover-row"><span class="lbl">AI score</span><span class="val">${score == null ? '—' : score.toFixed(1) + '%'}</span></div>`);
    if (env && env.base_score != null) {
      rows.push(`<div class="ai-popover-row"><span class="lbl">Base score</span><span class="val">${(+env.base_score).toFixed(1)}%</span></div>`);
    }
    if (env && env.override) {
      rows.push(`<div class="ai-popover-row"><span class="lbl">Override</span><span class="val v-override">${escapeHtml(env.override)}</span></div>`);
    }
    if (env && env.source) {
      rows.push(`<div class="ai-popover-row"><span class="lbl">Source</span><span class="val">${escapeHtml(env.source)}</span></div>`);
    }
    if (env && env.cache) {
      rows.push(`<div class="ai-popover-row"><span class="lbl">Cache</span><span class="val">${escapeHtml(env.cache)}</span></div>`);
    }

    // Modality breakdown
    let modalityHtml = '';
    if (env && env.modality) {
      const m = env.modality;
      const w = env.weights || { text: 0, image: 0 };
      const parts = [];
      if (m.text) {
        parts.push(`<div class="ai-popover-modal"><div class="m-hdr">Text &middot; weight ${(w.text*100).toFixed(0)}%</div>` +
          `<div class="m-row">Raw: <b>${(+m.text.score).toFixed(1)}%</b> &middot; effective: <b>${(+m.text.score_effective).toFixed(1)}%</b></div>` +
          `<div class="m-row">Confidence: ${(+m.text.confidence * 100).toFixed(0)}% &middot; ${m.text.chars} chars &middot; backend: ${escapeHtml(m.text.backend || '?')}</div>` +
        `</div>`);
      }
      if (m.image) {
        parts.push(`<div class="ai-popover-modal"><div class="m-hdr">Image &middot; weight ${(w.image*100).toFixed(0)}%</div>` +
          `<div class="m-row">Aggregate: <b>${(+m.image.score).toFixed(1)}%</b>${m.image.score_effective != null ? ' &middot; effective: <b>' + (+m.image.score_effective).toFixed(1) + '%</b>' : ''}</div>` +
          `<div class="m-row">${m.image.count || 1} image${m.image.count === 1 ? '' : 's'}${m.image.confidence != null ? ' &middot; confidence: ' + (+m.image.confidence * 100).toFixed(0) + '%' : ''}${m.image.max_effective != null ? ' &middot; max: ' + (+m.image.max_effective).toFixed(1) + '%' : ''}</div>` +
        `</div>`);
      }
      if (parts.length) modalityHtml = `<div class="ai-popover-section"><div class="ai-popover-section-hdr">Modality breakdown</div>${parts.join('')}</div>`;
    }

    const thresholdsHtml = env && env.thresholds
      ? `<div class="ai-popover-foot">Thresholds &middot; block&gt;${env.thresholds.BLOCK}% &middot; warn-high&ge;${env.thresholds.WARN_HIGH}% &middot; warn-low&gt;${env.thresholds.WARN_LOW}%</div>`
      : `<div class="ai-popover-foot">Thresholds &middot; block&gt;${FILTER_THRESHOLD}% &middot; warn-high&ge;${WARN_HIGH_THRESHOLD}%</div>`;

    const linkUrl = r && r.url ? `<a class="ai-popover-link" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">${escapeHtml(hostFor(r.url) || r.url)}</a>` : '';

    // Provenance (C2PA) and Diagnostics sections intentionally removed per
    // user request 2026-05-26 — popover now shows verdict + score + modality
    // breakdown only.
    return `
      <div class="ai-popover-titlebar">
        <span class="ai-popover-title">AI filter &mdash; why ${meta.tag.toLowerCase()}?</span>
        <button type="button" class="ai-popover-close" aria-label="Close">&times;</button>
      </div>
      <div class="ai-popover-body">
        <div class="ai-popover-because">${escapeHtml(meta.why)}</div>
        ${linkUrl}
        <div class="ai-popover-rows">${rows.join('')}</div>
        ${modalityHtml}
        ${thresholdsHtml}
      </div>
    `;
  }

  function deriveVerdict(score) {
    if (score == null) return 'CLEAN';
    if (score >  FILTER_THRESHOLD)    return 'BLOCK';
    if (score >= WARN_HIGH_THRESHOLD) return 'WARN_HIGH';
    if (score >  0)                   return 'WARN_LOW';
    return 'CLEAN';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ============================================================
  //   FALLBACK HELPERS — keep tabs renderable when the Worker
  //   returns web-shaped results regardless of ?tab=
  // ============================================================
  const PALETTE = ['#5a7a9a','#8a6a4a','#4a7a5a','#a06040','#605070','#8a8a4a','#4a6080','#7a5060','#506a4a','#90704a','#4a5a70','#a06080'];
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function seedFor(r, i) { return (r && (r.url || r.title)) || ('idx-' + i); }
  function hostFor(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
  }
  function initials(title) {
    if (!title) return '?';
    const t = String(title).trim();
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return t.slice(0, 2).toUpperCase();
  }
  function placeholderSvg(seed, w, h, label) {
    const bg = PALETTE[hashStr(String(seed)) % PALETTE.length];
    const text = String(label || '?').slice(0, 14);
    const fontSize = Math.round(Math.min(w, h) * (text.length > 4 ? 0.18 : 0.34));
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' +
        '<rect width="' + w + '" height="' + h + '" fill="' + bg + '"/>' +
        '<text x="' + (w/2) + '" y="' + (h/2) + '" text-anchor="middle" dominant-baseline="central" ' +
          'font-family="MS Sans Serif, Tahoma, sans-serif" font-size="' + fontSize + '" ' +
          'font-weight="bold" fill="rgba(255,255,255,0.85)">' + escapeXmlText(text) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml;base64,' + btoa(svg);
  }
  function escapeXmlText(s) {
    return String(s).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
  }
})();
