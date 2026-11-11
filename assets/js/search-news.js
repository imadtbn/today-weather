// 9. SEARCH SERVICE
// ============================================
const SearchService = {
    input: null, suggestions: null, timer: null, requestId: 0,
    init() {
        this.input = document.getElementById('searchInput');
        this.suggestions = document.getElementById('citySuggestions');
        if (!this.input || !this.suggestions) return;
        this.input.addEventListener('input', e => this._onInput(e));
        this.input.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = this.input.value.trim();
                if (query.length >= 2) this._search(query, true);
            }
        });
        this.input.addEventListener('focus', () => {
            if (this.input.value.length >= 2) this._onInput({ target: this.input });
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
        if (q.length < 2) { this.requestId++; this._hide(); return; }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this._search(q, false), 250);
    },

    async _search(q, allowRemote = false) {
        const requestId = ++this.requestId;
        const results = await GeoService.searchCities(q, allowRemote);
        if (requestId !== this.requestId || q !== this.input?.value.trim()) return;
        this._render(results, allowRemote);
    },

    _render(list, remoteRequested = false) {
        if (!list?.length) {
            this.suggestions.innerHTML = `<div class="city-suggestion-empty">${remoteRequested ? 'لم نعثر على نتائج لهذه المدينة.' : 'اكتب اسم مدينة جزائرية أو اضغط Enter للبحث الموسع.'}</div>`;
            this.suggestions.classList.add('visible');
            return;
        }
        this.suggestions.innerHTML = list.slice(0, 8).map(c => `
            <div class="city-suggestion-item" data-lat="${Number(c.lat)}" data-lon="${Number(c.lon)}" data-name="${escapeHTML(c.name)}" data-display="${escapeHTML(c.displayName || c.name)}" data-state="${escapeHTML(c.state || '')}" data-country="${escapeHTML(c.country || 'الجزائر')}">
                <div class="city-name">${escapeHTML(c.name)}</div>
                <div class="city-region">${escapeHTML(c.state ? c.state + ' - ' : '')}${escapeHTML(c.country || 'الجزائر')}</div>
            </div>
        `).join('');
        this.suggestions.classList.add('visible');
    },

    _hide() { this.suggestions?.classList.remove('visible'); },

    _select(ds) {
        const loc = {
            lat: Number(ds.lat), lon: Number(ds.lon),
            name: ds.name, state: ds.state || '', country: ds.country || 'الجزائر',
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
