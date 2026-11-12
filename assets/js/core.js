// ═══════════════════════════════════════════════════════════════
//  الطقس الجزائري - Algeria Weather Pro
//  كود موحد ومحسّن | آخر تحديث: 2026-06-29
// ═══════════════════════════════════════════════════════════════

// ============================================
// 1. CONFIGURATION
// ============================================
function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

async function fetchWithTimeout(url, options = {}, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

const CONFIG = {
    OPENWEATHER_API_KEY: '1151122405b6f7be33bf0de4b22bb5a4',
    DEFAULT_LOCATION: {
        lat: 36.752887,
        lon: 3.042048,
        name: 'الجزائر العاصمة',
        state: 'الجزائر العاصمة',
        country: 'الجزائر',
        displayName: 'الجزائر العاصمة / الجزائر العاصمة / الجزائر'
    },
    REFRESH_INTERVAL: 25 * 60 * 1000,
    CACHE_DURATION: 25 * 60 * 1000,
    GEO_TIMEOUT: 10000,
    API_BASE_URL: 'https://api.openweathermap.org/data/2.5',
    GEO_API_URL: 'https://api.openweathermap.org/geo/1.0',
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org',
    TILE_URL: 'https://tile.openweathermap.org/map'
};

// ============================================
// 2. STATE & CACHE
// ============================================
const AppState = {
    currentLocation: null,
    currentWeather: null,
    forecastData: null,
    temperatureChart: null,
    currentLayer: 'temperature',
    tileLayers: {},
    isLoading: false,
    lastUpdate: null,

    init() {
        const cached = LocationCache.get();
        const age = cached ? Date.now() - Number(cached.timestamp) : Infinity;
        const location = cached?.data;
        const validCoordinates = Number.isFinite(Number(location?.lat)) &&
            Number.isFinite(Number(location?.lon)) &&
            Math.abs(Number(location.lat)) <= 90 &&
            Math.abs(Number(location.lon)) <= 180;
        if (cached && age >= 0 && age < CONFIG.CACHE_DURATION && validCoordinates) {
            this.currentLocation = { ...location, lat: Number(location.lat), lon: Number(location.lon) };
            return this.currentLocation;
        }
        this.currentLocation = { ...CONFIG.DEFAULT_LOCATION };
        return this.currentLocation;
    },

    setLocation(location) {
        this.currentLocation = location;
        LocationCache.set(location);
    },

    setWeather(data) {
        this.currentWeather = data;
        this.lastUpdate = Date.now();
    }
};

const LocationCache = {
    KEY: 'algeria_weather_location_v2',
    set(location) {
        try {
            localStorage.setItem(this.KEY, JSON.stringify({
                data: location,
                timestamp: Date.now()
            }));
        } catch (e) { console.warn('[Cache] Save failed:', e); }
    },
    get() {
        try {
            const raw = localStorage.getItem(this.KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
};

// ============================================
// 2.1 FAVORITE LOCATIONS
// ============================================
const FavoriteLocations = {
    KEY: 'today_weather_favorite_locations_v1',
    MAX_ITEMS: 12,
    get() {
        try {
            const items = JSON.parse(localStorage.getItem(this.KEY) || '[]');
            if (!Array.isArray(items)) return [];
            return items.filter(item =>
                item && Number.isFinite(Number(item.lat)) &&
                Number.isFinite(Number(item.lon)) &&
                Math.abs(Number(item.lat)) <= 90 && Math.abs(Number(item.lon)) <= 180
            ).slice(0, this.MAX_ITEMS);
        } catch (error) {
            console.warn('[Favorites] Read failed:', error);
            return [];
        }
    },
    key(location) {
        return `${Number(location.lat).toFixed(4)},${Number(location.lon).toFixed(4)}`;
    },
    has(location) {
        if (!location) return false;
        const key = this.key(location);
        return this.get().some(item => this.key(item) === key);
    },
    toggle(location) {
        const items = this.get();
        const key = this.key(location);
        const index = items.findIndex(item => this.key(item) === key);
        if (index >= 0) {
            items.splice(index, 1);
            this.save(items);
            return { saved: false, items };
        }
        if (items.length >= this.MAX_ITEMS) return { saved: false, limitReached: true, items };
        items.push({
            lat: Number(location.lat), lon: Number(location.lon),
            name: String(location.name || location.displayName || 'مدينة').slice(0, 100),
            state: String(location.state || '').slice(0, 100),
            country: String(location.country || '').slice(0, 100),
            displayName: String(location.displayName || location.name || 'مدينة').slice(0, 220)
        });
        this.save(items);
        return { saved: true, items };
    },
    remove(location) {
        const key = this.key(location);
        const items = this.get().filter(item => this.key(item) !== key);
        this.save(items);
        return items;
    },
    save(items) {
        try { localStorage.setItem(this.KEY, JSON.stringify(items.slice(0, this.MAX_ITEMS))); }
        catch (error) { console.warn('[Favorites] Save failed:', error); }
    }
};

// ============================================
// 3. NOTIFICATION
// ============================================
const Notify = {
    el: null, txt: null, timer: null,
    init() {
        this.el = document.getElementById('alertBanner');
        this.txt = document.getElementById('alertText');
        document.getElementById('closeAlert')?.addEventListener('click', () => this.hide());
    },
    show(msg, type = 'info', duration = 5000) {
        if (this.timer) clearTimeout(this.timer);
        this.txt.textContent = msg;
        this.el.className = `alert-banner visible ${type}`;
        if (duration > 0) this.timer = setTimeout(() => this.hide(), duration);
    },
    hide() { this.el?.classList.remove('visible'); },
    loading(msg) { this.show(msg, 'info', 0); },
    success(msg) { this.show(msg, 'success', 3000); },
    error(msg) { this.show(msg, 'error', 6000); },
    warning(msg) { this.show(msg, 'warning', 5000); }
};

// ============================================
