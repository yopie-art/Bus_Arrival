require('./config');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { getLtaApiKey } = require('./config');
const { requestJson } = require('./http-client');
const { normalizeCalendarUrl, fetchCalendar } = require('./calendar');
const { fetchForecast } = require('./aqicn');
const { normalizeUrl: normalizeAqicnUrl } = require('./public/aqicn-shared');
const defaultFetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

function createApp({ fetchImpl = defaultFetch, ltaApiKey = process.env.LTA_API_KEY, busStops, apiLimit = 120 } = {}) {
    const app = express();
    app.disable('x-powered-by');
    const stopsPath = path.join(__dirname, 'bus_stops.json');
    let stops = busStops || (fs.existsSync(stopsPath) ? JSON.parse(fs.readFileSync(stopsPath, 'utf8')) : null);
    let stopsUpdated = 0;
    const limits = new Map();
    let inFlight = 0;

    app.use((req, res, next) => {
        res.set({
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
            'X-Frame-Options': 'DENY',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api-open.data.gov.sg; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        });
        next();
    });

    // APIs are used by this dashboard only. Do not expose private responses via CORS.
    app.use((req, res, next) => {
        const origin = req.get('origin');
        if (origin) {
            try {
                const parsed = new URL(origin);
                if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== req.get('host')) return res.sendStatus(403);
            } catch { return res.sendStatus(403); }
        }
        next();
    });

    app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

    // Bound expensive upstream requests. No proxy IP headers are trusted for access control.
    app.use(['/bus-arrival', '/aqicn-forecast', '/calendar-proxy'], (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        const now = Date.now();
        const client = req.socket.remoteAddress || 'unknown';
        if (limits.size >= 1000) {
            for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
            if (limits.size >= 1000 && !limits.has(client)) return res.status(429).json({ error: 'Please retry later.' });
        }
        let window = limits.get(client);
        if (!window || window.until <= now) {
            window = { count: 0, until: now + 60000 };
            limits.set(client, window);
        }
        if (++window.count > apiLimit || inFlight >= 8) {
            res.set('Retry-After', '60');
            return res.status(429).json({ error: 'Too many requests. Please retry later.' });
        }
        inFlight++;
        res.once('close', () => { inFlight--; });
        next();
    });

    async function allStops() {
        if (stops && (!stopsUpdated || Date.now() - stopsUpdated < 86400000)) return stops;
        if (!ltaApiKey) throw new Error('LTA configuration is missing.');
        const result = [];
        for (let skip = 0; skip < 20000; skip += 500) {
            const data = await requestJson(`https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip=${skip}`, {
                fetchImpl, headers: { AccountKey: ltaApiKey }
            });
            if (!Array.isArray(data.value)) throw new Error('Invalid bus stops response.');
            result.push(...data.value);
            if (data.value.length < 500) break;
        }
        stops = result;
        stopsUpdated = Date.now();
        return stops;
    }

    app.get('/bus-stops-all', async (req, res) => {
        try { res.json(await allStops()); }
        catch { res.status(502).json({ error: 'Unable to load bus stops.' }); }
    });
    app.get('/bus-stop-description', async (req, res) => {
        const codes = req.query.codes;
        if (typeof codes !== 'string' || (codes !== 'all' && !/^\d{5}(,\d{5}){0,19}$/.test(codes))) return res.sendStatus(400);
        try {
            const map = Object.fromEntries((await allStops()).map(stop => [stop.BusStopCode, stop.Description]));
            res.json(codes === 'all' ? map : Object.fromEntries(codes.split(',').map(code => [code, map[code] || null])));
        } catch { res.status(502).json({ error: 'Unable to load bus stop descriptions.' }); }
    });
    app.get('/majority-region', async (req, res) => {
        const codes = req.query.codes;
        if (typeof codes !== 'string' || !/^\d{5}(,\d{5}){0,19}$/.test(codes)) return res.sendStatus(400);
        try {
            const items = await allStops();
            const counts = new Map();
            for (const code of codes.split(',')) {
                const region = items.find(stop => stop.BusStopCode === code)?.Region;
                if (region) counts.set(region, (counts.get(region) || 0) + 1);
            }
            const majorityRegion = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
            res.json({ majorityRegion, totalStops: codes.split(',').length });
        } catch { res.status(502).json({ error: 'Unable to determine region.' }); }
    });
    app.get('/bus-arrival', async (req, res) => {
        const code = req.query.BusStopCode;
        if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return res.sendStatus(400);
        if (!ltaApiKey) return res.status(503).json({ error: 'Bus arrival service is not configured.' });
        try {
            res.json(await requestJson(`https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${code}`, {
                fetchImpl, headers: { AccountKey: ltaApiKey, Accept: 'application/json' }
            }));
        } catch { res.status(502).json({ error: 'Unable to load bus arrivals.' }); }
    });
    app.get('/aqicn-forecast', async (req, res) => {
        try { normalizeAqicnUrl(req.query.url); }
        catch { return res.status(400).json({ error: 'Enter a valid AQICN forecast or station URL.' }); }
        try { res.json(await fetchForecast(req.query.url, fetchImpl)); }
        catch { res.status(502).json({ error: 'AQICN forecast is temporarily unavailable. Weather will continue to display.' }); }
    });

    // The secret calendar address belongs in a small POST body, never in a request URL or log.
    app.get('/calendar-proxy', (req, res) => res.status(410).json({ error: 'Please refresh the dashboard to update calendar access.' }));
    app.post('/calendar-proxy', express.json({ limit: '8kb', inflate: false, strict: true }), async (req, res) => {
        try { normalizeCalendarUrl(req.body?.url); }
        catch { return res.status(400).json({ error: 'Enter a valid Google Calendar iCal address.' }); }
        try {
            res.type('text/calendar').send(await fetchCalendar(req.body.url, fetchImpl));
        } catch {
            // Exceptions can contain private URLs. Do not log or echo them.
            res.status(502).json({ error: 'Unable to load the calendar. Please check its address and try again.' });
        }
    });

    // Bus-stop selections exist only in each browser; no shared read/write fallback.
    app.use('/bus-stop-selections', (req, res) => res.sendStatus(404));
    app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));
    app.use('/Weather_Images', express.static(path.join(__dirname, 'Weather_Images')));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = [400, 413, 415].includes(error.status) ? error.status : 500;
        res.set('Cache-Control', 'no-store').status(status).json({ error: 'Request could not be processed.' });
    });
    return app;
}

if (require.main === module) {
    // Fail at startup rather than silently running arrivals with an embedded credential.
    getLtaApiKey();
    const port = Number(process.env.PORT) || 3000;
    createApp().listen(port, '0.0.0.0', () => {
        console.log(`Dashboard listening on port ${port}; Node.js ${process.version}`);
    });
}
module.exports = { createApp };
