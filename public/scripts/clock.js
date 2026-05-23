// Win95-style taskbar clock
(function () {
  function tick() {
    const el = document.getElementById('clock');
    if (!el) return;
    const now = new Date();
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    el.textContent = `${h}:${m} ${ampm}`;
  }
  tick();
  setInterval(tick, 30 * 1000);
})();
