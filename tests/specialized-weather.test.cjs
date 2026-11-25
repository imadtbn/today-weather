const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../assets/js/specialized-weather.js"), "utf8");
function loadModule(fetcher) {
  const sandbox = {
    module: { exports: {} },
    window: {},
    document: { getElementById: () => null, querySelectorAll: () => [] },
    fetch: fetcher,
    AbortController,
    URLSearchParams,
    Date, Map, Math, Number, JSON, Promise, String, Error, Object, Array,
    setTimeout, clearTimeout, console
  };
  vm.runInNewContext(source, sandbox, { filename: "specialized-weather.js" });
  return sandbox.module.exports;
}

test("shares an in-flight request and caches the response", async () => {
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const api = loadModule(async () => {
    calls++;
    await gate;
    return { ok: true, json: async () => ({ hourly: { time: ["2026-11-25T10:00"], value: [12] } }) };
  });
  const first = api.request("https://example.test/data");
  const second = api.request("https://example.test/data");
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  await api.request("https://example.test/data");
  assert.equal(calls, 1);
});

test("loads all four specialist data sources for valid coordinates", async () => {
  const urls = [];
  const api = loadModule(async url => {
    urls.push(url);
    return { ok: true, json: async () => ({ hourly: { time: ["2099-01-01T00:00"], et0_fao_evapotranspiration: [1], soil_moisture_0_to_7cm: [.2], precipitation: [0], wave_height: [.4], wave_direction: [180], wave_period: [5], european_aqi: [12], pm2_5: [4], pm10: [8] }, daily: { precipitation_sum: [1], precipitation_probability_max: [10], precipitation_hours: [2] } }) };
  });
  await api.load({ lat: 36.75, lon: 3.05, displayName: "الجزائر" });
  assert.equal(urls.length, 4);
  assert.ok(urls.some(url => url.includes("soil_moisture_7_to_28cm")));
  assert.ok(urls.some(url => url.includes("wave_height") && url.includes("swell_wave_height")));
  assert.ok(urls.some(url => url.includes("european_aqi") && url.includes("nitrogen_dioxide")));
  assert.ok(urls.some(url => url.includes("precipitation_probability_max") && url.includes("precipitation_hours")));
  assert.ok(urls.every(url => url.includes("latitude=36.75") && url.includes("longitude=3.05")));
});

test("rejects invalid coordinates without network calls", async () => {
  let calls = 0;
  const api = loadModule(async () => { calls++; throw new Error("must not run"); });
  await api.load({ lat: 120, lon: 0 });
  assert.equal(calls, 0);
});

test("handles failed source requests without rejecting the whole load", async () => {
  const api = loadModule(async () => ({ ok: false, status: 503 }));
  await assert.doesNotReject(api.load({ lat: 36.75, lon: 3.05 }));
});
