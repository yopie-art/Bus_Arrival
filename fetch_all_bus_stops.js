// Fetch all bus stops from LTA DataMall API, handling pagination, and save as bus_stops.json
// Usage: node fetch_all_bus_stops.js

const fetch = require('node-fetch');
const fs = require('fs');

const API_KEY = process.env.LTA_API_KEY || '9X/bK+BuRLK8mOslIvs9TA==';
const API_URL = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';
const OUTPUT_FILE = 'bus_stops.json';

async function fetchAllBusStops() {
    let allStops = [];
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
        const res = await fetch(`${API_URL}?$skip=${skip}`, {
            headers: { AccountKey: API_KEY }
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
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allStops, null, 2));
    console.log(`Saved ${allStops.length} bus stops to ${OUTPUT_FILE}`);
}

fetchAllBusStops().catch(err => {
    console.error('Error:', err);
});
