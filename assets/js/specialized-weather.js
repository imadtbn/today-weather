// بيانات الأقسام المتخصصة للمدن عبر واجهات Open-Meteo المجانية.
const SpecializedWeather = (() => {
  const CACHE_VERSION = "specialized-weather-v2";
  const CACHE_TTL = 15 * 60 * 1000;
  const TIMEOUT_MS = 12000;
  const pending = new Map();
  const memoryCache = new Map();

  function storage() {
    try { return typeof sessionStorage !== "undefined" ? sessionStorage : null; }
    catch { return null; }
  }
  function cacheKey(url) { return CACHE_VERSION + ":" + url; }
  function readCache(key) {
    const now = Date.now();
    try {
      const value = JSON.parse(storage()?.getItem(key) || "null");
      if (value?.savedAt && now - value.savedAt < CACHE_TTL) return value.data;
    } catch {}
    const memory = memoryCache.get(key);
    return memory && now - memory.savedAt < CACHE_TTL ? memory.data : null;
  }
  function writeCache(key, data) {
    const value = { savedAt: Date.now(), data };
    memoryCache.set(key, value);
    try { storage()?.setItem(key, JSON.stringify(value)); } catch {}
  }
  async function request(url) {
    const key = cacheKey(url), cached = readCache(key);
    if (cached) return cached;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
      try {
        const response = await fetch(url, {
          signal: controller?.signal,
          headers: { Accept: "application/json" }
        });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const data = await response.json();
        writeCache(key, data);
        return data;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    pending.set(key, task);
    try { return await task; }
    finally { pending.delete(key); }
  }
  function value(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
  function unavailable(cardId, message) {
    const card = document.getElementById(cardId);
    if (card) {
      card.classList.add("is-unavailable");
      const advice = card.querySelector(".specialized-advice");
      if (advice) advice.textContent = message;
    }
  }
  function index(times) {
    if (!Array.isArray(times) || !times.length) return 0;
    const current = Date.now();
    const found = times.findIndex(time => Date.parse(time) >= current);
    return found < 0 ? Math.max(0, times.length - 1) : found;
  }
  function total(values, start, count) {
    return (values || []).slice(start, start + count).reduce((sum, item) => sum + (Number(item) || 0), 0);
  }
  function number(value, digits = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(digits) : "غير متاح";
  }
  function extra(cardId, key, label, content) {
    const card = document.getElementById(cardId);
    const grid = card?.querySelector(".city-extra-values");
    if (!grid) return;
    let item = grid.querySelector('[data-specialized-extra="' + key + '"]');
    if (!item) {
      item = document.createElement("div");
      item.dataset.specializedExtra = key;
      const name = document.createElement("span");
      name.textContent = label;
      const output = document.createElement("b");
      item.append(name, output);
      grid.appendChild(item);
    }
    item.querySelector("b").textContent = content;
  }
  function baseQuery(lat, lon) {
    return "latitude=" + encodeURIComponent(lat) + "&longitude=" + encodeURIComponent(lon) + "&timezone=auto";
  }
  async function load(location) {
    const lat = Number(location?.lat), lon = Number(location?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
    value("specializedLocation", location.displayName || location.name || "الموقع المختار");
    document.querySelectorAll(".specialized-card").forEach(card => card.classList.remove("is-unavailable"));
    const query = baseQuery(lat, lon);
    await Promise.allSettled([agriculture(query), marine(query), air(query), rain(query)]);
  }

  async function agriculture(query) {
    try {
      const data = await request("https://api.open-meteo.com/v1/forecast?" + query +
        "&hourly=et0_fao_evapotranspiration,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,soil_temperature_0cm,precipitation&forecast_days=2");
      const hourly = data.hourly || {}, start = index(hourly.time);
      const et0 = total(hourly.et0_fao_evapotranspiration, start, 24);
      const soil = Number(hourly.soil_moisture_0_to_7cm?.[start]);
      const soilDeep = Number(hourly.soil_moisture_7_to_28cm?.[start]);
      const soilTemp = Number(hourly.soil_temperature_0cm?.[start]);
      const precipitation = total(hourly.precipitation, start, 24);
      value("agriEt0", number(et0));
      value("agriSoil", Number.isFinite(soil) ? number(soil, 3) : "غير متاح");
      value("agriRain", number(precipitation));
      extra("agricultureCard", "soil-deep", "رطوبة التربة (7–28 سم)", Number.isFinite(soilDeep) ? number(soilDeep, 3) : "غير متاح");
      extra("agricultureCard", "soil-temperature", "حرارة سطح التربة", Number.isFinite(soilTemp) ? number(soilTemp) + " °C" : "غير متاح");
      const advice = precipitation >= 5
        ? "الأمطار المتوقعة قد تقلل الحاجة إلى الري؛ راقب رطوبة التربة قبل تشغيل نظام الري."
        : et0 >= 4
          ? "التبخر المرجعي مرتفع نسبياً؛ افحص رطوبة التربة والمحصول قبل تحديد كمية الري."
          : "اضبط الري وفق رطوبة التربة ونوع المحصول ومرحلة النمو.";
      value("agriAdvice", advice);
    } catch (error) {
      unavailable("agricultureCard", "تعذر جلب المؤشرات الزراعية حالياً؛ ستتم إعادة المحاولة عند التحديث.");
      if (error?.name !== "AbortError") console.warn("[Specialized] Agriculture", error);
    }
  }

  async function marine(query) {
    try {
      const data = await request("https://marine-api.open-meteo.com/v1/marine?" + query +
        "&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height,sea_surface_temperature&forecast_days=3");
      const hourly = data.hourly || {}, start = index(hourly.time);
      if (!hourly.time?.length || hourly.wave_height?.[start] == null) throw new Error("Marine data unavailable for coordinates");
      const height = Number(hourly.wave_height[start]);
      const direction = Number(hourly.wave_direction?.[start]);
      const period = Number(hourly.wave_period?.[start]);
      const temperature = Number(hourly.sea_surface_temperature?.[start]);
      value("marineWave", number(height) + " م");
      value("marineDirection", Number.isFinite(direction) ? Math.round(direction) + "°" : "غير متاح");
      value("marinePeriod", Number.isFinite(period) ? number(period) + " ث" : "غير متاح");
      extra("marineCard", "wind-wave", "موج الرياح", Number.isFinite(Number(hourly.wind_wave_height?.[start])) ? number(hourly.wind_wave_height[start]) + " م" : "غير متاح");
      extra("marineCard", "swell-wave", "موج الانتفاخ", Number.isFinite(Number(hourly.swell_wave_height?.[start])) ? number(hourly.swell_wave_height[start]) + " م" : "غير متاح");
      const condition = height < .5 ? "هادئة نسبياً" : height < 1.25 ? "معتدلة" : height < 2.5 ? "مرتفعة" : "عالية جداً";
      value("marineAdvice", "حالة الموج " + condition + "." +
        (Number.isFinite(temperature) ? " حرارة سطح البحر " + number(temperature) + " °C." : "") +
        " تحقق من النشرات البحرية الرسمية قبل الإبحار أو السباحة.");
    } catch (error) {
      unavailable("marineCard", "لا تتوفر بيانات بحرية لهذا الموقع أو أن المدينة بعيدة عن نطاق البحر.");
      if (error?.name !== "AbortError" && !/unavailable for coordinates/.test(error?.message || "")) console.warn("[Specialized] Marine", error);
    }
  }

  async function air(query) {
    try {
      const data = await request("https://air-quality-api.open-meteo.com/v1/air-quality?" + query +
        "&hourly=european_aqi,us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&forecast_days=2");
      const hourly = data.hourly || {}, start = index(hourly.time);
      const eu = Number(hourly.european_aqi?.[start]), us = Number(hourly.us_aqi?.[start]);
      const pm25 = Number(hourly.pm2_5?.[start]), pm10 = Number(hourly.pm10?.[start]);
      const no2 = Number(hourly.nitrogen_dioxide?.[start]), ozone = Number(hourly.ozone?.[start]);
      if (![eu, us, pm25, pm10, no2, ozone].some(Number.isFinite)) throw new Error("No air-quality data");
      value("airAqi", Number.isFinite(eu) ? Math.round(eu) : "غير متاح");
      value("airPm25", Number.isFinite(pm25) ? number(pm25) : "غير متاح");
      value("airPm10", Number.isFinite(pm10) ? number(pm10) : "غير متاح");
      extra("airCard", "us-aqi", "المؤشر الأمريكي", Number.isFinite(us) ? Math.round(us) : "غير متاح");
      extra("airCard", "no2", "ثاني أكسيد النيتروجين", Number.isFinite(no2) ? number(no2) + " µg/m³" : "غير متاح");
      extra("airCard", "ozone", "الأوزون", Number.isFinite(ozone) ? number(ozone) + " µg/m³" : "غير متاح");
      value("airAdvice", !Number.isFinite(eu)
        ? "مؤشر جودة الهواء الأوروبي غير متاح حالياً."
        : eu <= 20 ? "جودة الهواء جيدة وفق المؤشر الأوروبي."
          : eu <= 40 ? "جودة الهواء مقبولة؛ قد يتأثر الأشخاص الأكثر حساسية."
            : eu <= 60 ? "تلوث متوسط؛ يُنصح الأشخاص الحساسون بتقليل المجهود الخارجي."
              : "مؤشر تلوث مرتفع؛ قلل النشاط البدني المطول في الخارج وتابع الإرشادات الصحية.");
    } catch (error) {
      unavailable("airCard", "بيانات جودة الهواء غير متاحة حالياً؛ تحقق من الاتصال وأعد المحاولة.");
      if (error?.name !== "AbortError") console.warn("[Specialized] Air", error);
    }
  }

  async function rain(query) {
    try {
      const data = await request("https://api.open-meteo.com/v1/forecast?" + query +
        "&hourly=precipitation,precipitation_probability,rain,showers&daily=precipitation_sum,precipitation_probability_max,precipitation_hours&forecast_days=7");
      const hourly = data.hourly || {}, daily = data.daily || {}, start = index(hourly.time);
      const next24 = total(hourly.precipitation, start, 24);
      const probability = Math.max(0, ...(hourly.precipitation_probability || []).slice(start, start + 24).map(v => Number(v) || 0));
      const rain7 = total(daily.precipitation_sum, 0, 7);
      const hours7 = total(daily.precipitation_hours, 0, 7);
      const maxDailyProbability = Math.max(0, ...(daily.precipitation_probability_max || []).map(v => Number(v) || 0));
      value("rainNext24", number(next24) + " مم");
      value("rainProbability", Math.round(probability) + "%");
      value("rainNext7", number(rain7) + " مم");
      extra("rainfallCard", "rain-hours", "ساعات الهطول خلال 7 أيام", number(hours7, 0) + " ساعة");
      extra("rainfallCard", "rain-max-probability", "أعلى احتمال يومي", Math.round(maxDailyProbability) + "%");
      value("rainAdvice", next24 >= 20
        ? "أمطار غزيرة محتملة خلال 24 ساعة؛ تجنب مجاري الأودية والمناطق المنخفضة وتابع التحذيرات الرسمية."
        : next24 >= 10 ? "أمطار ملحوظة متوقعة؛ راقب التحديثات وخطط التنقل بحذر."
          : "لا تظهر كمية أمطار كبيرة خلال 24 ساعة وفق البيانات الحالية.");
    } catch (error) {
      unavailable("rainfallCard", "تعذر تحميل توقعات الأمطار حالياً؛ ستتم إعادة المحاولة عند التحديث.");
      if (error?.name !== "AbortError") console.warn("[Specialized] Rainfall", error);
    }
  }

  return { load, request, agriculture, marine, air, rain };
})();
if (typeof window !== "undefined") window.SpecializedWeather = SpecializedWeather;
if (typeof module !== "undefined" && module.exports) module.exports = SpecializedWeather;
