// Météo via Open-Meteo (gratuit, sans clé)
const mode = arr => {
  const n = new Map();
  arr.forEach(v => n.set(v, (n.get(v) || 0) + 1));
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0][0];
};
// Si au moins 2 heures de précipitations dans la tranche, on affiche la pluie plutôt que le "plutôt nuageux"
const pick = codes => {
  const wet = codes.filter(c => c >= 51);
  return wet.length >= 2 ? mode(wet) : mode(codes);
};

export function emoji(code) {
  if (code === 0) return '☀️';
  if (code === 1) return '🌤️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌧️';
  if (code === 85 || code === 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '☁️';
}

const PART_OF_HOUR = h => (h >= 6 && h < 12 ? 'matin' : h >= 12 && h < 17 ? 'midi' : h >= 17 && h < 23 ? 'soir' : null);

// Retourne { 'YYYY-MM-DD': { code, min, max, parts: { matin|midi|soir: { code, t } } } }
export async function fetchWeather(lat, lon) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.search = new URLSearchParams({
    latitude: lat, longitude: lon,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    hourly: 'weather_code,temperature_2m',
    timezone: 'auto', past_days: 1, forecast_days: 16,
  });
  const r = await fetch(u);
  if (!r.ok) throw new Error('Météo indisponible');
  const j = await r.json();

  const out = {};
  j.daily.time.forEach((d, i) => {
    out[d] = { code: j.daily.weather_code[i], min: j.daily.temperature_2m_min[i], max: j.daily.temperature_2m_max[i], parts: {} };
  });

  const buckets = {};
  j.hourly.time.forEach((t, i) => {
    const [d, h] = t.split('T');
    const part = PART_OF_HOUR(+h.slice(0, 2));
    if (!part || !out[d]) return;
    const b = ((buckets[d] ||= {})[part] ||= { codes: [], temps: [] });
    b.codes.push(j.hourly.weather_code[i]);
    b.temps.push(j.hourly.temperature_2m[i]);
  });
  for (const [d, parts] of Object.entries(buckets)) {
    for (const [p, b] of Object.entries(parts)) {
      out[d].parts[p] = { code: pick(b.codes), t: b.temps.reduce((a, c) => a + c, 0) / b.temps.length };
    }
  }
  return out;
}

export async function searchPlaces(q) {
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.search = new URLSearchParams({ name: q, count: 5, language: 'fr', format: 'json' });
  const r = await fetch(u);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results || []).map(x => ({
    name: x.name + (x.admin1 ? ` (${x.admin1})` : ''),
    lat: x.latitude, lon: x.longitude,
  }));
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Géolocalisation indisponible'));
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        let name = 'Ma position';
        try {
          const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=fr`);
          const j = await r.json();
          name = j.city || j.locality || name;
        } catch { /* on garde "Ma position" */ }
        resolve({ name, lat, lon });
      },
      () => reject(new Error('Position refusée')),
      { timeout: 10000, maximumAge: 600000 }
    );
  });
}
