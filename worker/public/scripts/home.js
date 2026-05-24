// Homepage interactions
(function () {
  const form = document.getElementById('search-form');
  const input = document.getElementById('q');
  const filterEnabled = document.getElementById('filter-enabled');
  const flagEnabled = document.getElementById('flag-enabled');

  // Persist filter prefs across sessions
  try {
    const stored = JSON.parse(localStorage.getItem('stone.prefs') || '{}');
    if (typeof stored.filter === 'boolean') filterEnabled.checked = stored.filter;
    if (typeof stored.flag === 'boolean') flagEnabled.checked = stored.flag;
  } catch (e) {}

  function savePrefs() {
    try {
      localStorage.setItem('stone.prefs', JSON.stringify({
        filter: filterEnabled.checked,
        flag: flagEnabled.checked,
      }));
    } catch (e) {}
  }
  filterEnabled.addEventListener('change', savePrefs);
  flagEnabled.addEventListener('change', savePrefs);

  form.addEventListener('submit', function (e) {
    if (!input.value.trim()) {
      e.preventDefault();
      input.focus();
      return;
    }
    const params = new URLSearchParams();
    params.set('q', input.value.trim());
    params.set('filter', filterEnabled.checked ? '1' : '0');
    params.set('flag', flagEnabled.checked ? '1' : '0');
    e.preventDefault();
    window.location.href = '/results.html?' + params.toString();
  });
})();
