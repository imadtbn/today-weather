const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require("node:path").join(__dirname, "../assets/js/city-page.js"), "utf8");
const sandbox = {
  window: { GlobalSearch: true },
  document: { querySelector: () => null },
  module: { exports: {} },
  URLSearchParams,
  Date, Map, Math, Number, JSON, Promise, String, Error, Object, Array,
  console
};
vm.runInNewContext(source, sandbox, { filename: "city-page.js" });
const api = sandbox.module.exports;

function fixture() {
  const times = Array.from({length:48},(_,i)=>"2026-11-24T"+String(i%24).padStart(2,"0")+":00");
  return {
    utc_offset_seconds:3600,
    current:{time:"2026-11-24T12:00",temperature_2m:21.4,relative_humidity_2m:55,apparent_temperature:22,weather_code:2,cloud_cover:40,surface_pressure:1012,wind_speed_10m:18,wind_direction_10m:270,visibility:24000,uv_index:3},
    hourly:{time:times,temperature_2m:times.map((_,i)=>18+i%8),relative_humidity_2m:times.map(()=>60),apparent_temperature:times.map(()=>19),precipitation_probability:times.map(()=>20),precipitation:times.map(()=>0.2),weather_code:times.map(()=>2),wind_speed_10m:times.map(()=>12),wind_direction_10m:times.map(()=>180)},
    daily:{time:["2026-11-24","2026-11-25","2026-11-26","2026-11-27","2026-11-28","2026-11-29","2026-11-30"],temperature_2m_max:[25,24,23,22,21,20,19],temperature_2m_min:[14,13,12,11,10,9,8],sunrise:Array(7).fill("2026-11-24T07:00"),sunset:Array(7).fill("2026-11-24T17:30")}
  };
}
function memoryStorage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),values};}

test("normalizes Open-Meteo current and forecast fields to the existing renderer schema",()=>{
  const result=api.normalize(fixture(),36.17,1.35);
  assert.equal(result.current.main.temp,21.4);
  assert.equal(result.current.main.humidity,55);
  assert.equal(result.current.weather[0].id,802);
  assert.equal(result.current.wind.speed,5);
  assert.equal(result.forecast.city.timezone,3600);
  assert.ok(result.forecast.list.length>=8);
  assert.equal(result.forecast.list[0].main.humidity,60);
  assert.equal(result.uvIndex,3);
});

test("uses one request for current weather and forecasts",async()=>{
  let calls=0;
  const client=api.createClient({storage:memoryStorage(),now:()=>1000,fetch:async()=>{calls++;return {ok:true,json:async()=>fixture()};}});
  const result=await client.get(36.17,1.35);
  assert.equal(calls,1);
  assert.equal(result.cacheStatus,"live");
});

test("deduplicates concurrent requests for the same coordinates",async()=>{
  let calls=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const client=api.createClient({storage:memoryStorage(),fetch:async()=>{calls++;await gate;return {ok:true,json:async()=>fixture()};}});
  const first=client.get(36.17,1.35),second=client.get(36.17,1.35);
  release();
  const [a,b]=await Promise.all([first,second]);
  assert.equal(calls,1);
  assert.equal(a.current.main.temp,b.current.main.temp);
});

test("serves fresh cached data without a network request",async()=>{
  const storage=memoryStorage();let now=1000,calls=0;
  const client=api.createClient({storage,now:()=>now,fetch:async()=>{calls++;return {ok:true,json:async()=>fixture()};}});
  await client.get(36.17,1.35);now+=60_000;
  const cached=await client.get(36.17,1.35);
  assert.equal(calls,1);
  assert.equal(cached.cacheStatus,"fresh");
});

test("falls back to stale cached data when the API is unavailable",async()=>{
  const storage=memoryStorage();let now=1000,fail=false;
  const client=api.createClient({storage,now:()=>now,ttlMs:100,fetch:async()=>{if(fail)throw new Error("offline");return {ok:true,json:async()=>fixture()};}});
  await client.get(36.17,1.35);now+=500;fail=true;
  const stale=await client.get(36.17,1.35);
  assert.equal(stale.cacheStatus,"stale");
  assert.equal(stale.current.main.temp,21.4);
});

test("rejects invalid coordinates before making a request",async()=>{
  let calls=0;
  const client=api.createClient({fetch:async()=>{calls++;}});
  await assert.rejects(client.get(95,1),/Invalid city coordinates/);
  assert.equal(calls,0);
});
