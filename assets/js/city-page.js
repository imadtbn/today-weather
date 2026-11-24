
/* City weather data: one Open-Meteo request, bounded cache and single-flight. */
const CityWeatherApi = (() => {
  const CACHE_VERSION = "city-weather-v1";
  const DEFAULT_TTL = 10 * 60 * 1000;
  const descriptions = {
    0:"سماء صافية",1:"غائم جزئياً",2:"غائم جزئياً",3:"غائم",
    45:"ضباب",48:"ضباب متجمد",
    51:"رذاذ خفيف",53:"رذاذ",55:"رذاذ كثيف",56:"رذاذ متجمد",57:"رذاذ متجمد كثيف",
    61:"مطر خفيف",63:"مطر",65:"مطر غزير",66:"مطر متجمد",67:"مطر متجمد غزير",
    71:"ثلوج خفيفة",73:"ثلوج",75:"ثلوج كثيفة",77:"حبيبات ثلجية",
    80:"زخات مطر خفيفة",81:"زخات مطر",82:"زخات مطر غزيرة",
    85:"زخات ثلجية",86:"زخات ثلجية كثيفة",
    95:"عاصفة رعدية",96:"عاصفة رعدية مع برد",99:"عاصفة رعدية قوية مع برد"
  };
  function weatherId(code) {
    if (code === 0) return 800;
    if (code === 1) return 801;
    if (code === 2) return 802;
    if (code === 3) return 804;
    if (code === 45 || code === 48) return 741;
    if (code >= 51 && code <= 57) return 300;
    if (code >= 61 && code <= 67) return code >= 65 ? 502 : 500;
    if (code >= 71 && code <= 77) return code >= 75 ? 602 : 600;
    if (code >= 80 && code <= 82) return code === 82 ? 522 : 520;
    if (code === 85 || code === 86) return 602;
    if (code >= 95) return 200;
    return 800;
  }
  function unixTime(value, offset) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor((parsed - (offset || 0) * 1000) / 1000) : 0;
  }
  function normalize(data, lat, lon) {
    const c = data.current || {}, h = data.hourly || {}, d = data.daily || {};
    if (!Array.isArray(h.time) || !Number.isFinite(Number(c.temperature_2m))) {
      throw new Error("Open-Meteo returned incomplete city weather data");
    }
    const offset = Number(data.utc_offset_seconds) || 0;
    const dayIndex = Array.isArray(d.time) ? Math.max(0, d.time.indexOf(String(c.time || "").slice(0,10))) : 0;
    const code = Number(c.weather_code);
    const current = {
      dt: Math.floor(Date.now()/1000),
      timezone: offset,
      coord: {lat, lon},
      main: {
        temp: Number(c.temperature_2m),
        feels_like: Number(c.apparent_temperature ?? c.temperature_2m),
        humidity: Number(c.relative_humidity_2m),
        pressure: Number(c.surface_pressure ?? c.pressure_msl),
        temp_max: Number(d.temperature_2m_max?.[dayIndex] ?? c.temperature_2m),
        temp_min: Number(d.temperature_2m_min?.[dayIndex] ?? c.temperature_2m)
      },
      weather: [{id:weatherId(code), description:descriptions[code] || "حالة الطقس"}],
      wind: {speed:Number(c.wind_speed_10m || 0)/3.6, deg:Number(c.wind_direction_10m)},
      clouds: {all:Number(c.cloud_cover)},
      visibility: Number(c.visibility),
      sys: {sunrise:unixTime(d.sunrise?.[dayIndex],offset), sunset:unixTime(d.sunset?.[dayIndex],offset)}
    };
    const list = [];
    for (let i=0; i<h.time.length; i+=3) {
      const time = h.time[i], timestamp = unixTime(time,offset);
      if (!timestamp) continue;
      const rain = (h.precipitation || []).slice(i,i+3).reduce((sum,v)=>sum+(Number(v)||0),0);
      const date = String(time).slice(0,10), index = Array.isArray(d.time) ? d.time.indexOf(date) : -1;
      const hourCode = Number(h.weather_code?.[i]);
      list.push({
        dt:timestamp, dt_txt:String(time).replace("T"," ") + ":00",
        main:{
          temp:Number(h.temperature_2m?.[i] ?? c.temperature_2m),
          feels_like:Number(h.apparent_temperature?.[i] ?? c.apparent_temperature ?? c.temperature_2m),
          humidity:Number(h.relative_humidity_2m?.[i] ?? c.relative_humidity_2m),
          temp_max:Number(d.temperature_2m_max?.[index] ?? h.temperature_2m?.[i] ?? c.temperature_2m),
          temp_min:Number(d.temperature_2m_min?.[index] ?? h.temperature_2m?.[i] ?? c.temperature_2m)
        },
        weather:[{id:weatherId(hourCode),description:descriptions[hourCode] || "حالة الطقس"}],
        wind:{speed:Number(h.wind_speed_10m?.[i] || 0)/3.6,deg:Number(h.wind_direction_10m?.[i])},
        rain:{"3h":rain},
        pop:Number(h.precipitation_probability?.[i] || 0)/100
      });
    }
    return {
      current,
      forecast:{city:{timezone:offset},list},
      uvIndex:Number.isFinite(Number(c.uv_index)) ? Number(c.uv_index) : null
    };
  }
  function createClient(options={}) {
    const fetcher=options.fetch || (typeof fetch==="function" ? fetch.bind(globalThis) : null);
    const storage=options.storage === undefined ? (()=>{try{return localStorage;}catch{return null;}})() : options.storage;
    const now=options.now || (()=>Date.now()), ttl=options.ttlMs || DEFAULT_TTL;
    const pending=new Map();
    function cacheKey(lat,lon){return CACHE_VERSION+":"+Number(lat).toFixed(3)+":"+Number(lon).toFixed(3);}
    function read(key){
      try { const value=JSON.parse(storage?.getItem(key)||"null"); return value && value.savedAt && value.data ? value : null; }
      catch { return null; }
    }
    function write(key,data){
      try { storage?.setItem(key,JSON.stringify({savedAt:now(),data})); } catch {}
    }
    async function get(lat,lon) {
      lat=Number(lat); lon=Number(lon);
      if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) throw new Error("Invalid city coordinates");
      const key=cacheKey(lat,lon), cached=read(key);
      if(cached && now()-cached.savedAt < ttl) return {...cached.data,cacheStatus:"fresh",savedAt:cached.savedAt};
      if(pending.has(key)) return pending.get(key);
      if(!fetcher) throw new Error("Fetch is unavailable");
      const request=(async()=>{
        const params=new URLSearchParams({
          latitude:String(lat),longitude:String(lon),
          current:"temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index",
          hourly:"temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
          daily:"weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max",
          timezone:"auto",forecast_days:"7"
        });
        try {
          const response=await fetcher("https://api.open-meteo.com/v1/forecast?"+params.toString(),{headers:{Accept:"application/json"}});
          if(!response.ok) throw new Error("Weather API HTTP "+response.status);
          const data=normalize(await response.json(),lat,lon);
          write(key,data);
          return {...data,cacheStatus:"live",savedAt:now()};
        } catch(error) {
          if(cached) return {...cached.data,cacheStatus:"stale",savedAt:cached.savedAt,error};
          throw error;
        }
      })();
      pending.set(key,request);
      try{return await request;}finally{pending.delete(key);}
    }
    return {get};
  }
  return {createClient,normalize,weatherId,DEFAULT_TTL};
})();
if (typeof window !== "undefined") window.CityWeatherApi = CityWeatherApi;
if (typeof module !== "undefined" && module.exports) module.exports = CityWeatherApi;

