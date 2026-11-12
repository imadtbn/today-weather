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
