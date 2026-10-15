const { normalizeUrl } = require('./public/aqicn-shared');

// Parse only JSON embedded in a script. Never execute code from the source page.
function extractFeed(html) {
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
        const match = /\b(?:var\s+feed\s*=|setWidgetAqiGraphModel\s*\()\s*(?=\{)/.exec(script[1]);
        if (!match) continue;
        const start = match.index + match[0].length;
        let depth = 0;
        let quoted = false;
        let escaped = false;
        for (let i = start; i < script[1].length; i++) {
            const c = script[1][i];
            if (quoted) {
                if (escaped) escaped = false;
                else if (c === '\\') escaped = true;
                else if (c === '"') quoted = false;
            } else if (c === '"') quoted = true;
            else if (c === '{') depth++;
            else if (c === '}' && --depth === 0) {
                return JSON.parse(script[1].slice(start, i + 1));
            }
        }
    }
    throw new Error('AQICN forecast data was not found. The source page may have changed.');
}

function decodePm25(data) {
    if (!Array.isArray(data) || data[1] !== 1 || data[3] !== 3600 || !Array.isArray(data[2])) {
        throw new Error('Unsupported PM2.5 forecast encoding.');
    }
    let time = 0;
    let value = 0;
    const points = [];
    function add(deltaTime, deltaValue) {
        time += deltaTime;
        value += deltaValue;
        if (points.length >= 1000 || !Number.isFinite(time) || !Number.isFinite(value) ||
            value < 0 || value > 1000 || !Number.isFinite(new Date(time).getTime()) ||
            (points.length && time <= Date.parse(points[points.length - 1].time))) {
            throw new Error('Invalid PM2.5 forecast values.');
        }
        points.push({ time: new Date(time).toISOString(), value });
    }
    for (const entry of data[2]) {
        if (Array.isArray(entry) && entry.length === 2 && entry.every(Number.isFinite)) add(entry[0] * 3600000, entry[1]);
        else if (typeof entry === 'number' && Number.isFinite(entry)) add(3600000, entry);
        else if (typeof entry === 'string' && /^[a-zA-Z]*$/.test(entry)) {
            for (const c of entry) add(3600000, c >= 'a' ? c.charCodeAt(0) - 97 : -(c.charCodeAt(0) - 65 + 1));
        } else throw new Error('Invalid PM2.5 forecast encoding.');
    }
    return points;
}

function normalizeFeed(feed, sourceUrl) {
    const forecast = feed?.forecast;
    if (!forecast || typeof forecast !== 'object') throw new Error('AQICN forecast is unavailable.');
    let pm25 = null;
    try {
        const species = forecast.species?.pm25;
        const points = decodePm25(species?.data);
        if (points.length && Number.isFinite(Date.parse(species.model?.extracted))) {
            pm25 = { points, updatedAt: species.model.extracted };
        }
    } catch { /* A broken pollutant series must not discard valid temperature data. */ }
    const temperaturePoints = Array.isArray(forecast.wind) ? forecast.wind.slice(0, 1000)
        .filter(point => Number.isFinite(Date.parse(point?.t)) && typeof point?.c === 'number' &&
            Number.isFinite(point.c) && point.c >= -90 && point.c <= 65)
        .map(point => ({ time: new Date(point.t).toISOString(), value: point.c })) : [];
    const updated = typeof feed.timestamp === 'number' ? new Date(feed.timestamp * 1000) : null;
    const temperature = temperaturePoints.length && updated && Number.isFinite(updated.getTime())
        ? { points: temperaturePoints, updatedAt: updated.toISOString() } : null;
    if (!pm25 && !temperature) throw new Error('AQICN has no usable forecast series.');
    return {
        sourceUrl, location: typeof feed.city?.name === 'string' ? feed.city.name.slice(0, 120) : 'AQICN',
        fetchedAt: new Date().toISOString(), pm25, temperature
    };
}

async function fetchForecast(value, fetchImpl) {
    const url = normalizeUrl(value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        async function read(requestUrl, accept) {
            const response = await fetchImpl(requestUrl, {
                signal: controller.signal, redirect: 'error', size: 2 * 1024 * 1024,
                headers: { Accept: accept }
            });
            if (!response.ok) throw new Error(`AQICN returned HTTP ${response.status}.`);
            const text = await response.text();
            if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('AQICN response is too large.');
            return text;
        }
        const feed = extractFeed(await read(url, 'text/html'));
        if (new URL(url).pathname.startsWith('/city/') && !feed.forecast) {
            // Station pages load their hourly forecast separately. Derive the request
            // from the page's numeric station ID; never follow an arbitrary source URL.
            const id = feed.city?.idx;
            if (!Number.isSafeInteger(id) || id <= 0 || id > 1000000000) throw new Error('Invalid AQICN station ID.');
            const payload = JSON.parse(await read(`https://api2.waqi.info/api/feed/@${id}/forecast.json`, 'application/json'));
            return normalizeFeed(stationForecastFeed(feed, payload), url);
        }
        return normalizeFeed(feed, url);
    } finally {
        clearTimeout(timeout);
    }
}

function stationForecastFeed(station, payload) {
    const observations = payload?.rxs?.obs;
    const forecast = Array.isArray(observations) ? observations.find(item => item?.msg?.hourly)?.msg : null;
    if (!forecast) throw new Error('AQICN station forecast is unavailable.');
    const timezone = forecast.city?.timezone || station.time?.utc?.tz;
    if (!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(timezone || '')) throw new Error('Invalid AQICN forecast timezone.');
    return {
        city: station.city,
        timestamp: forecast.xsync?.gen || station.timestamp,
        forecast: {
            species: forecast.hourly.aqi,
            wind: Array.isArray(forecast.hourly.met) ? forecast.hourly.met.slice(0, 1000)
                .filter(point => typeof point?.at === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(point.at))
                .map(point => ({ t: point.at.replace(' ', 'T') + timezone, c: point.t })) : []
        }
    };
}

module.exports = { extractFeed, decodePm25, normalizeFeed, fetchForecast, stationForecastFeed };
