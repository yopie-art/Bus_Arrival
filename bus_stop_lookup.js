// Loads bus_stops.json and provides a lookup for BusStopCode -> Description
const fs = require('fs');

let busStopMap = {};
try {
  const stops = JSON.parse(fs.readFileSync('bus_stops.json'));
  for (const stop of stops) {
    busStopMap[stop.BusStopCode] = stop.Description;
  }
} catch (e) {
  console.error('Could not load bus_stops.json:', e);
}

module.exports = busStopMap;
