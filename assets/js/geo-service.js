// 4. GEOLOCATION SERVICE
// ============================================
const GeoService = {
    async requestGPS() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('المتصفح لا يدعم تحديد الموقع الجغرافي'));
                return;
            }
            Notify.loading('جارٍ تحديد موقعك...');
            navigator.geolocation.getCurrentPosition(
                pos => resolve(pos),
                err => reject(this._gpsError(err)),
                { enableHighAccuracy: true, timeout: CONFIG.GEO_TIMEOUT, maximumAge: 0 }
            );
        });
    },

    _gpsError(err) {
        const msgs = {
            1: 'تم رفض إذن الوصول إلى الموقع. يرجى السماح بالوصول من إعدادات المتصفح.',
            2: 'معلومات الموقع غير متاحة حالياً.',
            3: 'انتهت مهلة تحديد الموقع.',
            0: 'حدث خطأ غير معروف أثناء تحديد الموقع.'
        };
        return new Error(msgs[err.code] || msgs[0]);
    },

    async reverseGeocode(lat, lon) {
        // المحاولة الأولى: OpenWeatherMap
        try {
            const url = `${CONFIG.GEO_API_URL}/reverse?lat=${lat}&lon=${lon}&limit=1&appid=${CONFIG.OPENWEATHER_API_KEY}`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) throw new Error('OWM failed');
            const data = await res.json();
            if (data?.length > 0) {
                const loc = this._parseOWM(data[0], lat, lon);
                if (loc.name && /[\u0600-\u06FF]/.test(loc.name)) return loc; // إذا كان الاسم عربياً نعتمدها
            }
        } catch (e) { console.warn('[Geo] OWM reverse failed:', e); }

        // المحاولة الثانية: Nominatim (أدق للعربية)
        return this._reverseNominatim(lat, lon);
    },

    async _reverseNominatim(lat, lon) {
        try {
            // هذا الفاصل يخفف تكرار الطلبات داخل جلسة المتصفح فقط؛ لا يفرض حداً مشتركاً بين جميع الزوار.
            if (Date.now() - this.lastNominatimSearchAt < 1100) return this._fallback(lat, lon);
            this.lastNominatimSearchAt = Date.now();
            const url = `${CONFIG.NOMINATIM_URL}/reverse?format=json&lat=${lat}&lon=${lon}&zoom=12&addressdetails=1&accept-language=ar`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) throw new Error('Nominatim failed');
            const data = await res.json();
            return this._parseNominatim(data, lat, lon);
        } catch (e) {
            console.warn('[Geo] Nominatim failed:', e);
            return this._fallback(lat, lon);
        }
    },

    _parseOWM(data, lat, lon) {
        const names = data.local_names || {};
        const name = names.ar || names.fr || data.name || 'موقع غير معروف';
        const state = data.state || '';
        const country = names.ar || data.country || 'الجزائر';
        return {
            lat, lon, name, state, country,
            displayName: this._buildDisplayName(name, state, country)
        };
    },

    _parseNominatim(data, lat, lon) {
        const addr = data.address || {};
        // نستخرج الاسم العربي بدقة: قرية/مدينة/بلدة
        const city = addr.city || addr.town || addr.village || addr.suburb || addr.hamlet || 'موقع غير معروف';
        const state = addr.state || addr.county || addr.district || addr.region || '';
        const country = addr.country || 'الجزائر';
        return {
            lat, lon, name: city, state, country,
            displayName: this._buildDisplayName(city, state, country)
        };
    },

    _buildDisplayName(city, state, country) {
        const parts = [city];
        if (state && state !== city && state !== country) parts.push(state);
        if (country) parts.push(country);
        return parts.join(' / ');
    },

    _fallback(lat, lon) {
        return {
            lat, lon, name: 'الموقع الحالي', state: '', country: 'الجزائر',
            displayName: 'الموقع الحالي / الجزائر'
        };
    },

    async searchCities(query, allowRemote = false) {
        if (!query || query.length < 2) return [];
        const q = query.toLocaleLowerCase('ar');
        const local = ALGERIAN_CITIES.filter(c => c.name.toLocaleLowerCase('ar').includes(q));
        if (local.length > 0) return local.map(c => ({
            ...c, displayName: this._buildDisplayName(c.name, c.state, 'الجزائر')
        }));
        // Nominatim لا يسمح بالبحث التلقائي أثناء الكتابة؛ البحث الخارجي يتم بطلب Enter فقط.
        return allowRemote ? this._searchNominatim(query) : [];
    },

    lastNominatimSearchAt: 0,
    async _searchNominatim(query) {
        try {
            // مهلة محلية لتقليل تكرار طلبات البحث من هذا المتصفح؛ ليست محدداً مركزياً لحركة جميع الزوار.
            if (Date.now() - this.lastNominatimSearchAt < 1100) return [];
            this.lastNominatimSearchAt = Date.now();
            const url = `${CONFIG.NOMINATIM_URL}/search?format=json&addressdetails=1&limit=8&accept-language=ar&q=${encodeURIComponent(query + ', Algeria')}`;
            const res = await fetchWithTimeout(url);
            if (!res.ok) throw new Error('Nominatim search failed');
            const data = await res.json();
            if (!Array.isArray(data)) return [];
            return data.map(p => {
                const lat = Number(p.lat), lon = Number(p.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
                const addr = p.address || {};
                const displayName = typeof p.display_name === 'string' ? p.display_name : '';
                return {
                    lat, lon, name: displayName.split(',')[0] || 'موقع غير معروف',
                    state: addr.state || addr.county || '',
                    country: addr.country || 'الجزائر',
                    displayName
                };
            }).filter(Boolean);
        } catch (e) {
            console.warn('[Geo] Nominatim search failed:', e);
            return [];
        }
    }
};

