// Fetch all bus stops from LTA DataMall API, handling pagination, and save as bus_stops.json
// Usage: node fetch_all_bus_stops.js

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs');

const API_KEY = process.env.LTA_API_KEY || '9X/bK+BuRLK8mOslIvs9TA==';
const API_URL = 'https://datamall2.mytransport.sg/ltaodataservice/BusStops';
const OUTPUT_FILE = 'bus_stops.json';

// Reference coordinates for Singapore regions
const REFERENCE_POINTS = {
    west: { lat: 1.3485, lng: 103.7489 },    // Bukit Batok
    north: { lat: 1.4382, lng: 103.7890 },  // Woodlands  
    south: { lat: 1.2654, lng: 103.8221 },  // Harbourfront
    east: { lat: 1.3496, lng: 103.9568 }    // Tampines
};

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Categorize bus stop into region based on closest reference point
function categorizeRegion(latitude, longitude) {
    let closestRegion = 'west';
    let minDistance = Infinity;
    
    for (const [region, coords] of Object.entries(REFERENCE_POINTS)) {
        const distance = calculateDistance(latitude, longitude, coords.lat, coords.lng);
        if (distance < minDistance) {
            minDistance = distance;
            closestRegion = region;
        }
    }
    
    return closestRegion;
}

async function fetchAllBusStops() {
    let allStops = [];
    let skip = 0;
    let hasMore = true;

    console.log('Fetching bus stops from LTA DataMall API...');

    while (hasMore) {
        console.log(`Fetching batch starting at ${skip}...`);
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

    console.log(`Fetched ${allStops.length} bus stops. Categorizing by regions...`);

    // Add region categorization to each bus stop
    const categorizedStops = allStops.map(stop => {
        const latitude = parseFloat(stop.Latitude);
        const longitude = parseFloat(stop.Longitude);
        const region = categorizeRegion(latitude, longitude);
        
        return {
            ...stop,
            Region: region
        };
    });

    // Count stops by region for verification
    const regionCounts = categorizedStops.reduce((counts, stop) => {
        counts[stop.Region] = (counts[stop.Region] || 0) + 1;
        return counts;
    }, {});

    console.log('Region distribution:', regionCounts);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(categorizedStops, null, 2));
    console.log(`Saved ${categorizedStops.length} bus stops with region data to ${OUTPUT_FILE}`);
}

fetchAllBusStops().catch(err => {
    console.error('Error:', err);
});
