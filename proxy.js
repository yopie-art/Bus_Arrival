// Add bus stop lookup
const busStopMap = require('./bus_stop_lookup');
// API endpoint to get bus stop description(s)
app.get('/bus-stop-description', (req, res) => {
    let codes = req.query.codes;
    if (!codes) return res.status(400).json({ error: 'codes query param required' });
    if (!Array.isArray(codes)) codes = codes.split(',');
    const result = {};
    codes.forEach(code => {
        result[code] = busStopMap[code] || null;
    });
    res.json(result);
});
// Simple Node.js Express proxy for LTA DataMall Bus Arrival API
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const cors = require('cors');

const API_KEY = '9X/bK+BuRLK8mOslIvs9TA=='; // Use your actual API key here
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
