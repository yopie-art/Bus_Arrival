// Node.js script to fetch all pages of LTA BusServices and save to test.txt
const fs = require('fs');

const { getLtaApiKey } = require('./config');
const { requestJson } = require('./http-client');
const API_KEY = getLtaApiKey();
const BASE_URL = 'https://datamall2.mytransport.sg/ltaodataservice/BusServices';
const OUTPUT_FILE = 'test.txt';

async function fetchAllBusServices() {
    let allServices = [];
    let skip = 0;
    let page = 1;
    while (true) {
        const url = skip === 0 ? BASE_URL : `${BASE_URL}?$skip=${skip}`;
        console.log(`Fetching page ${page} (${url})...`);
        const data = await requestJson(url, {
            headers: {
                'AccountKey': API_KEY,
                'accept': 'application/json'
            }
        });
        if (!data.value || data.value.length === 0) break;
        allServices = allServices.concat(data.value);
        skip += data.value.length;
        page++;
    }
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allServices, null, 2));
    console.log(`Saved ${allServices.length} bus services to ${OUTPUT_FILE}`);
}

fetchAllBusServices().catch(console.error);