// ============================================
// 5. ALGERIAN CITIES DB
// ============================================
const ALGERIAN_CITIES = [
    { name: "الجزائر العاصمة", lat: 36.752887, lon: 3.042048, state: "الجزائر العاصمة" },
    { name: "وهران", lat: 35.697654, lon: -0.633737, state: "وهران" },
    { name: "قسنطينة", lat: 36.365, lon: 6.614722, state: "قسنطينة" },
    { name: "عنابة", lat: 36.9, lon: 7.766667, state: "عنابة" },
    { name: "البليدة", lat: 36.483333, lon: 2.833333, state: "البليدة" },
    { name: "سطيف", lat: 36.191944, lon: 5.413611, state: "سطيف" },
    { name: "تيزي وزو", lat: 36.716667, lon: 4.05, state: "تيزي وزو" },
    { name: "باتنة", lat: 35.55, lon: 6.166667, state: "باتنة" },
    { name: "الشلف", lat: 36.166667, lon: 1.333333, state: "الشلف" },
    { name: "تلمسان", lat: 34.882778, lon: -1.316667, state: "تلمسان" },
    { name: "بجاية", lat: 36.75, lon: 5.083333, state: "بجاية" },
    { name: "بشار", lat: 31.616667, lon: -2.216667, state: "بشار" },
    { name: "ورقلة", lat: 31.95, lon: 5.316667, state: "ورقلة" },
    { name: "تمنراست", lat: 22.785, lon: 5.522778, state: "تمنراست" },
    { name: "سعيدة", lat: 34.8303, lon: 0.1517, state: "سعيدة" },
    { name: "سكيكدة", lat: 36.8667, lon: 6.9, state: "سكيكدة" },
    { name: "المدية", lat: 36.2667, lon: 2.75, state: "المدية" },
    { name: "تيارت", lat: 35.3711, lon: 1.316, state: "تيارت" },
    { name: "الجلفة", lat: 34.6728, lon: 3.2636, state: "الجلفة" },
    { name: "قالمة", lat: 36.4621, lon: 7.4251, state: "قالمة" },
    { name: "بومرداس", lat: 36.7667, lon: 3.4778, state: "بومرداس" },
    { name: "دلس", lat: 36.9167, lon: 3.9167, state: "بومرداس" },
    { name: "البويرة", lat: 36.3667, lon: 3.9, state: "البويرة" },
    { name: "تيبازة", lat: 36.6, lon: 2.4333, state: "تيبازة" },
    { name: "عين الدفلى", lat: 36.2667, lon: 1.9667, state: "عين الدفلى" },
    { name: "مستغانم", lat: 35.9333, lon: 0.0833, state: "مستغانم" },
    { name: "غليزان", lat: 35.7333, lon: 0.55, state: "غليزان" },
    { name: "الأغواط", lat: 33.8, lon: 2.8833, state: "الأغواط" },
    { name: "غرداية", lat: 32.4833, lon: 3.6667, state: "غرداية" },
    { name: "تندوف", lat: 27.6667, lon: -8.1667, state: "تندوف" },
    { name: "إليزي", lat: 26.5, lon: 8.4667, state: "إليزي" },
    { name: "أدرار", lat: 27.8667, lon: -0.2833, state: "أدرار" },
    { name: "تيسمسيلت", lat: 35.6, lon: 1.8167, state: "تيسمسيلت" },
    { name: "سيدي بلعباس", lat: 35.2, lon: -0.6333, state: "سيدي بلعباس" },
    { name: "سوق أهراس", lat: 36.2833, lon: 7.95, state: "سوق أهراس" },
    { name: "خنشلة", lat: 35.4167, lon: 7.1333, state: "خنشلة" },
    { name: "ميلة", lat: 36.45, lon: 6.2667, state: "ميلة" },
    { name: "عين تيموشنت", lat: 35.3, lon: -1.1333, state: "عين تيموشنت" },
    { name: "برج بوعريريج", lat: 36.0667, lon: 4.7667, state: "برج بوعريريج" },
    { name: "المسيلة", lat: 35.7167, lon: 4.5333, state: "المسيلة" },
    { name: "الوادي", lat: 33.35, lon: 6.8667, state: "الوادي" },
    { name: "خميس مليانة", lat: 36.2667, lon: 2.6833, state: "عين الدفلى" },
    { name: "القليعة", lat: 36.7667, lon: 2.95, state: "تيبازة" },
    { name: "الرويبة", lat: 36.7333, lon: 3.2833, state: "الجزائر العاصمة" },
    { name: "زرالدة", lat: 36.7167, lon: 2.85, state: "الجزائر العاصمة" },
    { name: "الحراش", lat: 36.7167, lon: 3.1333, state: "الجزائر العاصمة" },
    { name: "باب الزوار", lat: 36.7333, lon: 3.1833, state: "الجزائر العاصمة" },
    { name: "بوزريعة", lat: 36.7833, lon: 3.0167, state: "الجزائر العاصمة" },
    { name: "الدار البيضاء", lat: 36.7333, lon: 3.1167, state: "الجزائر العاصمة" }
];

// ============================================
