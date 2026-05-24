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
  const filterBanner = document.getElementById('filter-summary');
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

    // Only Web / News / Forums (text content) go through the AI analyzer.
    // Images/Videos already have aiLikely from the per-modality mock.
    if (tab === 'all' || tab === 'web' || tab === 'news' || tab === 'forums') {
      return Promise.all(items.map(async (item) => {
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
          };
        } catch (e) {
          return { ...item, aiScore: null };
        }
      }));
    }
    // For images/videos, use aiLikely directly
    return items.map(it => ({
      ...it,
      aiScore: it.aiLikely,
      verdict: deriveVerdict(it.aiLikely),
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

    let hidden = 0;
    let flagged = 0;
    let clean = 0;
    const visible = [];

    for (const r of results) {
      const v = r.verdict || deriveVerdict(r.aiScore);
      if (filterOn && filterApplicable && v === 'BLOCK') { hidden++; continue; }
      visible.push(r);
      if (v === 'WARN_HIGH' || v === 'WARN_LOW') flagged++;
      else clean++;
    }

    // Banner for hidden items
    if (hidden > 0 && filterOn && filterApplicable) {
      filterBanner.style.display = 'block';
      filterBanner.innerHTML =
        '&#9888; <strong>' + hidden + '</strong> result' + (hidden === 1 ? '' : 's') +
        ' hidden for scoring over ' + FILTER_THRESHOLD + '% AI-generated. ' +
        '<a href="#" id="show-hidden">Show anyway</a>';
      filterBanner.querySelector('#show-hidden').addEventListener('click', (e) => {
        e.preventDefault();
        filterToggle.checked = false;
        render(allResults);
      });
    } else {
      filterBanner.style.display = 'none';
    }

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
    return `<div class="image-grid">${results.map(r => `
      <a class="image-card" href="${escapeAttr(r.sourceUrl)}" target="_blank" rel="noopener" title="${escapeAttr(r.title)}">
        <img src="${escapeAttr(r.imageUrl)}" alt="${escapeAttr(r.title)}" loading="lazy" />
        <div class="image-card-caption">${escapeHtml(r.title)}</div>
        <div class="image-card-source">${escapeHtml(r.source)}</div>
        ${aiBadge(r, flagOn)}
      </a>
    `).join('')}</div>`;
  }

  function renderVideos(results, flagOn) {
    return `<div class="video-list">${results.map(r => `
      <a class="video-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <div class="video-thumb">
          <img src="${escapeAttr(r.thumbUrl)}" alt="" loading="lazy" />
          <span class="video-duration">${escapeHtml(r.duration)}</span>
        </div>
        <div class="video-meta">
          <div class="video-title">${escapeHtml(r.title)} ${aiBadge(r, flagOn)}</div>
          <div class="video-channel">${escapeHtml(r.channel)}</div>
          <div class="video-stats">${escapeHtml(r.views)} views &middot; ${escapeHtml(r.postedAt)}</div>
        </div>
      </a>
    `).join('')}</div>`;
  }

  function renderNews(results, flagOn) {
    return `<div class="news-list">${results.map(r => `
      <a class="news-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <div class="news-thumb"><img src="${escapeAttr(r.thumbUrl)}" alt="" loading="lazy" /></div>
        <div>
          <div class="news-outlet">${escapeHtml(r.outlet)} &middot; ${escapeHtml(r.publishedAt)}</div>
          <div class="news-headline">${escapeHtml(r.title)} ${aiBadge(r, flagOn)}</div>
          <div class="news-snippet">${escapeHtml(r.snippet)}</div>
        </div>
      </a>
    `).join('')}</div>`;
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
    return `<div class="shopping-grid">${results.map(r => `
      <a class="product-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <img src="${escapeAttr(r.thumbUrl)}" alt="" loading="lazy" />
        <div class="product-title">${escapeHtml(r.title)}</div>
        <div class="product-price">${escapeHtml(r.price)}</div>
        <div class="product-rating">&#9733; ${r.rating} (${r.reviews})</div>
        <div class="product-seller">${escapeHtml(r.seller)} &middot; ${escapeHtml(r.shipping)}</div>
      </a>
    `).join('')}</div>`;
  }

  function renderMaps(results) {
    return `<div class="map-list">${results.map(r => {
      const openClass = /open/i.test(r.hours) && !/closed/i.test(r.hours) ? 'map-hours-open' : 'map-hours-closed';
      return `
      <a class="map-card" href="${escapeAttr(r.url)}" target="_blank" rel="noopener">
        <div class="map-name">${escapeHtml(r.name)}</div>
        <div class="map-type">${escapeHtml(r.type)}</div>
        <div class="map-rating">&#9733; ${r.rating} &middot; ${r.reviews} reviews</div>
        <div class="map-address">${escapeHtml(r.address)} &middot; <span class="${openClass}">${escapeHtml(r.hours)}</span> &middot; ${escapeHtml(r.phone)}</div>
      </a>`;
    }).join('')}</div>`;
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
  function aiBadge(r, flagOn) {
    const score = r.aiScore;
    const v = r.verdict || deriveVerdict(score);
    if (score == null) return '<span class="ai-badge" title="AI score unavailable">AI: ?</span>';
    if (v === 'WARN_HIGH' && flagOn) {
      return `<span class="ai-badge flagged" title="Possibly AI-generated (${score.toFixed(1)}%)">&#9888; AI: ${score.toFixed(0)}%</span>`;
    }
    if (v === 'WARN_LOW' && flagOn) {
      return `<span class="ai-badge subtle" title="Trace AI content (${score.toFixed(1)}%)" aria-label="Trace AI content">&#9679;</span>`;
    }
    return '';
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
})();
