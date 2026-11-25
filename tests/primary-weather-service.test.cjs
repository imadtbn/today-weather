const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/weather-service.js"), "utf8");
function fixture() {
  const times = Array.from({ length: 48 }, (_, i) => "2026-11-25T" + String(i % 24).padStart(2, "0") + ":00");
  return {
    utc_offset_seconds: 3600,
    current: { time: "2026-11-25T12:00", temperature_2m: 21, relative_humidity_2m: 55, apparent_temperature: 22, weather_code: 2, cloud_cover: 40, surface_pressure: 1012, wind_speed_10m: 18, wind_direction_10m: 270, visibility: 24000, uv_index: 3 },
    hourly: { time: times, temperature_2m: times.map((_, i) => 18 + i % 8), relative_humidity_2m: times.map(() => 60), apparent_temperature: times.map(() => 19), precipitation_probability: times.map(() => 20), precipitation: times.map(() => 0.2), weather_code: times.map(() => 2), wind_speed_10m: times.map(() => 12), wind_direction_10m: times.map(() => 180) },
    daily: { time: ["2026-11-25", "2026-11-26"], temperature_2m_max: [25, 24], temperature_2m_min: [14, 13], sunrise: ["2026-11-25T07:00", "2026-11-26T07:00"], sunset: ["2026-11-25T17:30", "2026-11-26T17:30"] }
  };
}
function create(fetcher) {
  const sandbox = {
    module: { exports: {} },
    CONFIG: { API_BASE_URL: "https://unused.invalid", OPENWEATHER_API_KEY: "unused" },
    fetchWithTimeout: fetcher,
    URLSearchParams, Date, Map, Math, Number, JSON, Promise, String, Error, Object, Array,
    console
  };
  vm.runInNewContext(source, sandbox, { filename: "weather-service.js" });
  return sandbox.module.exports || sandbox.WeatherService;
}

test("loads current and forecast from one Open-Meteo request and maps existing renderer fields", async () => {
  let calls = 0, requested = "";
  const api = create(async url => {
    calls++; requested = url;
    return { ok: true, json: async () => fixture() };
  });
  const [current, forecast] = await Promise.all([
    api.fetchCurrent(36.75, 3.05),
    api.fetchForecast(36.75, 3.05)
  ]);
  assert.equal(calls, 1);
  assert.match(requested, /^https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  assert.equal(current.main.temp, 21);
  assert.equal(current.main.humidity, 55);
  assert.equal(current.weather[0].id, 802);
  assert.equal(current.wind.speed, 5);
  assert.ok(forecast.list.length > 0);
  assert.equal(forecast.list[0].main.humidity, 60);
  assert.equal(forecast.city.timezone, 3600);
});

test("reuses cached weather and deduplicates later parallel calls", async () => {
  let calls = 0;
  const api = create(async () => {
    calls++;
    return { ok: true, json: async () => fixture() };
  });
  await Promise.all([api.fetchCurrent(36.75, 3.05), api.fetchForecast(36.75, 3.05)]);
  await api.fetchCurrent(36.75, 3.05);
  assert.equal(calls, 1);
});

test("rejects invalid coordinates before requesting the API", async () => {
  let calls = 0;
  const api = create(async () => { calls++; throw new Error("unexpected"); });
  await assert.rejects(api.fetchCurrent(120, 0), /إحداثيات الموقع غير صالحة/);
  assert.equal(calls, 0);
});

test("reports upstream HTTP status instead of hiding it behind a generic error", async () => {
  const api = create(async () => ({ ok: false, status: 429, json: async () => ({ reason: "rate limit" }) }));
  await assert.rejects(api.fetchCurrent(36.75, 3.05), /Open-Meteo HTTP 429/);
});
