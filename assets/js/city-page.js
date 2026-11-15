(() => {
  const root = document.querySelector("[data-city-weather]");
  if (!root) return;
  const city = JSON.parse(root.dataset.cityWeather);
  const key = "1151122405b6f7be33bf0de4b22bb5a4";
  const base = "https://api.openweathermap.org/data/2.5";
  const $ = id => document.getElementById(id);
  const number = value => Number.isFinite(Number(value)) ? Math.round(Number(value)) : "--";
  const icon = code => code >= 200 && code < 300 ? "fa-cloud-bolt" : code >= 300 && code < 600 ? "fa-cloud-rain" : code >= 600 && code < 700 ? "fa-snowflake" : code >= 700 && code < 800 ? "fa-smog" : code === 800 ? "fa-sun" : "fa-cloud";
  const setStatus = message => { const node=$("cityStatus"); if(node) node.textContent=message; };
  async function load() {
    try {
      const query = `lat=${encodeURIComponent(city.lat)}&lon=${encodeURIComponent(city.lon)}&units=metric&lang=ar&appid=${key}`;
      const [currentResponse, forecastResponse] = await Promise.all([
        fetch(`${base}/weather?${query}`, {cache:"no-store"}),
        fetch(`${base}/forecast?${query}`, {cache:"no-store"})
      ]);
      if (!currentResponse.ok || !forecastResponse.ok) throw new Error("تعذر الوصول إلى خدمة الطقس");
      const [current, forecast] = await Promise.all([currentResponse.json(),forecastResponse.json()]);
      if (!current.main || !Array.isArray(current.weather) || !forecast.list?.length) throw new Error("بيانات الطقس غير مكتملة");
      $("cityTemp").textContent = number(current.main.temp) + "°";
      $("cityCondition").textContent = current.weather[0].description || "حالة الطقس الحالية";
      $("cityWeatherIcon").className = "fa-solid " + icon(Number(current.weather[0].id));
      $("cityFeels").textContent = number(current.main.feels_like) + "°C";
      $("cityHumidity").textContent = number(current.main.humidity) + "%";
      $("cityWind").textContent = number(Number(current.wind?.speed || 0) * 3.6) + " كم/س";
      $("cityPressure").textContent = number(current.main.pressure) + " hPa";
      const dayGroups = new Map();
      for (const item of forecast.list) {
        const date = item.dt_txt?.slice(0,10);
        if (!date) continue;
        if (!dayGroups.has(date)) dayGroups.set(date, []);
        dayGroups.get(date).push(item);
      }
      const entries = [...dayGroups.entries()].slice(0,5).map(([date, items]) => {
        const representative = items.reduce((best, item) => {
          const hour = Number(item.dt_txt?.slice(11,13) || 0);
          const bestHour = Number(best.dt_txt?.slice(11,13) || 0);
          return Math.abs(hour - 12) < Math.abs(bestHour - 12) ? item : best;
        }, items[0]);
        const max = Math.max(...items.map(item => Number(item.main?.temp_max ?? item.main?.temp ?? -100)));
        const min = Math.min(...items.map(item => Number(item.main?.temp_min ?? item.main?.temp ?? 100)));
        const rainChance = Math.round(Math.max(...items.map(item => Number(item.pop || 0))) * 100);
        return { date, representative, max, min, rainChance };
      });
      $("cityForecast").innerHTML = entries.map(day => {
        const weekday = new Date(day.date + "T12:00:00").toLocaleDateString("ar-DZ",{weekday:"short"});
        const description = day.representative.weather?.[0]?.description || "";
        return `<div class="city-day"><span>${weekday}</span><i class="fa-solid ${icon(Number(day.representative.weather?.[0]?.id))}" aria-hidden="true"></i><strong>${number(day.max)}° / ${number(day.min)}°</strong><small>${description}</small><small>احتمال المطر ${day.rainChance}%</small></div>`;
      }).join("");
      const updated = new Date((current.dt || Date.now()/1000)*1000).toLocaleString("ar-DZ",{dateStyle:"medium",timeStyle:"short"});
      $("cityUpdated").textContent = "آخر تحديث للبيانات: " + updated;
      setStatus("البيانات الحالية والتوقعات من OpenWeatherMap");
    } catch (error) {
      console.error("[CityWeather]",error);
      setStatus("تعذر تحميل الطقس الآن. أعد المحاولة لاحقاً؛ معلومات المدينة الأساسية ما زالت متاحة.");
      $("cityForecast").innerHTML = '<p class="city-status">التوقعات غير متاحة مؤقتاً.</p>';
    }
  }
  load();
  $("cityRefresh")?.addEventListener("click",load);
})();