/* Load the shared site search on every generated city detail page. */
(function () {
  if (document.querySelector('script[src*="global-search.js"]') || window.GlobalSearch) return;
  var script = document.createElement('script');
  script.src = '/today-weather/assets/js/global-search.js?v=20261115-global-worldwide-4';
  script.async = true;
  document.head.appendChild(script);
})();
(() => {
  const root=document.querySelector("[data-city-weather]"); if(!root)return;
  const city=JSON.parse(root.dataset.cityWeather),key="1151122405b6f7be33bf0de4b22bb5a4";
  const $=id=>document.getElementById(id), key="1151122405b6f7be33bf0de4b22bb5a4", weatherClient=window.CityWeatherApi.createClient();
  const num=v=>Number.isFinite(Number(v))?Math.round(Number(v)):"--";
  const icon=code=>code>=200&&code<300?"fa-cloud-bolt":code>=300&&code<600?"fa-cloud-rain":code>=600&&code<700?"fa-snowflake":code>=700&&code<800?"fa-smog":code===800?"fa-sun":"fa-cloud";
  const direction=deg=>{if(!Number.isFinite(Number(deg)))return"--";const dirs=["شمال","شمال شرقي","شرق","جنوب شرقي","جنوب","جنوب غربي","غرب","شمال غربي"];return dirs[Math.round((Number(deg)%360)/45)%8];};
  const time=(ts,offset=0)=>{if(!ts)return"--";const d=new Date((ts+offset)*1000);return d.toLocaleTimeString("ar-DZ",{hour:"2-digit",minute:"2-digit",timeZone:"UTC"});};
  const status=m=>{if($("cityStatus"))$("cityStatus").textContent=m;};
  let currentData=null,forecastData=null,map=null,marker=null,weatherLayer=null;
  function dewPoint(t,rh){const a=17.625,b=243.04,g=Math.log(Math.max(1,Math.min(100,rh))/100)+a*t/(b+t);return b*g/(a-g);}
  function renderHourly(list){const now=Date.now()/1000,items=list.filter(x=>Number(x.dt)>=now&&Number(x.dt)<=now+86400).slice(0,8);$("hourlyForecast").innerHTML=items.length?items.map(x=>'<article class="hourly-item"><strong>'+time(x.dt,Number(forecastData?.city?.timezone||0))+'</strong><i class="fa-solid '+icon(Number(x.weather?.[0]?.id))+'"></i><b>'+num(x.main?.temp)+'°</b><span>'+String(x.weather?.[0]?.description||"")+'</span><small>رطوبة '+num(x.main?.humidity)+'%</small><small>رياح '+num(Number(x.wind?.speed||0)*3.6)+' كم/س</small></article>').join(""):'<p class="city-status">لا توجد توقعات متاحة خلال الساعات القادمة.</p>'; }
  function renderFiveDays(list){const groups=new Map();for(const x of list){const d=x.dt_txt?.slice(0,10);if(d){if(!groups.has(d))groups.set(d,[]);groups.get(d).push(x);}}const days=[...groups.entries()].slice(0,5).map(([date,items])=>{const mid=items.reduce((a,b)=>Math.abs(Number(b.dt_txt.slice(11,13))-12)<Math.abs(Number(a.dt_txt.slice(11,13))-12)?b:a,items[0]);return{date,mid,max:Math.max(...items.map(x=>Number(x.main?.temp_max??x.main?.temp))),min:Math.min(...items.map(x=>Number(x.main?.temp_min??x.main?.temp))),rain:Math.max(...items.map(x=>Number(x.pop||0)))};});$("cityForecast").innerHTML=days.map(d=>'<article class="city-day"><span>'+new Date(d.date+"T12:00:00").toLocaleDateString("ar-DZ",{weekday:"short"})+'</span><i class="fa-solid '+icon(Number(d.mid.weather?.[0]?.id))+'"></i><strong>'+num(d.max)+'° / '+num(d.min)+'°</strong><small>'+String(d.mid.weather?.[0]?.description||"")+'</small><small>احتمال المطر '+Math.round(d.rain*100)+'%</small></article>').join("");return days;}
  function renderStats(list){const max=Math.max(...list.map(x=>Number(x.main?.temp_max??x.main?.temp))),min=Math.min(...list.map(x=>Number(x.main?.temp_min??x.main?.temp))),avg=list.reduce((s,x)=>s+Number(x.main?.temp||0),0)/list.length,rain=list.reduce((s,x)=>s+Number(x.rain?.["3h"]||0),0),wind=Math.max(...list.map(x=>Number(x.wind?.speed||0)*3.6)),pop=Math.max(...list.map(x=>Number(x.pop||0)));[["statMaxTemp",num(max)+"°"],["statMinTemp",num(min)+"°"],["statAvgTemp",num(avg)+"°"],["statRain",rain.toFixed(1)+" مم"],["statWind",num(wind)+" كم/س"],["statRainChance",num(pop*100)+"%"]].forEach(([id,v])=>{if($(id))$(id).textContent=v;});}
  function renderTips(current,forecast){const upcoming=forecast.list.filter(x=>x.dt>=Date.now()/1000&&x.dt<=Date.now()/1000+86400),tips=[];const max=Math.max(...upcoming.map(x=>Number(x.main?.temp_max??x.main?.temp??-99))),wind=Math.max(...upcoming.map(x=>Number(x.wind?.speed||0)*3.6)),rain=Math.max(...upcoming.map(x=>Number(x.rain?.["3h"]||0))),ids=upcoming.flatMap(x=>(x.weather||[]).map(w=>Number(w.id)));if(Number(current.main.temp)>=35||max>=38)tips.push(["حرارة مرتفعة","اشرب الماء بانتظام وتجنب التعرض المباشر للشمس وقت الظهيرة."]);if(rain>=5)tips.push(["أمطار متوقعة","خطط للتنقل بحذر وتجنب الطرق المنخفضة ومجاري الأودية."]);if(wind>=45)tips.push(["رياح نشطة","ثبت الأغراض الخفيفة وتوخ الحذر أثناء القيادة." ]);if(ids.some(x=>x>=200&&x<300))tips.push(["عواصف رعدية","ابتعد عن الأماكن المكشوفة والأشجار أثناء العواصف."]);if(ids.some(x=>x>=600&&x<700))tips.push(["احتمال تساقط الثلوج","تحقق من حالة الطرق قبل التنقل."]);if(!tips.length)tips.push(["أجواء مستقرة نسبياً","الظروف المتوقعة ملائمة للأنشطة المعتادة مع متابعة التحديثات."]);$("weatherTips").innerHTML=tips.slice(0,5).map(([t,d])=>'<article class="tip-card"><h3>'+t+'</h3><p>'+d+'</p></article>').join("");$("weatherTipsContext").textContent="تحليل آلي للطقس الحالي وتوقعات الـ24 ساعة القادمة."; $("weatherTipsStatus").textContent="تم تحديث النصائح";}
  function renderCurrent(c){$("cityTemp").textContent=num(c.main.temp)+"°";$("cityCondition").textContent=c.weather?.[0]?.description||"حالة الطقس الحالية";$("cityWeatherIcon").className="fa-solid "+icon(Number(c.weather?.[0]?.id))+" city-weather-icon";$("cityFeels").textContent=num(c.main.feels_like)+"°C";$("cityHumidity").textContent=num(c.main.humidity)+"%";$("cityWind").textContent=num(Number(c.wind?.speed||0)*3.6)+" كم/س";$("cityPressure").textContent=num(c.main.pressure)+" hPa";$("cityVisibility").textContent=Number.isFinite(Number(c.visibility))?(Number(c.visibility)/1000).toFixed(1)+" كم":"غير متاح";$("cityDewPoint").textContent=Number.isFinite(Number(c.main.temp))&&Number.isFinite(Number(c.main.humidity))?dewPoint(Number(c.main.temp),Number(c.main.humidity)).toFixed(1)+"°C":"غير متاح";$("cityClouds").textContent=num(c.clouds?.all)+"%";$("cityWindDirection").textContent=direction(c.wind?.deg);$("citySunrise").textContent=time(c.sys?.sunrise,Number(c.timezone||0));$("citySunset").textContent=time(c.sys?.sunset,Number(c.timezone||0));$("cityCountryCode").textContent=city.countryCode||c.sys?.country||"غير متاح";$("cityUpdated").textContent="آخر تحديث: "+new Date((c.dt||Date.now()/1000)*1000).toLocaleString("ar-DZ",{dateStyle:"medium",timeStyle:"short"});}
  function initMap(){const el=$("cityWeatherMap");if(!el||!window.L){$("cityMapStatus").textContent="تعذر تحميل مكتبة الخريطة.";return;}map=L.map(el).setView([city.lat,city.lon],9);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"© OpenStreetMap"}).addTo(map);weatherLayer=L.tileLayer("https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid="+key,{opacity:.55,maxZoom:18,attribution:"© OpenWeatherMap"}).addTo(map);marker=L.marker([city.lat,city.lon]).addTo(map).bindPopup(city.name+" · "+city.country).openPopup();document.querySelectorAll("[data-city-layer]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll("[data-city-layer]").forEach(x=>x.classList.toggle("active",x===b));if(weatherLayer)map.removeLayer(weatherLayer);weatherLayer=L.tileLayer("https://tile.openweathermap.org/map/"+b.dataset.cityLayer+"/{z}/{x}/{y}.png?appid="+key,{opacity:.55,maxZoom:18,attribution:"© OpenWeatherMap"}).addTo(map);}));setTimeout(()=>map.invalidateSize(),250);}
  $("cityGps")?.addEventListener("click",()=>{if(!navigator.geolocation){$("cityMapStatus").textContent="المتصفح لا يدعم GPS.";return;}$("cityMapStatus").textContent="جارٍ تحديد موقعك...";navigator.geolocation.getCurrentPosition(pos=>{const lat=pos.coords.latitude,lon=pos.coords.longitude;map?.setView([lat,lon],11);if(marker)marker.setLatLng([lat,lon]);$("cityMapStatus").textContent="تم تحديد موقعك على الخريطة؛ بيانات صفحة المدينة تبقى مرتبطة بالمدينة المحددة.";},()=>{$("cityMapStatus").textContent="تعذر تحديد الموقع. تحقق من أذونات GPS.";},{enableHighAccuracy:true,timeout:10000,maximumAge:60000});});
  async function load(){try{status("جارٍ تحميل بيانات الطقس...");const result=await weatherClient.get(city.lat,city.lon),c=result.current,f=result.forecast;if(!c.main||!Array.isArray(c.weather)||!Array.isArray(f.list))throw Error("بيانات الطقس غير مكتملة");currentData=c;forecastData=f;renderCurrent(c);renderHourly(f.list);renderFiveDays(f.list);renderStats(f.list);renderTips(c,f);$("cityUv").textContent=result.uvIndex===null?"غير متاح":result.uvIndex.toFixed(1);const source=result.cacheStatus==="live"?"Open-Meteo (مباشر)":result.cacheStatus==="stale"?"Open-Meteo (آخر بيانات محفوظة)":"Open-Meteo (ذاكرة مؤقتة)";$("cityStatus").textContent="مصدر البيانات: "+source+"؛ المؤشرات المتخصصة من Open-Meteo.";if(result.cacheStatus==="stale")$("cityUpdated").textContent+=" · بيانات محفوظة قديمة";initMap();await window.SpecializedWeather?.load({lat:city.lat,lon:city.lon,name:city.name,displayName:city.name+" · "+city.country});}catch(e){console.error("[CityWeather]",e);status("تعذر تحميل بيانات الطقس الآن؛ أعد المحاولة لاحقاً.");$("cityForecast").innerHTML='<p class="city-status">التوقعات غير متاحة مؤقتاً.</p>';}}
  load();$("cityRefresh")?.addEventListener("click",load);
})();