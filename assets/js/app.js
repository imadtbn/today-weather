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
        CubeWeather.init();
        SearchService.init();
        AppState.init();
        UI.renderFavoriteLocations(AppState.currentLocation);

        // تفعيل عناصر الواجهة فوراً قبل أي طلب شبكي أو انتظار GPS.
        this._setupEvents();

        // أولاً: تحميل الخريطة
        MapService.init();

        // تشغيل الزخارف بعد خمول المتصفح حتى لا تنافس عرض بيانات الطقس.
        this._scheduleVisualEnhancements();

        // ثانياً: تحديد الموقع ثم تحميل البيانات
        await this._checkLocation();
        await this.loadWeather();
        await this.loadNews();

        // التحديث التلقائي بعد اكتمال التهيئة الأولية
        this._setupAutoRefresh();
    },


    _registerServiceWorker() {
        const localSecureHost = ['localhost', '127.0.0.1'].includes(location.hostname);
        if (!('serviceWorker' in navigator) || (!window.isSecureContext && !localSecureHost)) return;
        navigator.serviceWorker.register('./sw.js', { scope: './' })
            .catch(error => console.warn('[PWA] Service worker registration failed:', error));
    },

    _scheduleVisualEnhancements() {
        const run = () => {
            if (typeof initStarField === 'function') initStarField();
            this._initScrollAnimations();
        };

        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(run, { timeout: 2500 });
        } else {
            window.setTimeout(run, 1600);
        }
    },

    _initScrollAnimations() {
        if (!window.gsap) return;

        const elements = document.querySelectorAll(
            '.weather-card, .forecast-card, .stat-card, .tip-card'
        );
        if (!elements.length) return;

        const animate = element => {
            gsap.from(element, {
                y: 22,
                opacity: 0,
                duration: 0.45,
                ease: 'power2.out',
                clearProps: 'transform,opacity'
            });
        };

        if (!('IntersectionObserver' in window)) {
            elements.forEach(animate);
            return;
        }

        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                animate(entry.target);
                observer.unobserve(entry.target);
            });
        }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

        elements.forEach(element => observer.observe(element));
    },

    _getCachedLocation() {
        const cached = LocationCache.get();
        const location = cached?.data;
        const lat = Number(location?.lat);
        const lon = Number(location?.lon);
        const timestamp = Number(cached?.timestamp);
        const validTimestamp = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now();
        const validCoordinates = Number.isFinite(lat) && Number.isFinite(lon) &&
            Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
        if (!validTimestamp || !validCoordinates) return null;
        return { ...location, lat, lon };
    },

    async _checkLocation() {
        // A globally searched city is applied before GPS and saved as the active location.
        const params = new URLSearchParams(window.location.search);
        const lat = Number(params.get('weather_lat'));
        const lon = Number(params.get('weather_lon'));
        if (params.has('weather_lat') && params.has('weather_lon') &&
            Number.isFinite(lat) && Number.isFinite(lon) &&
            Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
            const name = params.get('weather_name') || 'مدينة مختارة';
            const country = params.get('weather_country') || '';
            const state = params.get('weather_admin') || '';
            const location = {
                lat, lon, name, state, country,
                displayName: [name, state, country].filter(Boolean).join(' · ')
            };
            AppState.setLocation(location);
            UI.renderFavoriteLocations(location);
            MapService.setView(lat, lon, 10);
            MapService.updateMarker(lat, lon, location.displayName);
            // Keep the selected coordinates in local storage without leaving tracking parameters in the URL.
            window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
            return;
        }
        // Ask for GPS only when the visitor did not choose a city from global search.
        await this.updateFromGPS(false);
    },

    async updateFromGPS(refreshWeather = true) {
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
            console.warn('[App] GPS unavailable; using saved/default location:', err);
            const cachedLocation = this._getCachedLocation();
            if (cachedLocation) {
                // استخدم آخر إحداثيات محفوظة حتى لو تجاوزت مدة تحديث الطقس.
                AppState.currentLocation = cachedLocation;
                MapService.setView(cachedLocation.lat, cachedLocation.lon, 10);
                MapService.updateMarker(
                    cachedLocation.lat,
                    cachedLocation.lon,
                    cachedLocation.displayName || cachedLocation.name
                );
                Notify.warning('تعذر تحديد موقعك عبر GPS؛ نعرض الطقس لآخر موقع محفوظ.');
            } else {
                AppState.currentLocation = { ...CONFIG.DEFAULT_LOCATION };
                MapService.setView(CONFIG.DEFAULT_LOCATION.lat, CONFIG.DEFAULT_LOCATION.lon, 10);
                MapService.updateMarker(
                    CONFIG.DEFAULT_LOCATION.lat,
                    CONFIG.DEFAULT_LOCATION.lon,
                    CONFIG.DEFAULT_LOCATION.displayName
                );
                Notify.warning('لم تتوفر إحداثيات محفوظة؛ تم اختيار الجزائر العاصمة مؤقتاً.');
            }
        } finally {
            UI.setLocLoading(false);
        }
        if (refreshWeather) await this.loadWeather();
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
            SpecializedWeather.load(loc);
            UI.updateStats(current, forecast);
            await UI.updateTips(current, forecast, loc);
            UI.updateWarnings(WeatherService.buildWeatherAlerts(forecast), loc);
            UI.renderFavoriteLocations(loc);
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
        UI.renderFavoriteLocations(loc);
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

        // حفظ الموقع الحالي أو إزالته من المدن المفضلة.
        document.getElementById('favoriteCurrentBtn')?.addEventListener('click', () => {
            const result = FavoriteLocations.toggle(AppState.currentLocation);
            if (result.limitReached) Notify.warning(`يمكن حفظ ${FavoriteLocations.MAX_ITEMS} مدينة كحد أقصى.`);
            else {
                UI.renderFavoriteLocations(AppState.currentLocation);
                Notify.success(result.saved ? 'أضيفت المدينة إلى المفضلة.' : 'أزيلت المدينة من المفضلة.');
            }
        });

        // التنقل بين المدن المحفوظة وحذفها دون إعادة البحث.
        document.getElementById('favoriteCities')?.addEventListener('click', event => {
            const selectButton = event.target.closest('[data-favorite-select]');
            const removeButton = event.target.closest('[data-favorite-remove]');
            if (selectButton) {
                const location = FavoriteLocations.get()[Number(selectButton.dataset.favoriteSelect)];
                if (location) this.setLocation(location);
            } else if (removeButton) {
                const location = FavoriteLocations.get()[Number(removeButton.dataset.favoriteRemove)];
                if (location) {
                    FavoriteLocations.remove(location);
                    UI.renderFavoriteLocations(AppState.currentLocation);
                    Notify.success('تم حذف المدينة من المفضلة.');
                }
            }
        });

        // قائمة الجوال
        const menuButton = document.getElementById('mobileMenuBtn');
        const mainNav = document.getElementById('mainNav');
        menuButton?.addEventListener('click', () => {
            const expanded = mainNav?.classList.toggle('active') || false;
            menuButton.setAttribute('aria-expanded', String(expanded));
            menuButton.setAttribute('aria-label', expanded ? 'إغلاق قائمة التنقل' : 'فتح قائمة التنقل');
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
                        menuButton?.setAttribute('aria-expanded', 'false');
                        menuButton?.setAttribute('aria-label', 'فتح قائمة التنقل');
                    }
                }
            });
        });

        // زر العودة للأعلى
        document.getElementById('scrollTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

        // إبقاء الهيدر متاحاً أثناء التمرير مع تقليل زخرفته بعد تجاوز أعلى الصفحة.
        window.addEventListener('scroll', () => {
            const cur = window.pageYOffset;
            const header = document.getElementById('siteHeader');
            const topBtn = document.getElementById('scrollTop');
            if (header) {
                header.classList.remove('hidden');
                header.classList.toggle('scrolled', cur > 50);
            }
            if (topBtn) topBtn.classList.toggle('visible', cur > 300);
        }, { passive: true });

        // إغلاق قائمة الهاتف بزر Escape.
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            const nav = document.getElementById('mainNav');
            if (nav?.classList.contains('active')) {
                nav.classList.remove('active');
                menuButton?.setAttribute('aria-expanded', 'false');
                menuButton?.setAttribute('aria-label', 'فتح قائمة التنقل');
                menuButton?.focus();
            }
        });
    }
};

// ============================================
// 13. BOOT
// ============================================
document.addEventListener('DOMContentLoaded', () => App.init());
