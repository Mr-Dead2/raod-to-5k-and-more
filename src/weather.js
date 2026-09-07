// ---------------------------------------------------------------------------
// Weather for the next run.
//
// Open-Meteo: free, no API key, no account, no backend — which is the only kind
// of service that fits this app. One request returns current conditions plus a
// short hourly forecast; nothing is sent but a rounded latitude and longitude.
//
// The point is not a weather widget. It is the two decisions a runner actually
// makes before going out: what to wear, and whether to move the session. So the
// module's real output is `runAdvice()` — a short, specific line — with the raw
// numbers as supporting detail.
// ---------------------------------------------------------------------------
import { isMiles } from "./units.js";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

// Coordinates are rounded before they leave the device. ~1 km of precision is
// far more than enough for weather and is a good deal less than a running app
// needs to know about where someone lives.
const COORD_DP = 2;

// WMO weather codes → a short label and a glyph. Open-Meteo returns these on
// both current and hourly readings.
const CODES = {
  0: ["Clear", "☀️"],
  1: ["Mostly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Freezing fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "🌨️"],
  80: ["Showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Heavy showers", "⛈️"],
  85: ["Snow showers", "🌨️"], 86: ["Snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"],
};

export const describeCode = (code) => CODES[code] || ["—", "🌡️"];

/** Rain-bearing codes — used to decide whether to mention a window later on. */
const isWet = (code) => code >= 51 && code !== 77;

// --- fetching ---------------------------------------------------------------

/**
 * Current conditions plus the next few hours for a position.
 * Returns null rather than throwing: weather is a nicety and must never be the
 * reason a screen fails to render.
 */
export async function fetchWeather({ lat, lon, signal, fetchImpl = fetch } = {}) {
  if (!isFinite(lat) || !isFinite(lon)) return null;
  const params = new URLSearchParams({
    latitude: Number(lat).toFixed(COORD_DP),
    longitude: Number(lon).toFixed(COORD_DP),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m",
    forecast_days: "2",
    timezone: "auto",
    // Ask in the runner's own units so nothing has to be converted twice.
    temperature_unit: isMiles() ? "fahrenheit" : "celsius",
    wind_speed_unit: isMiles() ? "mph" : "kmh",
    precipitation_unit: isMiles() ? "inch" : "mm",
  });

  let res;
  try {
    res = await fetchImpl(`${ENDPOINT}?${params}`, { signal });
  } catch {
    return null;
  }
  if (!res?.ok) return null;

  let data;
  try { data = await res.json(); } catch { return null; }
  const c = data?.current;
  if (!c) return null;

  const [label, icon] = describeCode(c.weather_code);
  return {
    at: Date.now(),
    tempUnit: isMiles() ? "°F" : "°C",
    windUnit: isMiles() ? "mph" : "km/h",
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    humidity: Math.round(c.relative_humidity_2m),
    wind: Math.round(c.wind_speed_10m),
    gusts: Math.round(c.wind_gusts_10m ?? c.wind_speed_10m),
    precipitation: c.precipitation ?? 0,
    code: c.weather_code,
    isDay: c.is_day !== 0,
    label,
    icon,
    hourly: buildHourly(data.hourly),
  };
}

/** The next 12 hours, trimmed to what the UI can use. */
function buildHourly(h) {
  if (!Array.isArray(h?.time)) return [];
  const now = Date.now();
  const out = [];
  for (let i = 0; i < h.time.length && out.length < 12; i++) {
    const t = new Date(h.time[i]).getTime();
    if (!isFinite(t) || t < now - 3600000) continue;
    out.push({
      t,
      temp: Math.round(h.temperature_2m?.[i]),
      feels: Math.round(h.apparent_temperature?.[i] ?? h.temperature_2m?.[i]),
      rainChance: Math.round(h.precipitation_probability?.[i] ?? 0),
      code: h.weather_code?.[i],
      wind: Math.round(h.wind_speed_10m?.[i] ?? 0),
    });
  }
  return out;
}

// --- advice -----------------------------------------------------------------

/**
 * What to wear, in one clause. Driven by apparent temperature, because that is
 * what a body actually feels — 6°C in a 30 km/h wind is not 6°C.
 *
 * Thresholds are in Celsius; Fahrenheit readings are converted back so the
 * bands stay in one scale rather than being duplicated and drifting apart.
 */
export function dressFor(feels, tempUnit = "°C") {
  if (!isFinite(feels)) return null;
  const c = tempUnit === "°F" ? (feels - 32) * 5 / 9 : feels;
  if (c <= -5) return "Full winter kit: tights, thermal top, gloves and a hat.";
  if (c <= 2) return "Long sleeves, tights, gloves — it'll feel colder for the first kilometre.";
  if (c <= 8) return "Long sleeves and shorts or tights. You'll warm up quickly.";
  if (c <= 14) return "T-shirt and shorts, maybe long sleeves to start.";
  if (c <= 20) return "T-shirt and shorts — close to ideal running weather.";
  if (c <= 26) return "Vest and shorts. Take water and start easy.";
  return "Hot: run early or late, take water, and don't chase pace.";
}

/**
 * A short warning when conditions will genuinely change the session, or null
 * when there is nothing worth saying. Silence is the common case and the UI
 * should stay quiet rather than manufacture advice.
 */
export function runWarning(w) {
  if (!w) return null;
  const c = w.tempUnit === "°F" ? (w.feels - 32) * 5 / 9 : w.feels;
  const windHigh = w.windUnit === "mph" ? 22 : 35;
  const gustHigh = w.windUnit === "mph" ? 34 : 55;

  if (w.code >= 95) return "Thunderstorms about — worth waiting this one out.";
  if (c >= 28) return "Hot enough to slow you down. Ease off the pace and take water.";
  if (c <= -8) return "Bitter. Cover everything and watch for ice underfoot.";
  if (w.code >= 71 && w.code <= 77) return "Snow — expect slippery ground and forget about pace.";
  if (w.gusts >= gustHigh) return `Gusts to ${w.gusts} ${w.windUnit}. Head out into the wind so it pushes you home.`;
  if (w.wind >= windHigh) return `Windy at ${w.wind} ${w.windUnit}. Start into it and finish with it behind you.`;
  if (isWet(w.code)) return "Wet out there. Shorter strides on the corners.";
  return null;
}

/**
 * The best hour in the next stretch to go out, when the current hour is not it.
 * Returns null when now is fine, or when nothing better is coming — the point
 * is to say something useful, not to always say something.
 */
export function bestWindow(w, { hours = 8 } = {}) {
  const list = (w?.hourly || []).slice(0, hours);
  if (list.length < 2) return null;
  const now = list[0];
  // Score by what would actually spoil a run: rain first, then wind.
  const score = (h) => h.rainChance + h.wind * 1.5;
  let best = now;
  for (const h of list) if (score(h) < score(best) - 12) best = h;
  if (best === now) return null;
  return best;
}

/** One line combining conditions and what they mean. */
export function runAdvice(w) {
  if (!w) return null;
  return { dress: dressFor(w.feels, w.tempUnit), warning: runWarning(w), window: bestWindow(w) };
}

// --- caching ----------------------------------------------------------------

const CACHE_KEY = "stride:weather";
const MAX_AGE_MS = 30 * 60000;      // conditions do not move fast enough to matter
const MOVED_DEG = 0.05;             // ~5 km: far enough to be different weather

export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.w ? c : null;
  } catch { return null; }
}

export function writeCache(w, lat, lon) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ w, lat, lon })); } catch { /* full or blocked */ }
}

export const cacheUsable = (cached, lat, lon, now = Date.now()) =>
  !!cached?.w &&
  now - cached.w.at < MAX_AGE_MS &&
  (!isFinite(lat) || !isFinite(lon) ||
    (Math.abs(cached.lat - lat) < MOVED_DEG && Math.abs(cached.lon - lon) < MOVED_DEG));

/**
 * Cached-first weather for a position. Never throws; returns null when there is
 * nothing to show, so callers can simply not render the strip.
 */
export async function getWeather({ lat, lon, force = false, signal } = {}) {
  const cached = readCache();
  if (!force && cacheUsable(cached, lat, lon)) return cached.w;
  const fresh = await fetchWeather({ lat, lon, signal });
  if (fresh) { writeCache(fresh, lat, lon); return fresh; }
  // A stale reading beats a blank card when the network is down.
  return cached?.w || null;
}
