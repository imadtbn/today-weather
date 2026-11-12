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

    async fetchExtraMetrics(lat, lon) {
        // Open-Meteo supplies dew point and UV index without exposing another API key.
        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            current: 'dew_point_2m,uv_index',
            timezone: 'auto'
        });
        try {
            const res = await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
            if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
            const data = await res.json();
            return data?.current || null;
        } catch (error) {
            console.warn('[Weather] Additional metrics unavailable:', error);
            return null;
        }
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
