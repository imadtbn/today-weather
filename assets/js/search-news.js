// 9. SEARCH SERVICE
// ============================================
const SearchService = {
    input: null, suggestions: null, timer: null, requestId: 0,
    activeIndex: -1, results: [],
    init() {
        this.input = document.getElementById('searchInput');
        this.suggestions = document.getElementById('citySuggestions');
        if (!this.input || !this.suggestions) return;
        this.input.addEventListener('input', e => this._onInput(e));
        this.input.addEventListener('keydown', e => this._onKeyDown(e));
        this.input.addEventListener('focus', () => {
            if (this.input.value.trim().length >= 2) this._onInput({ target: this.input });
        });
        this.suggestions.addEventListener('click', e => {
            const item = e.target.closest('.city-suggestion-item');
            if (item) this._select(item.dataset);
        });
        document.addEventListener('click', e => {
            if (!e.target.closest('.search-wrapper')) this._hide();
        });
    },

    _onInput(e) {
        const q = e.target.value.trim();
        if (q.length < 2) {
            this.requestId++;
            this.results = [];
            this._hide();
            return;
        }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._search(q, false), 250);
    },

    _onKeyDown(e) {
        const options = this.suggestions?.querySelectorAll('.city-suggestion-item') || [];
        if (e.key === 'ArrowDown' && options.length) {
            e.preventDefault();
            this._setActive(this.activeIndex < options.length - 1 ? this.activeIndex + 1 : 0);
        } else if (e.key === 'ArrowUp' && options.length) {
            e.preventDefault();
            this._setActive(this.activeIndex > 0 ? this.activeIndex - 1 : options.length - 1);
        } else if (e.key === 'Escape') {
            this._hide();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.activeIndex >= 0 && this.results[this.activeIndex]) {
                this._select(this.results[this.activeIndex]);
            } else if (options.length) {
                this._select(this.results[0]);
            } else {
                const query = this.input.value.trim();
                if (query.length >= 2) this._search(query, true);
            }
        }
    },

    _setActive(index) {
        const options = [...(this.suggestions?.querySelectorAll('.city-suggestion-item') || [])];
        if (!options.length) return;
        this.activeIndex = index;
        options.forEach((option, i) => {
            const selected = i === index;
            option.setAttribute('aria-selected', String(selected));
            if (selected) {
                this.input.setAttribute('aria-activedescendant', option.id);
                option.scrollIntoView({ block: 'nearest' });
            }
        });
    },

    async _search(q, allowRemote = false) {
        const requestId = ++this.requestId;
        this.suggestions.setAttribute('aria-busy', 'true');
        if (allowRemote) {
            this.suggestions.textContent = 'جارٍ البحث عن المدينة...';
            this.suggestions.classList.add('visible');
        }
        try {
            const results = await GeoService.searchCities(q, allowRemote);
            if (requestId !== this.requestId || q !== this.input?.value.trim()) return;
            this._render(results, allowRemote);
        } finally {
            if (requestId === this.requestId) this.suggestions.removeAttribute('aria-busy');
        }
    },

    _render(list, remoteRequested = false) {
        this.results = Array.isArray(list) ? list.slice(0, 8) : [];
        this.activeIndex = -1;
        this.input?.removeAttribute('aria-activedescendant');
        if (!this.results.length) {
            this.suggestions.innerHTML = `<div class="city-suggestion-empty" role="status">${remoteRequested ? 'لم نعثر على نتائج لهذه المدينة.' : 'لا توجد نتائج محلية. اضغط Enter للبحث الموسع.'}</div>`;
            this.suggestions.classList.add('visible');
            this.input?.setAttribute('aria-expanded', 'true');
            return;
        }
        this.suggestions.innerHTML = this.results.map((c, index) => `
            <button type="button" class="city-suggestion-item" role="option" id="city-option-${this.requestId}-${index}" aria-selected="false" tabindex="-1"
                data-lat="${Number(c.lat)}" data-lon="${Number(c.lon)}" data-name="${escapeHTML(c.name)}"
                data-display="${escapeHTML(c.displayName || c.name)}" data-state="${escapeHTML(c.state || '')}"
                data-country="${escapeHTML(c.country || 'الجزائر')}">
                <span class="city-name">${escapeHTML(c.name)}</span>
                <span class="city-region">${escapeHTML(c.state ? c.state + ' - ' : '')}${escapeHTML(c.country || 'الجزائر')}</span>
            </button>
        `).join('');
        this.suggestions.classList.add('visible');
        this.input?.setAttribute('aria-expanded', 'true');
    },

    _hide() {
        this.suggestions?.classList.remove('visible');
        this.input?.setAttribute('aria-expanded', 'false');
        this.input?.removeAttribute('aria-activedescendant');
        this.activeIndex = -1;
    },

    _select(ds) {
        if (!ds) return;
        const lat = Number(ds.lat), lon = Number(ds.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const loc = {
            lat, lon, name: ds.name, state: ds.state || '', country: ds.country || 'الجزائر',
            displayName: ds.display || ds.name
        };
        this.input.value = ds.name;
        this._hide();
        App.setLocation(loc);
    }
};

// ============================================
// 10. NEWS SERVICE
// ============================================
const NewsService = {
    async fetch() {
        // لا نعرض أخباراً تجريبية على أنها أخبار حقيقية أو مباشرة.
        return [];
    },
    render(data) {
        const container = document.getElementById('newsGrid');
        if (!container) return;
        if (!Array.isArray(data) || data.length === 0) {
            container.textContent = 'لا تتوفر حالياً أخبار موثقة من مصدر إخباري متصل.';
            return;
        }
        container.innerHTML = data.map(item => {
            const category = ['alert', 'weather', 'climate'].includes(item.category) ? item.category : 'weather';
            const image = typeof item.image === 'string' && /^https?:\/\//i.test(item.image) ? escapeHTML(item.image) : '';
            const categoryLabel = category === 'alert' ? 'تحذير' : category === 'weather' ? 'طقس' : 'مناخ';
            return `
                <div class="news-card">
                    <div class="news-image"><img src="${image}" alt="${escapeHTML(item.title)}" loading="lazy"></div>
                    <div class="news-content">
                        <span class="news-category ${category}">${categoryLabel}</span>
                        <h3 class="news-title">${escapeHTML(item.title)}</h3>
                        <p class="news-excerpt">${escapeHTML(item.excerpt)}</p>
                        <div class="news-meta"><span><i class="fas fa-clock"></i> ${escapeHTML(item.time)}</span></div>
                    </div>
                </div>
            `;
        }).join('');
    }
};

// ============================================
