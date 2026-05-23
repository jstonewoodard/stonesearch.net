// Ad Tab collapse/expand — state persisted in localStorage
(function () {
  const KEY = 'stone.adtab.collapsed';
  const tab = document.getElementById('ad-tab');
  const btn = document.getElementById('ad-tab-toggle');
  if (!tab || !btn) return;

  function apply(collapsed) {
    document.body.classList.toggle('adtab-collapsed', collapsed);
    btn.setAttribute('aria-label', collapsed ? 'Expand ad tab' : 'Collapse ad tab');
    btn.setAttribute('title',      collapsed ? 'Expand'        : 'Collapse');
    const icon = btn.querySelector('.ad-tab-toggle-icon');
    if (icon) icon.innerHTML = collapsed ? '&#9654;' : '&#9664;';
  }

  // Restore prior state
  let initial = false;
  try { initial = localStorage.getItem(KEY) === '1'; } catch (e) {}
  apply(initial);

  btn.addEventListener('click', function () {
    const now = !document.body.classList.contains('adtab-collapsed');
    apply(now);
    try { localStorage.setItem(KEY, now ? '1' : '0'); } catch (e) {}
  });

  // Also allow clicking the collapsed strip to re-expand
  tab.addEventListener('click', function (e) {
    if (!document.body.classList.contains('adtab-collapsed')) return;
    if (e.target === btn || btn.contains(e.target)) return;
    apply(false);
    try { localStorage.setItem(KEY, '0'); } catch (e) {}
  });
})();
