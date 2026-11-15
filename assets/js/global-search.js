(function () {
  'use strict';
  var BASE = '/today-weather';
  var input, panel, items = [], results = [], active = -1, ready = false, timer;
  var geoController = null, searchToken = 0;
  var MAX_SUGGESTIONS = 4;
  var GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

  function normalize(value) {
    return String(value || '').toLocaleLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/ـ/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }

  function ensureSearch() {
    input = document.getElementById('searchInput');
    panel = document.getElementById('citySuggestions');
    if (input && panel) return;
    var host = document.querySelector('.city-topbar-inner');
    if (!host) return;
    var wrapper = document.createElement('div');
    wrapper.className = 'search-wrapper global-search-wrapper';
    wrapper.innerHTML = '<input type="search" class="search-input" id="searchInput" placeholder="ابحث عن أي مدينة في العالم..." aria-label="ابحث عن أي مدينة في العالم" role="combobox" autocomplete="off" aria-autocomplete="list" aria-haspopup="listbox" aria-controls="citySuggestions" aria-expanded="false"><i class="fas fa-search search-icon" aria-hidden="true"></i><div class="city-suggestions" id="citySuggestions" role="listbox" aria-label="أربعة اقتراحات للمدن والصفحات" aria-live="polite"></div>';
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
    if (!item) return;
    if (item.type === 'global-city') {
      var params = new URLSearchParams({
        weather_lat: String(item.latitude),
        weather_lon: String(item.longitude),
        weather_name: item.name || '',
        weather_country: item.country || '',
        weather_admin: item.admin1 || ''
      });
      window.location.href = BASE + '/?' + params.toString();
      return;
    }
    if (!item.path) return;
    var target = item.path.charAt(0) === '/' ? BASE + item.path : item.path;
    window.location.href = target;
  }

  function render(loading) {
    var query = normalize(input.value);
    if (query.length < 2) { results = []; hide(); return; }
    active = -1;
    panel.textContent = '';
    if (!results.length) {
      var empty = document.createElement('div');
      empty.className = 'city-suggestion-empty';
      empty.setAttribute('role', 'status');
      empty.textContent = loading ? 'جارٍ البحث في المدن حول العالم…' : (ready ? 'لا توجد نتائج. جرّب اسماً أو لغة أخرى.' : 'جارٍ تحميل فهرس البحث…');
      panel.appendChild(empty);
    } else {
      results.slice(0, MAX_SUGGESTIONS).forEach(function (item, index) {
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
        if (item.type === 'global-city') {
          detail.textContent = [item.admin1, item.country].filter(Boolean).join(' · ') + ' · مدينة عالمية';
        } else {
          detail.textContent = (item.type === 'city' ? 'مدينة · ' : item.type === 'section' ? 'قسم · ' : 'صفحة · ') + (item.detail || '');
        }
        button.appendChild(name);
        button.appendChild(detail);
        panel.appendChild(button);
      });
      if (loading) {
        var status = document.createElement('div');
        status.className = 'city-suggestion-status';
        status.textContent = 'جارٍ استكمال البحث العالمي…';
        panel.appendChild(status);
      }
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

  function queryLanguages(value) {
    if (/[\u0600-\u06FF]/.test(value)) return ['ar', 'en'];
    if (/[\u0400-\u04FF]/.test(value)) return ['ru', 'en'];
    if (/[\u0370-\u03FF]/.test(value)) return ['el', 'en'];
    if (/[\u0590-\u05FF]/.test(value)) return ['he', 'en'];
    if (/[\u0900-\u097F]/.test(value)) return ['hi', 'en'];
    if (/[\u0E00-\u0E7F]/.test(value)) return ['th', 'en'];
    if (/[\u3040-\u30FF]/.test(value)) return ['ja', 'en'];
    if (/[\uAC00-\uD7AF]/.test(value)) return ['ko', 'en'];
    if (/[\u4E00-\u9FFF]/.test(value)) return ['zh', 'en'];
    var browserLanguage = String(navigator.language || 'en').slice(0, 2).toLowerCase();
    return Array.from(new Set(['en', 'fr', browserLanguage])).slice(0, 3);
  }

  function localMatches(query) {
    return items.map(function (item) { return { item: item, score: score(item, query) }; })
      .filter(function (entry) { return entry.score > 0; })
      .sort(function (a, b) { return b.score - a.score || a.item.name.localeCompare(b.item.name, 'ar'); })
      .slice(0, MAX_SUGGESTIONS).map(function (entry) { return entry.item; });
  }

  async function searchGlobal(rawQuery) {
    var query = normalize(rawQuery);
    if (query.length < 2) { results = []; hide(); return; }
    var token = ++searchToken;
    if (geoController) geoController.abort();
    geoController = new AbortController();
    var localResults = localMatches(query);
    results = localResults.slice(0, 2);
    render(true);

    var languages = queryLanguages(rawQuery);
    var requests = languages.map(function (language) {
      var params = new URLSearchParams({ name: rawQuery.trim(), count: '8', language: language, format: 'json' });
      return fetch(GEOCODING_URL + '?' + params.toString(), {
        signal: geoController.signal,
        headers: { Accept: 'application/json' }
      }).then(function (response) {
        if (!response.ok) throw new Error('Geocoding request failed: ' + response.status);
        return response.json();
      });
    });

    try {
      var responses = await Promise.allSettled(requests);
      if (token !== searchToken || normalize(input.value) !== query) return;
      var globalCities = [];
      responses.forEach(function (response) {
        if (response.status !== 'fulfilled' || !Array.isArray(response.value.results)) return;
        response.value.results.forEach(function (place) {
          if (!Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) return;
          var city = {
            type: 'global-city',
            id: place.id,
            name: place.name || '',
            country: place.country || '',
            countryCode: place.country_code || '',
            admin1: place.admin1 || '',
            latitude: Number(place.latitude),
            longitude: Number(place.longitude),
            population: Number(place.population || 0)
          };
          var duplicate = globalCities.some(function (existing) {
            return existing.id === city.id || (Math.abs(existing.latitude - city.latitude) < 0.01 &&
              Math.abs(existing.longitude - city.longitude) < 0.01);
          });
          if (!duplicate) globalCities.push(city);
        });
      });
      globalCities.sort(function (a, b) { return b.population - a.population; });
      var localCityKeys = results.filter(function (item) { return item.type === 'city'; })
        .map(function (item) { return normalize(item.name); });
      globalCities = globalCities.filter(function (place) {
        return !localCityKeys.includes(normalize(place.name));
      });
      results = results.concat(globalCities).slice(0, MAX_SUGGESTIONS);
      if (results.length < MAX_SUGGESTIONS) {
        localResults.forEach(function (item) {
          if (results.length >= MAX_SUGGESTIONS) return;
          if (!results.some(function (existing) { return existing.path === item.path; })) results.push(item);
        });
      }
      render(false);
    } catch (error) {
      if (error.name === 'AbortError' || token !== searchToken) return;
      render(false);
    }
  }

  function init() {
    if (window.__todayWeatherGlobalSearchInitialized) return;
    ensureSearch();
    if (!input || !panel) return;
    window.__todayWeatherGlobalSearchInitialized = true;
    input.placeholder = 'ابحث عن أي مدينة في العالم…';
    input.setAttribute('aria-label', 'ابحث عن أي مدينة في العالم');
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { searchGlobal(input.value); }, 220);
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
    var hasAppController = !!document.querySelector('script[src$="app.js"]');
    if (!hasAppController) {
      var menu = document.getElementById('mobileMenuBtn');
      var nav = document.getElementById('mainNav');
      if (menu && nav && !menu.dataset.globalSearchMenuBound) {
        menu.dataset.globalSearchMenuBound = 'true';
        menu.addEventListener('click', function () {
          var open = nav.classList.toggle('active');
          menu.setAttribute('aria-expanded', String(open));
          menu.setAttribute('aria-label', open ? 'إغلاق قائمة التنقل' : 'فتح قائمة التنقل');
        });
      }
      var locationButton = document.getElementById('locationBtn');
      if (locationButton && !locationButton.dataset.globalSearchLocationBound) {
        locationButton.dataset.globalSearchLocationBound = 'true';
        locationButton.addEventListener('click', function () { window.location.href = BASE + '/#home'; });
      }
    }
    input.addEventListener('focus', function () {
      if (input.value.trim().length >= 2) searchGlobal(input.value);
    });
    fetch(BASE + '/data/global-search-index.json', { credentials: 'same-origin' })
      .then(function (response) { if (!response.ok) throw new Error('Search index unavailable'); return response.json(); })
      .then(function (data) {
        items = Array.isArray(data) ? data : [];
        ready = true;
        if (input.value.trim().length >= 2) searchGlobal(input.value);
      })
      .catch(function () { ready = true; if (input.value.trim().length >= 2) searchGlobal(input.value); });
  }

  window.GlobalSearch = { init: init, search: function (query) { if (input) { input.value = query || ''; searchGlobal(input.value); } } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();