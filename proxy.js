// Remove static bus stop lookup, add dynamic fetch
const API_KEY = process.env.LTA_API_KEY || '9X/bK+BuRLK8mOslIvs9TA==';
const BUS_STOPS_API = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';

// In-memory cache for bus stops
let cachedBusStops = null;
let cachedBusStopsTime = 0;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Load bus stops with region data from local file if available
let localBusStops = null;
try {
    const fs = require('fs');
    const path = require('path');
    const busStopsPath = path.join(__dirname, 'bus_stops.json');
    if (fs.existsSync(busStopsPath)) {
        localBusStops = JSON.parse(fs.readFileSync(busStopsPath, 'utf8'));
        console.log(`Loaded ${localBusStops.length} bus stops with region data from local file`);
    }
} catch (error) {
    console.log('Local bus stops file not found, will use API');
}

async function fetchAllBusStops() {
    // Use local data if available
    if (localBusStops) {
        return localBusStops;
    }
    
    // Fallback to API cache
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

// Function to determine majority region from selected bus stops
function getMajorityRegion(busStopCodes) {
    if (!localBusStops || !Array.isArray(busStopCodes) || busStopCodes.length === 0) {
        return null;
    }
    
    const regionCounts = {};
    
    busStopCodes.forEach(code => {
        const busStop = localBusStops.find(stop => stop.BusStopCode === code);
        if (busStop && busStop.Region) {
            regionCounts[busStop.Region] = (regionCounts[busStop.Region] || 0) + 1;
        }
    });
    
    // Find the region with the most bus stops
    let majorityRegion = null;
    let maxCount = 0;
    for (const [region, count] of Object.entries(regionCounts)) {
        if (count > maxCount) {
            maxCount = count;
            majorityRegion = region;
        }
    }
    
    return majorityRegion;
}
// Simple Node.js Express proxy for LTA DataMall Bus Arrival API
const express = require('express');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const cors = require('cors');

// API_KEY is already declared above
const PORT = 3000;

const path = require('path');
const app = express();
app.use(cors());
app.use(express.json()); // Add JSON parsing middleware
// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve weather images from Weather_Images directory
app.use('/Weather_Images', express.static(path.join(__dirname, 'Weather_Images')));

// In-memory storage for bus stop selections (in production, you'd use a database)
let busStopSelections = [];

// API endpoint to get bus stop description(s)
app.get('/bus-stop-description', async (req, res) => {
    let codes = req.query.codes;
    if (!codes) return res.status(400).json({ error: 'codes query param required' });
    
    try {
        const stops = await fetchAllBusStops();
        const stopMap = {};
        for (const stop of stops) {
            stopMap[stop.BusStopCode] = stop.Description;
        }
        
        // Handle "all" parameter for settings page
        if (codes === 'all') {
            return res.json(stopMap);
        }
        
        // Handle specific codes
        if (!Array.isArray(codes)) codes = codes.split(',');
        const result = {};
        codes.forEach(code => {
            result[code] = stopMap[code] || null;
        });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch bus stop descriptions' });
    }
});

// API endpoint to get all bus stops (for settings page)
app.get('/bus-stops-all', async (req, res) => {
    try {
        const stops = await fetchAllBusStops();
        res.json(stops);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch bus stops' });
    }
});

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

// API endpoint to get bus stop selections
app.get('/bus-stop-selections', (req, res) => {
    res.json(busStopSelections);
});

// API endpoint to save bus stop selections
app.post('/bus-stop-selections', (req, res) => {
    try {
        const selections = req.body;
        
        // Validate that it's an array of valid selections
        if (!Array.isArray(selections)) {
            return res.status(400).json({ error: 'Selections must be an array' });
        }
        
        // Validate each selection has required fields
        for (const selection of selections) {
            if (!selection.code || !selection.description) {
                return res.status(400).json({ error: 'Each selection must have code and description' });
            }
        }
        
        // Store the selections
        busStopSelections = selections;
        
        console.log(`Saved ${selections.length} bus stop selections:`, selections.map(s => s.code).join(', '));
        res.json({ success: true, count: selections.length });
        
    } catch (error) {
        console.error('Error saving bus stop selections:', error);
        res.status(500).json({ error: 'Failed to save selections' });
    }
});

// API endpoint to get majority region for selected bus stops
app.get('/majority-region', (req, res) => {
    try {
        const busStopCodes = req.query.codes;
        if (!busStopCodes) {
            return res.status(400).json({ error: 'codes query parameter is required' });
        }
        
        const codes = Array.isArray(busStopCodes) ? busStopCodes : busStopCodes.split(',');
        const majorityRegion = getMajorityRegion(codes);
        
        res.json({ 
            majorityRegion: majorityRegion,
            totalStops: codes.length 
        });
        
    } catch (error) {
        console.error('Error determining majority region:', error);
        res.status(500).json({ error: 'Failed to determine majority region' });
    }
});

// Calendar proxy endpoint to handle CORS issues
app.get('/calendar-proxy', async (req, res) => {
    try {
        const icalUrl = req.query.url;
        
        if (!icalUrl) {
            return res.status(400).json({ error: 'url query parameter is required' });
        }
        
        // Validate that it's a Google Calendar iCal URL for security
        if (!icalUrl.includes('calendar.google.com/calendar/ical/')) {
            return res.status(400).json({ error: 'Only Google Calendar iCal URLs are supported' });
        }
        
        console.log('Proxying calendar request to:', icalUrl);
        
        // Fetch calendar data from Google
        const response = await fetch(icalUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const icalData = await response.text();
        
        // Set appropriate headers
        res.set('Content-Type', 'text/calendar');
        res.set('Access-Control-Allow-Origin', '*');
        
        res.send(icalData);
        
    } catch (error) {
        console.error('Calendar proxy error:', error);
        res.status(500).json({ error: 'Failed to fetch calendar data' });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running at http://localhost:${PORT}`);
});
