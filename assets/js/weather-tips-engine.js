/* Dynamic weather tips engine — rule-based, forecast-aware and offline-friendly. */
const WeatherTipsEngine = (() => {
    const DATA_URL = './data/weather-tips.json';
    let rules = [];
    let loadPromise = null;

    async function load() {
        if (rules.length) return rules;
        if (!loadPromise) {
            loadPromise = fetch(DATA_URL, { cache: 'force-cache' })
                .then(response => {
                    if (!response.ok) throw new Error('تعذر تحميل قاعدة النصائح');
                    return response.json();
                })
                .then(data => {
                    rules = Array.isArray(data.rules) ? data.rules.filter(rule => rule && rule.id && rule.conditions) : [];
                    if (!rules.length) throw new Error('قاعدة النصائح فارغة');
                    return rules;
                })
                .catch(error => {
                    loadPromise = null;
                    console.warn('[WeatherTips] Rules unavailable:', error);
                    return [];
                });
        }
        return loadPromise;
    }

    function buildContext(current, forecast) {
        const now = Math.floor(Date.now() / 1000);
        const upcoming = (forecast?.list || []).filter(item =>
            Number(item.dt) >= now && Number(item.dt) <= now + 24 * 60 * 60
        );
        const timezone = Number(forecast?.city?.timezone || current?.timezone || 0);
        const localHour = new Date((now + timezone) * 1000).getUTCHours();
        const ids = upcoming.flatMap(item => (item.weather || []).map(condition => Number(condition.id)));
        const maxTemp = upcoming.reduce((max, item) =>
            Math.max(max, Number(item.main?.temp_max ?? item.main?.temp ?? -100)), -100);
        const maxRain = upcoming.reduce((max, item) =>
            Math.max(max, Number(item.rain?.['3h'] || 0)), 0);
        const maxWind = upcoming.reduce((max, item) =>
            Math.max(max, Number(item.wind?.speed || 0) * 3.6), 0);
        const currentId = Number(current?.weather?.[0]?.id || 0);
        return {
            currentTemp: Number(current?.main?.feels_like ?? current?.main?.temp),
            currentHumidity: Number(current?.main?.humidity),
            currentVisibility: Number(current?.visibility),
            currentClear: currentId === 800 || currentId === 801,
            forecastMaxTemp: maxTemp,
            forecastRain3h: maxRain,
            forecastWindKmh: maxWind,
            forecastThunder: ids.some(id => id >= 200 && id < 300),
            forecastSnow: ids.some(id => id >= 600 && id < 700),
            forecastFog: ids.some(id => id >= 700 && id < 800),
            daytime: localHour >= 7 && localHour < 19,
            localHour,
            timezone,
            upcoming
        };
    }

    function matches(conditions, context) {
        for (const [key, expected] of Object.entries(conditions || {})) {
            // Threshold suffixes belong to the rule operator, not the context field.
            const operator = key.endsWith('Min') ? 'min' : key.endsWith('Max') ? 'max' : null;
            const contextKey = operator ? key.slice(0, -3) : key;
            const actual = context[contextKey];
            if (typeof expected === 'boolean') {
                if (actual !== expected) return false;
            } else if (operator === 'min') {
                if (!Number.isFinite(actual) || actual < expected) return false;
            } else if (operator === 'max') {
                if (!Number.isFinite(actual) || actual > expected) return false;
            }
        }
        return true;
    }

    async function generate(current, forecast) {
        const availableRules = await load();
        const context = buildContext(current, forecast);
        const matched = availableRules
            .filter(rule => rule.id !== 'moderate-weather' && matches(rule.conditions, context))
            .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
        const categories = new Set();
        const selected = [];
        for (const rule of matched) {
            if (categories.has(rule.category)) continue;
            categories.add(rule.category);
            const isForecast = Object.keys(rule.conditions || {}).some(key => key.startsWith('forecast'));
            selected.push({
                ...rule,
                timing: isForecast ? 'خلال الساعات القادمة' : 'حسب الحالة الحالية',
                source: isForecast ? 'التوقعات خلال 24 ساعة' : 'الطقس الحالي'
            });
            if (selected.length >= 6) break;
        }
        if (!selected.length) {
            const fallback = availableRules.find(rule => rule.id === 'moderate-weather');
            if (fallback) selected.push({ ...fallback, timing: 'حالياً', source: 'الطقس الحالي' });
        }
        return { tips: selected, context };
    }

    return { load, generate };
})();
