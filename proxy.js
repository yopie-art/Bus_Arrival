// Remove static bus stop lookup, add dynamic fetch
const BUS_STOPS_API = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';

// In-memory cache for bus stops
let cachedBusStops = null;
let cachedBusStopsTime = 0;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function fetchAllBusStops() {
    const now = Date.now();
    if (cachedBusStops && (now - cachedBusStopsTime < ONE_DAY_MS)) {
        return cachedBusStops;
    }
    let allStops = [];
    let skip = 0;
    let hasMore = true;
    while (hasMore) {
        const res = await fetch(`${BUS_STOPS_API}?$skip=${skip}`, {
            headers: { 'AccountKey': API_KEY }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.value && data.value.length > 0) {
            allStops = allStops.concat(data.value);
            skip += data.value.length;
            if (data.value.length < 500) hasMore = false;
        } else {
            hasMore = false;
        }
    }
    cachedBusStops = allStops;
    cachedBusStopsTime = now;
    return allStops;
}
// API endpoint to get bus stop description(s)
app.get('/bus-stop-description', async (req, res) => {
    let codes = req.query.codes;
    if (!codes) return res.status(400).json({ error: 'codes query param required' });
    if (!Array.isArray(codes)) codes = codes.split(',');
    try {
        const stops = await fetchAllBusStops();
        const stopMap = {};
        for (const stop of stops) {
            stopMap[stop.BusStopCode] = stop.Description;
        }
        const result = {};
        codes.forEach(code => {
            result[code] = stopMap[code] || null;
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch bus stop descriptions' });
    }
});
// Simple Node.js Express proxy for LTA DataMall Bus Arrival API
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const cors = require('cors');

// API_KEY is already declared above
const PORT = 3000;


const path = require('path');
const app = express();
app.use(cors());
// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/bus-arrival', async (req, res) => {
    const busStopCode = req.query.BusStopCode;
    if (!busStopCode) {
        return res.status(400).json({ error: 'BusStopCode is required' });
    }
    const url = `https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=${busStopCode}`;
    try {
        const response = await fetch(url, {
            headers: {
                'AccountKey': API_KEY,
                'accept': 'application/json'
            }
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.error("Proxy error:", err);
        res.status(500).json({ error: 'Failed to fetch from LTA API' });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running at http://localhost:${PORT}`);
});
