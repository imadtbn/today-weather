// 6. WEATHER SERVICE
// ============================================
const WeatherService = {
    async fetchCurrent(lat, lon) {
        const url = `${CONFIG.API_BASE_URL}/weather?lat=${lat}&lon=${lon}&units=metric&appid=${CONFIG.OPENWEATHER_API_KEY}&lang=ar`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error('فشل جلب بيانات الطقس الحالية');
        const data = await res.json();
        if (!data?.main || !Array.isArray(data.weather) || !data.weather.length) {
            throw new Error('استجابة الطقس الحالية غير مكتملة');
        }
        return data;
    },

    async fetchForecast(lat, lon) {
        const url = `${CONFIG.API_BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${CONFIG.OPENWEATHER_API_KEY}&lang=ar`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error('فشل جلب التنبؤات');
        const data = await res.json();
        if (!Array.isArray(data?.list) || data.list.length === 0) {
            throw new Error('بيانات التنبؤ غير متاحة أو غير مكتملة');
        }
        return data;
    },

    buildWeatherAlerts(forecast) {
        const now = Date.now() / 1000;
        const upcoming = (forecast?.list || []).filter(item =>
            Number(item.dt) >= now && Number(item.dt) <= now + 24 * 60 * 60
        );
        if (!upcoming.length) return [];
        const alerts = [];
        const peak = (items, selector) => items.reduce((best, item) =>
            !best || selector(item) > selector(best) ? item : best, null
        );
        const add = (type, title, icon, severity, text, item, value) => {
            if (!item) return;
            alerts.push({ type, title, icon, severity, text, value, time: Number(item.dt), source: 'OpenWeatherMap' });
        };

        const rainPeak = peak(upcoming, item => Number(item.rain?.['3h'] || 0));
        const rainMm = Number(rainPeak?.rain?.['3h'] || 0);
        if (rainMm >= 10) add('rain', 'أمطار غزيرة متوقعة', 'fas fa-cloud-showers-heavy',
            rainMm >= 20 ? 'high' : 'medium',
            rainMm >= 20 ? 'توقعات بهطول كثيف خلال فترة ثلاث ساعات؛ تجنب الأودية والطرق المنخفضة وتابع المستجدات.' : 'احتمال أمطار ملحوظة خلال فترة ثلاث ساعات؛ توخّ الحذر أثناء القيادة.',
            rainPeak, `${rainMm.toFixed(1)} مم / 3 ساعات`);

        const windPeak = peak(upcoming, item => Number(item.wind?.speed || 0));
        const windKmh = Number(windPeak?.wind?.speed || 0) * 3.6;
        if (windKmh >= 55) add('wind', 'رياح قوية متوقعة', 'fas fa-wind',
            windKmh >= 75 ? 'high' : 'medium',
            'ثبت الأغراض القابلة للتطاير وابتعد عن اللوحات والأشجار والأجسام غير المستقرة.',
            windPeak, `${Math.round(windKmh)} كم/س`);

        const heatPeak = peak(upcoming, item => Number(item.main?.temp_max ?? item.main?.temp ?? -100));
        const maxTemp = Number(heatPeak?.main?.temp_max ?? heatPeak?.main?.temp);
        if (maxTemp >= 37) add('heat', 'ارتفاع شديد في الحرارة', 'fas fa-temperature-high',
            maxTemp >= 42 ? 'high' : 'medium',
            'قلل التعرض المباشر للشمس واشرب الماء بانتظام، خاصة خلال ساعات الظهيرة.',
            heatPeak, `${Math.round(maxTemp)}°C`);

        const snowItem = upcoming.find(item => (item.weather || []).some(condition => Number(condition.id) >= 600 && Number(condition.id) < 700));
        if (snowItem) add('snow', 'تساقط ثلوج متوقع', 'fas fa-snowflake', 'medium',
            'قد تؤثر الثلوج في حركة المرور؛ تحقق من حالة الطرق قبل التنقل.',
            snowItem, snowItem.weather?.[0]?.description || 'ثلوج متوقعة');

        const stormItem = upcoming.find(item => (item.weather || []).some(condition => Number(condition.id) >= 200 && Number(condition.id) < 300));
        if (stormItem) add('storm', 'عواصف رعدية متوقعة', 'fas fa-bolt', 'high',
            'تجنب الأماكن المكشوفة والاحتماء تحت الأشجار أثناء البرق والرعد.',
            stormItem, stormItem.weather?.[0]?.description || 'عواصف رعدية');

        return alerts.sort((a, b) =>
            (a.severity === 'high' ? 0 : 1) - (b.severity === 'high' ? 0 : 1) || a.time - b.time
        );
    },

    async fetchAtPoint(lat, lon) {
        const url = `${CONFIG.API_BASE_URL}/weather?lat=${lat}&lon=${lon}&units=metric&appid=${CONFIG.OPENWEATHER_API_KEY}&lang=ar`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error('فشل جلب بيانات النقطة');
        const data = await res.json();
        if (!data?.main || !Array.isArray(data.weather) || !data.weather.length) {
            throw new Error('بيانات الطقس للنقطة غير مكتملة');
        }
        return data;
    },

    getIcon(id, isDay = true) {
        const map = {
            thunder: { icon: 'fas fa-bolt', color: '#8e44ad' },
            drizzle: { icon: 'fas fa-cloud-rain', color: '#3498db' },
            rain: { icon: 'fas fa-cloud-showers-heavy', color: '#2980b9' },
            snow: { icon: 'fas fa-snowflake', color: '#60a5fa' },
            fog: { icon: 'fas fa-smog', color: '#94a3b8' },
            clear: { icon: isDay ? 'fas fa-sun' : 'fas fa-moon', color: isDay ? '#f1c40f' : '#64748b' },
            clouds: { icon: 'fas fa-cloud', color: '#94a3b8' }
        };
        if (id >= 200 && id < 300) return map.thunder;
        if (id >= 300 && id < 500) return map.drizzle;
        if (id >= 500 && id < 600) return map.rain;
        if (id >= 600 && id < 700) return map.snow;
        if (id >= 700 && id < 800) return map.fog;
        if (id === 800) return map.clear;
        if (id > 800) return map.clouds;
        return map.clear;
    },

    windDir(deg) {
        const dirs = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
        return dirs[Math.round((deg % 360) / 45) % 8];
    },

    formatTime(d) { return d.toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' }); }
};

// ============================================


// ============================================
// 13. LIVE WEATHER CUBE (Open-Meteo)
// ============================================
const CubeWeather = {
    CACHE_KEY: 'today_weather_cube_v1',
    CACHE_TTL: 10 * 60 * 1000,
    REFRESH_INTERVAL: 25 * 60 * 1000,
    ROTATE_INTERVAL: 7000,
    timer: null,
    rotateTimer: null,
    cities: [
        { name: 'الجزائر العاصمة', country: 'الجزائر', lat: 36.7538, lon: 3.0588 },
        { name: 'وهران', country: 'الجزائر', lat: 35.6971, lon: -0.6308 },
        { name: 'قسنطينة', country: 'الجزائر', lat: 36.3650, lon: 6.6147 },
        { name: 'عنابة', country: 'الجزائر', lat: 36.9000, lon: 7.7667 },
        { name: 'تمنراست', country: 'الجزائر', lat: 22.7850, lon: 5.5228 },
        { name: 'أدرار', country: 'الجزائر', lat: 27.8743, lon: -0.2939 },
        { name: 'باريس', country: 'فرنسا', lat: 48.8566, lon: 2.3522 },
        { name: 'لندن', country: 'المملكة المتحدة', lat: 51.5072, lon: -0.1276 },
        { name: 'القاهرة', country: 'مصر', lat: 30.0444, lon: 31.2357 },
        { name: 'الرياض', country: 'السعودية', lat: 24.7136, lon: 46.6753 },
        { name: 'تونس', country: 'تونس', lat: 36.8065, lon: 10.1815 },
        { name: 'طوكيو', country: 'اليابان', lat: 35.6762, lon: 139.6503 }
    ],
    faces: ['cubeTemp1', 'cubeTemp2', 'cubeTemp3', 'cubeTemp4', 'cubeTemp5', 'cubeTemp6'],
    offset: 0,
    data: [],

    weather(code, isDay) {
        if (code === 0) return { icon: isDay ? 'fa-sun' : 'fa-moon', text: 'سماء صافية', color: '#f1c40f' };
        if ([1, 2].includes(code)) return { icon: isDay ? 'fa-cloud-sun' : 'fa-cloud-moon', text: 'غائم جزئياً', color: '#d5c18b' };
        if (code === 3) return { icon: 'fa-cloud', text: 'غائم', color: '#aab7c4' };
        if ([45, 48].includes(code)) return { icon: 'fa-smog', text: 'ضباب', color: '#94a3b8' };
        if ([51, 53, 55, 56, 57].includes(code)) return { icon: 'fa-cloud-rain', text: 'رذاذ', color: '#60a5fa' };
        if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: 'fa-cloud-showers-heavy', text: 'أمطار', color: '#3498db' };
        if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: 'fa-snowflake', text: 'ثلوج', color: '#bfdbfe' };
        if ([95, 96, 99].includes(code)) return { icon: 'fa-bolt', text: 'عواصف رعدية', color: '#c084fc' };
        return { icon: 'fa-cloud-sun', text: 'حالة جوية متغيرة', color: '#d5c18b' };
    },

    async fetchAll() {
        const latitudes = this.cities.map(city => city.lat).join(',');
        const longitudes = this.cities.map(city => city.lon).join(',');
        const url = 'https://api.open-meteo.com/v1/forecast?latitude=' +
            encodeURIComponent(latitudes) + '&longitude=' + encodeURIComponent(longitudes) +
            '&current=temperature_2m,weather_code,is_day&timezone=auto';
        const response = await fetchWithTimeout(url, {}, 18000);
        if (!response.ok) throw new Error('تعذر الاتصال بمصدر بيانات المدن');
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : [payload];
        if (rows.length !== this.cities.length) throw new Error('بيانات بعض المدن غير مكتملة');
        return rows.map((row, index) => {
            const current = row?.current;
            const temp = Number(current?.temperature_2m);
            const code = Number(current?.weather_code);
            if (!Number.isFinite(temp) || !Number.isFinite(code)) throw new Error('بيانات طقس غير صالحة');
            return {
                ...this.cities[index],
                temp: Math.round(temp),
                code,
                isDay: Number(current.is_day) === 1,
                updatedAt: current.time || null
            };
        });
    },

    readCache() {
        try {
            const cached = JSON.parse(localStorage.getItem(this.CACHE_KEY) || 'null');
            if (cached && Date.now() - cached.savedAt < this.CACHE_TTL &&
                Array.isArray(cached.data) && cached.data.length === this.cities.length) return cached.data;
        } catch (error) { console.warn('[WeatherCube] Cache read failed:', error); }
        return null;
    },

    render() {
        if (!this.data.length) return;
        this.faces.forEach((id, faceIndex) => {
            const city = this.data[(this.offset + faceIndex) % this.data.length];
            const temp = document.getElementById(id);
            const face = temp?.closest('.cube-face');
            if (!temp || !face) return;
            temp.textContent = city.temp + '°';
            const label = face.querySelector('.cube-label');
            if (label) label.textContent = city.name;
            const icon = face.querySelector('i');
            const condition = this.weather(city.code, city.isDay);
            if (icon) {
                icon.className = 'fas ' + condition.icon;
                icon.style.color = condition.color;
                icon.setAttribute('aria-label', condition.text);
                icon.title = condition.text;
            }
            face.setAttribute('aria-label', city.name + '، ' + city.temp + ' درجة، ' + condition.text);
        });
        const status = document.getElementById('cubeWeatherStatus');
        if (status) {
            const updated = new Date();
            status.textContent = 'بيانات مباشرة لـ ' + this.data.length +
                ' مدينة · آخر تحديث ' + updated.toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' });
        }
    },

    async refresh() {
        const status = document.getElementById('cubeWeatherStatus');
        try {
            const fresh = await this.fetchAll();
            this.data = fresh;
            try { localStorage.setItem(this.CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: fresh })); }
            catch (error) { console.warn('[WeatherCube] Cache save failed:', error); }
            this.render();
        } catch (error) {
            console.warn('[WeatherCube] Live update failed:', error);
            if (!this.data.length) this.data = this.readCache() || [];
            if (this.data.length) {
                this.render();
                if (status) status.textContent = 'تعذر التحديث الآن · نعرض آخر بيانات محفوظة';
            } else if (status) {
                status.textContent = 'بيانات المدن غير متاحة حالياً';
            }
        }
    },

    init() {
        const cube = document.getElementById('weatherCube');
        if (!cube) return;
        this.data = this.readCache() || [];
        if (this.data.length) this.render();
        this.refresh();
        if (this.rotateTimer) clearInterval(this.rotateTimer);
        if (this.timer) clearInterval(this.timer);
        this.rotateTimer = setInterval(() => {
            if (this.data.length > this.faces.length) {
                this.offset = (this.offset + this.faces.length) % this.data.length;
                this.render();
            }
        }, this.ROTATE_INTERVAL);
        this.timer = setInterval(() => this.refresh(), this.REFRESH_INTERVAL);
    }
};
