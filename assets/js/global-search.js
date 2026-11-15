(function () {
  'use strict';
  var BASE = '/today-weather';
  var input, panel, items = [], results = [], active = -1, ready = false, timer;

  function normalize(value) {
    return String(value || '').toLocaleLowerCase()
      .normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[\\u064B-\\u065F\\u0670]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/ـ/g, '').replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim();
  }

  function ensureSearch() {
    input = document.getElementById('searchInput');
    panel = document.getElementById('citySuggestions');
    if (input && panel) return;
    var host = document.querySelector('.city-topbar-inner');
    if (!host) return;
    var wrapper = document.createElement('div');
    wrapper.className = 'search-wrapper global-search-wrapper';
    wrapper.innerHTML = '<input type="search" class="search-input" id="searchInput" placeholder="ابحث في الموقع والمدن العالمية..." aria-label="ابحث في الموقع والمدن العالمية" role="combobox" autocomplete="off" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="citySuggestions" aria-expanded="false"><i class="fas fa-search search-icon" aria-hidden="true"></i><div class="city-suggestions" id="citySuggestions" role="listbox" aria-label="نتائج البحث الشامل" aria-live="polite"></div>';
    host.appendChild(wrapper);
    input = wrapper.querySelector('#searchInput');
    panel = wrapper.querySelector('#citySuggestions');
  }

  function score(item, query) {
    var fields = [item.name, item.latin, item.detail, item.terms].map(normalize);
    var best = 0;
    fields.forEach(function (field) {
      if (!field) return;
      if (field === query) best = Math.max(best, 100);
      else if (field.indexOf(query) === 0) best = Math.max(best, 80);
      else if (field.split(' ').some(function (word) { return word.indexOf(query) === 0; })) best = Math.max(best, 65);
      else if (field.indexOf(query) >= 0) best = Math.max(best, 45);
      else {
        var tokens = query.split(' ').filter(Boolean);
        if (tokens.length > 1 && tokens.every(function (token) { return field.indexOf(token) >= 0; })) best = Math.max(best, 35);
      }
    });
    if (item.type === 'city' && best) best += 4;
    return best;
  }

  function hide() {
    if (!panel || !input) return;
    panel.classList.remove('visible');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function select(index) {
    var item = results[index];
    if (!item || !item.path) return;
    var target = item.path.charAt(0) === '/' ? BASE + item.path : item.path;
    window.location.href = target;
  }

  function render() {
    var query = normalize(input.value);
    if (query.length < 2) { results = []; hide(); return; }
    results = items.map(function (item) { return { item: item, score: score(item, query) }; })
      .filter(function (entry) { return entry.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.item.name.localeCompare(b.item.name, 'ar'); })
      .slice(0, 10).map(function (entry) { return entry.item; });
    active = -1;
    panel.textContent = '';
    if (!results.length) {
      var empty = document.createElement('div');
      empty.className = 'city-suggestion-empty';
      empty.setAttribute('role', 'status');
      empty.textContent = ready ? 'لا توجد نتائج مطابقة. جرّب اسماً آخر.' : 'جارٍ تحميل فهرس البحث…';
      panel.appendChild(empty);
    } else {
      results.forEach(function (item, index) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'city-suggestion-item';
        button.id = 'global-search-option-' + index;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', 'false');
        button.dataset.index = String(index);
        var name = document.createElement('span');
        name.className = 'city-name';
        name.textContent = item.name || '';
        var detail = document.createElement('span');
        detail.className = 'city-region';
        detail.textContent = (item.type === 'city' ? 'مدينة · ' : item.type === 'section' ? 'قسم · ' : 'صفحة · ') + (item.detail || '');
        button.appendChild(name);
        button.appendChild(detail);
        panel.appendChild(button);
      });
    }
    panel.classList.add('visible');
    input.setAttribute('aria-expanded', 'true');
  }

  function setActive(next) {
    var buttons = panel.querySelectorAll('.city-suggestion-item');
    if (!buttons.length) return;
    active = (next + buttons.length) % buttons.length;
    Array.prototype.forEach.call(buttons, function (button, index) {
      var selected = index === active;
      button.setAttribute('aria-selected', String(selected));
      if (selected) {
        input.setAttribute('aria-activedescendant', button.id);
        button.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function init() {
    if (window.__todayWeatherGlobalSearchInitialized) return;
    window.__todayWeatherGlobalSearchInitialized = true;
    ensureSearch();
    if (!input || !panel) return;
    input.placeholder = 'ابحث في الموقع والمدن العالمية...';
    input.setAttribute('aria-label', 'ابحث في الموقع والمدن العالمية');
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(render, 90);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(active + 1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(active < 0 ? 0 : active - 1); }
      else if (event.key === 'Enter') {
        if (results.length) { event.preventDefault(); select(active >= 0 ? active : 0); }
      } else if (event.key === 'Escape') hide();
    });
    panel.addEventListener('click', function (event) {
      var button = event.target.closest('.city-suggestion-item');
      if (button) select(Number(button.dataset.index));
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.search-wrapper')) hide();
    });
    var menu = document.getElementById('mobileMenuBtn');
    var nav = document.getElementById('mainNav');
    if (menu && nav && !menu.dataset.globalSearchMenuBound) {
      menu.dataset.globalSearchMenuBound = 'true';
      menu.addEventListener('click', function () {
        var open = nav.classList.toggle('active');
        menu.setAttribute('aria-expanded', String(open));
      });
    }
    var locationButton = document.getElementById('locationBtn');
    if (locationButton && !locationButton.dataset.globalSearchLocationBound) {
      locationButton.dataset.globalSearchLocationBound = 'true';
      locationButton.addEventListener('click', function () { window.location.href = BASE + '/#home'; });
    }
    fetch(BASE + '/data/global-search-index.json', { credentials: 'same-origin' })
      .then(function (response) { if (!response.ok) throw new Error('Search index unavailable'); return response.json(); })
      .then(function (data) { items = Array.isArray(data) ? data : []; ready = true; if (input.value.trim().length >= 2) render(); })
      .catch(function () { ready = true; panel.textContent = 'تعذر تحميل البحث حالياً. أعد تحميل الصفحة.'; panel.classList.add('visible'); });
  }

  window.GlobalSearch = { init: init, search: function (query) { if (input) { input.value = query || ''; render(); } } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();