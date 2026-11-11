// 12. APP CONTROLLER
// ============================================
const App = {
    refreshTimer: null,
    weatherRequestId: 0,

    async init() {
        this._registerServiceWorker();
        console.log('%c[Algeria Weather Pro] Starting...', 'color:#d4a853; font-size:14px; font-weight:bold;');
        Notify.init();
        UI.init();
        SearchService.init();
        AppState.init();

        // أولاً: تحميل الخريطة
        MapService.init();

        // ثانياً: طلب الموقع (GPS إذا لم يوجد cache)
        await this._checkLocation();

        // ثالثاً: تحميل البيانات
        await this.loadWeather();
        await this.loadNews();

        // رابعاً: التحديث التلقائي والأحداث
        this._setupAutoRefresh();
        this._setupEvents();
        initStarField();

        // GSAP animations
        if (window.gsap && window.ScrollTrigger) {
            gsap.registerPlugin(ScrollTrigger);
            gsap.utils.toArray('.weather-card, .forecast-card, .stat-card, .tip-card').forEach(el => {
                gsap.from(el, { scrollTrigger: { trigger: el, start: 'top 85%' }, y: 30, opacity: 0, duration: 0.6, ease: 'power2.out' });
            });
        }
    },


    _registerServiceWorker() {
        if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .catch(error => console.warn('[PWA] Service worker registration failed:', error));
    },

    async _checkLocation() {
        const cached = LocationCache.get();
        const timestamp = Number(cached?.timestamp);
        const location = cached?.data;
        const age = Date.now() - timestamp;
        const lat = Number(location?.lat);
        const lon = Number(location?.lon);
        const validCache = Number.isFinite(timestamp) && age >= 0 && age < CONFIG.CACHE_DURATION &&
            Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
        if (validCache) {
            AppState.currentLocation = { ...location, lat, lon };
            Notify.success(`مرحباً بك في ${location.displayName || location.name}`);
            return;
        }
        // لا يوجد cache صالح: نطلب GPS
        await this.updateFromGPS();
    },

    async updateFromGPS() {
        UI.setLocLoading(true);
        try {
            const pos = await GeoService.requestGPS();
            const { latitude: lat, longitude: lon } = pos.coords;
            const loc = await GeoService.reverseGeocode(lat, lon);
            AppState.setLocation(loc);
            Notify.success(`تم تحديد موقعك: ${loc.displayName}`);
            MapService.setView(lat, lon, 10);
            MapService.updateMarker(lat, lon, loc.displayName);
        } catch (err) {
            console.error('[App] GPS error:', err);
            Notify.error(err.message);
            // Fallback
            AppState.setLocation({ ...CONFIG.DEFAULT_LOCATION });
            Notify.warning('تم استخدام الموقع الافتراضي: الجزائر العاصمة');
        } finally {
            UI.setLocLoading(false);

        }
    },

    async loadWeather() {
        const requestId = ++this.weatherRequestId;
        UI.setLoading(true);
        Notify.loading('جارٍ تحميل بيانات الطقس...');

        try {
            const loc = { ...AppState.currentLocation };
            const [current, forecast] = await Promise.all([
                WeatherService.fetchCurrent(loc.lat, loc.lon),
                WeatherService.fetchForecast(loc.lat, loc.lon)
            ]);

            if (requestId !== this.weatherRequestId) return;
            AppState.setWeather(current);
            AppState.forecastData = forecast;

            UI.updateCurrentWeather(current, loc);
            UI.updateHourly(forecast);
            UI.updateDaily(forecast);
            UI.updateSea(current);
            UI.updateStats(current, forecast);
            UI.updateTips(current);
            UI.updateChart(forecast);
            UI.updateTime();
            UI.setApiStatus(true);

            MapService.updateMarker(loc.lat, loc.lon, loc.displayName || loc.name);
            Notify.success('تم تحديث بيانات الطقس بنجاح');

        } catch (err) {
            if (requestId !== this.weatherRequestId) return;
            console.error('[App] Weather error:', err);
            Notify.error(`خطأ في جلب البيانات: ${err.message}`);
            UI.setApiStatus(false);

            // Fallback: إذا كان الموقع الحالي ليس الافتراضي، نحاول بالافتراضي
            if (AppState.currentLocation.name !== CONFIG.DEFAULT_LOCATION.name) {
                Notify.warning('جارٍ المحاولة بالموقع الافتراضي...');
                AppState.setLocation({ ...CONFIG.DEFAULT_LOCATION });
                await this.loadWeather();
            }
        } finally {
            if (requestId === this.weatherRequestId) UI.setLoading(false);
        }
    },

    async loadNews() {
        try {
            const data = await NewsService.fetch();
            NewsService.render(data);
        } catch (e) { console.error('[App] News error:', e); }
    },

    setLocation(loc) {
        AppState.setLocation(loc);
        this.loadWeather();
        MapService.setView(loc.lat, loc.lon, 10);
        MapService.updateMarker(loc.lat, loc.lon, loc.displayName || loc.name);
    },

    _setupAutoRefresh() {
        if (this.refreshTimer) clearInterval(this.refreshTimer);
        this.refreshTimer = setInterval(() => this.loadWeather(), CONFIG.REFRESH_INTERVAL);
        console.log(`[App] Auto-refresh every ${CONFIG.REFRESH_INTERVAL / 60000} min`);
    },

    _setupEvents() {
        // تحديث الطقس
        document.getElementById('refreshWeather')?.addEventListener('click', () => this.loadWeather());

        // تحديث الموقع
        document.getElementById('locationBtn')?.addEventListener('click', () => this.updateFromGPS());

        // تحديث الأخبار
        document.getElementById('refreshNews')?.addEventListener('click', () => this.loadNews());

        // قائمة الجوال
        document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
            document.getElementById('mainNav')?.classList.toggle('active');
        });

        // طبقات الخريطة
        document.querySelectorAll('.map-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.map-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                MapService.setLayer(this.dataset.layer);
            });
        });

        // روابط المدن في الفوتر
        document.querySelectorAll('[data-city]').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                const nameMap = { "Algiers": "الجزائر العاصمة", "Oran": "وهران", "Constantine": "قسنطينة", "Annaba": "عنابة", "Blida": "البليدة", "Setif": "سطيف" };
                const cityName = nameMap[e.target.closest('[data-city]').dataset.city];
                const city = ALGERIAN_CITIES.find(c => c.name === cityName);
                if (city) {
                    this.setLocation({
                        lat: city.lat, lon: city.lon, name: city.name, state: city.state, country: 'الجزائر',
                        displayName: GeoService._buildDisplayName(city.name, city.state, 'الجزائر')
                    });
                }
            });
        });

        // تنقل سلس
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                if (href?.startsWith('#')) {
                    e.preventDefault();
                    const target = document.getElementById(href.substring(1));
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth' });
                        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                        this.classList.add('active');
                        document.getElementById('mainNav')?.classList.remove('active');
                    }
                }
            });
        });

        // زر العودة للأعلى
        document.getElementById('scrollTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

        // إخفاء/إظهار الهيدر
        let lastScroll = 0;
        window.addEventListener('scroll', () => {
            const cur = window.pageYOffset;
            const header = document.getElementById('siteHeader');
            const topBtn = document.getElementById('scrollTop');
            if (header) {
                if (cur > lastScroll && cur > 100) header.classList.add('hidden');
                else header.classList.remove('hidden');
                header.classList.toggle('scrolled', cur > 50);
            }
            if (topBtn) topBtn.classList.toggle('visible', cur > 300);
            lastScroll = cur;
        });
    }
};

// ============================================
// 13. BOOT
// ============================================
document.addEventListener('DOMContentLoaded', () => App.init());
