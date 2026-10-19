// Admin app start-up: runs last, once every other file of public/js is loaded.
$('agenda-date').value = todayStr();
$('agenda-day').textContent = cap(dayLabel(todayStr()));
$('agenda-list').innerHTML = Array.from({ length: 3 }, () =>
  '<div class="sk-row"><div class="skeleton" style="height:36px"></div><div style="display:grid;gap:8px"><div class="skeleton" style="height:16px;width:40%"></div><div class="skeleton" style="height:14px;width:65%"></div></div></div>').join('');
showTab(tabFromPath(), false);
reload();
