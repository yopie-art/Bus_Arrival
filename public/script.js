// Main page JavaScript for unified bus arrival display
let selectedBusStops = [];
let busStopServices = {}; // Cache for bus services at each stop
let majorityRegion = null; // Store the majority region for weather highlighting

// Load selected bus stops from settings
async function loadSelectedBusStops() {
    try {
        // First try to load from localStorage
        const localSelections = localStorage.getItem('busStopSelections');
        if (localSelections) {
            selectedBusStops = JSON.parse(localSelections);
            if (Array.isArray(selectedBusStops) && selectedBusStops.length > 0) {
                console.log('Loaded selected bus stops from localStorage:', selectedBusStops);
                return;
            }
        }
        
        // Fallback: try to load from backend (for migration purposes)
        const response = await fetch('/bus-stop-selections');
        if (response.ok) {
            selectedBusStops = await response.json();
            if (Array.isArray(selectedBusStops) && selectedBusStops.length > 0) {
                // Migrate to localStorage
                localStorage.setItem('busStopSelections', JSON.stringify(selectedBusStops));
                console.log('Migrated selected bus stops from backend to localStorage');
                return;
            }
        }
        
        // No selections found
        selectedBusStops = [];
        
    } catch (error) {
        console.error('Error loading selected bus stops:', error);
        selectedBusStops = [];
    }
}

// Initialize the page
async function init() {
    await loadSelectedBusStops();
    
    if (selectedBusStops.length === 0) {
        showNoSelectionsMessage();
    } else {
        hideNoSelectionsMessage();
        await initializeTable();
        await loadMajorityRegion(); // Load majority region for weather highlighting
        fetchBusTimes();
        setInterval(fetchBusTimes, 60000); // Update every minute
    }
    
    // Initialize weather forecast
    await fetchWeatherForecast();
    setInterval(fetchWeatherForecast, 1800000); // Update every 30 minutes
    
    // Setup collapsible weather
    setupWeatherToggle();
    
    setupSettingsProximity();
}

function showNoSelectionsMessage() {
    document.getElementById('main-bus-times').style.display = 'none';
    document.getElementById('no-selections').style.display = 'block';
}

function hideNoSelectionsMessage() {
    document.getElementById('main-bus-times').style.display = 'block';
    document.getElementById('no-selections').style.display = 'none';
}

async function initializeTable() {
    // First, get all services for each selected bus stop
    for (const busStop of selectedBusStops) {
        try {
            const response = await fetch(`/bus-arrival?BusStopCode=${busStop.code}`);
            const data = await response.json();
            const availableServices = data.Services || [];
            const serviceNumbers = availableServices.map(s => s.ServiceNo).sort((a, b) => {
                // Sort numerically, then alphabetically
                const aNum = parseInt(a);
                const bNum = parseInt(b);
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return aNum - bNum;
                }
                return a.localeCompare(b);
            });
            busStopServices[busStop.code] = serviceNumbers;
        } catch (error) {
            console.error(`Error fetching services for ${busStop.code}:`, error);
            busStopServices[busStop.code] = [];
        }
    }
    
    // Now build the table structure
    buildTableStructure();
}

function buildTableStructure() {
    const tableBody = document.querySelector('#mainTable tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    selectedBusStops.forEach((busStop, stopIndex) => {
        const services = busStopServices[busStop.code] || [];
        const groupClass = stopIndex % 2 === 0 ? 'bus-stop-group-even' : 'bus-stop-group-odd';
        
        // Add a separator row between bus stop groups (except for the first one)
        if (stopIndex > 0) {
            const separatorRow = document.createElement('tr');
            separatorRow.className = 'bus-stop-separator';
            separatorRow.innerHTML = `<td colspan="5" class="bus-stop-separator-cell"></td>`;
            tableBody.appendChild(separatorRow);
        }
        
        if (services.length === 0) {
            // Create a single row for bus stops with no services
            const row = document.createElement('tr');
            row.className = groupClass;
            row.innerHTML = `
                <td class="bus-stop-cell">
                    <span class="bus-stop-code">${busStop.code}</span>
                    <span class="bus-stop-desc">${busStop.description}</span>
                </td>
                <td colspan="4" style="font-style: italic; color: #888;">No bus services available</td>
            `;
            tableBody.appendChild(row);
            return;
        }
        
        services.forEach((busNo, serviceIndex) => {
            const row = document.createElement('tr');
            row.className = groupClass;
            row.id = `row-${busStop.code}-${busNo}`;
            
            if (serviceIndex === 0) {
                // First row for this bus stop - add the merged bus stop cell
                const busStopCell = document.createElement('td');
                busStopCell.className = 'bus-stop-cell';
                busStopCell.rowSpan = services.length;
                busStopCell.innerHTML = `
                    <span class="bus-stop-code">${busStop.code}</span>
                    <span class="bus-stop-desc">${busStop.description}</span>
                `;
                row.appendChild(busStopCell);
            }
            
            // Add bus number and arrival time cells
            row.innerHTML += `
                <td>${busNo}</td>
                <td class="arrival arrival-cell" id="bus-${busStop.code}-${busNo}-1">Loading...</td>
                <td class="arrival arrival-cell" id="bus-${busStop.code}-${busNo}-2">Loading...</td>
                <td class="arrival arrival-cell" id="bus-${busStop.code}-${busNo}-3">Loading...</td>
            `;
            
            tableBody.appendChild(row);
        });
    });
}

function fetchBusTimes() {
    selectedBusStops.forEach(busStop => {
        fetch(`/bus-arrival?BusStopCode=${busStop.code}`)
            .then(response => response.json())
            .then(data => {
                const availableServices = data.Services || [];
                
                // Update arrival times for each service
                availableServices.forEach(service => {
                    const busNo = service.ServiceNo;
                    
                    for (let i = 1; i <= 3; i++) {
                        const elemId = `bus-${busStop.code}-${busNo}-${i}`;
                        const arrivalElem = document.getElementById(elemId);
                        if (!arrivalElem) continue;
                        
                        let nextBus = null;
                        if (i === 1) nextBus = service.NextBus;
                        if (i === 2) nextBus = service.NextBus2;
                        if (i === 3) nextBus = service.NextBus3;
                        
                        let newContent;
                        let dataKey;
                        if (nextBus && nextBus.EstimatedArrival) {
                            const eta = getMinutesToArrival(nextBus.EstimatedArrival);
                            let loadClass = "blue";
                            if (nextBus.Load === "SEA") loadClass = "green";
                            else if (nextBus.Load === "SDA") loadClass = "orange";
                            else if (nextBus.Load === "LSD") loadClass = "red";
                            let ddIcon = "";
                            if (nextBus.Type === "DD") {
                                ddIcon = `<svg class='dd-icon' viewBox='0 0 24 24' fill='currentColor'><rect x='2' y='4' width='20' height='7' rx='2' fill='#1976d2'/><rect x='2' y='13' width='20' height='7' rx='2' fill='#1976d2'/><rect x='4' y='6' width='16' height='3' rx='1' fill='#fff'/><rect x='4' y='15' width='16' height='3' rx='1' fill='#fff'/></svg>`;
                            }
                            newContent = `<span class='arrival ${loadClass}'>${eta} min${ddIcon}</span>`;
                            dataKey = `${eta}-${loadClass}-${nextBus.Type || 'SD'}`;
                        } else {
                            newContent = "No data";
                            dataKey = "no-data";
                        }
                        
                        // Compare with stored data key instead of HTML content
                        const currentDataKey = arrivalElem.getAttribute('data-key');
                        if (arrivalElem && currentDataKey !== dataKey) {
                            // Store the new data key
                            arrivalElem.setAttribute('data-key', dataKey);
                            
                            // Add fade effect for smooth transition
                            arrivalElem.classList.add('updating');
                            
                            setTimeout(() => {
                                arrivalElem.innerHTML = newContent;
                                arrivalElem.classList.remove('updating');
                            }, 500);
                        }
                    }
                });
                
                // Handle services that are no longer available
                const currentServices = busStopServices[busStop.code] || [];
                const availableServiceNumbers = availableServices.map(s => s.ServiceNo);
                currentServices.forEach(busNo => {
                    if (!availableServiceNumbers.includes(busNo)) {
                        // Service no longer available, mark as no data
                        for (let i = 1; i <= 3; i++) {
                            const elemId = `bus-${busStop.code}-${busNo}-${i}`;
                            const elem = document.getElementById(elemId);
                            if (elem && elem.getAttribute('data-key') !== "no-data") {
                                elem.setAttribute('data-key', "no-data");
                                elem.classList.add('updating');
                                setTimeout(() => {
                                    elem.innerHTML = "No data";
                                    elem.classList.remove('updating');
                                }, 500);
                            }
                        }
                    }
                });
            })
            .catch((err) => {
                console.error(`Fetch error for ${busStop.code}:`, err);
                // Handle error for existing services only
                const services = busStopServices[busStop.code] || [];
                services.forEach(busNo => {
                    for (let i = 1; i <= 3; i++) {
                        const elemId = `bus-${busStop.code}-${busNo}-${i}`;
                        const elem = document.getElementById(elemId);
                        if (elem && elem.getAttribute('data-key') !== "error") {
                            elem.setAttribute('data-key', "error");
                            elem.classList.add('updating');
                            setTimeout(() => {
                                elem.innerHTML = "Error";
                                elem.classList.remove('updating');
                            }, 500);
                        }
                    }
                });
            });
    });
}
function getMinutesToArrival(estimatedArrival) {
    const arrival = new Date(estimatedArrival);
    const now = new Date();
    const diffMs = arrival - now;
    return Math.max(0, Math.round(diffMs / 60000));
}

// Load majority region for selected bus stops
async function loadMajorityRegion() {
    try {
        if (selectedBusStops.length === 0) {
            majorityRegion = null;
            // Update header weather when no region is selected
            updateHeaderWeather([]);
            return;
        }
        
        const codes = selectedBusStops.map(stop => stop.code).join(',');
        const response = await fetch(`/majority-region?codes=${codes}`);
        
        if (response.ok) {
            const data = await response.json();
            majorityRegion = data.majorityRegion;
            console.log(`Majority region for selected bus stops: ${majorityRegion}`);
            
            // Trigger weather update to refresh header weather
            fetchWeatherForecast();
        } else {
            console.error('Failed to load majority region');
            majorityRegion = null;
        }
    } catch (error) {
        console.error('Error loading majority region:', error);
        majorityRegion = null;
    }
}

// Initialize page when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    init();
});

function setupSettingsProximity() {
    const settingsLink = document.querySelector('.settings-link');
    if (!settingsLink) return;
    
    let isNearby = false;
    
    document.addEventListener('mousemove', (e) => {
        const rect = settingsLink.getBoundingClientRect();
        const buttonCenterX = rect.left + rect.width / 2;
        const buttonCenterY = rect.top + rect.height / 2;
        
        // Calculate distance from mouse to button center
        const distance = Math.sqrt(
            Math.pow(e.clientX - buttonCenterX, 2) + 
            Math.pow(e.clientY - buttonCenterY, 2)
        );
        
        // Half button size distance (approximately 25px)
        const proximityDistance = Math.max(rect.width, rect.height) / 2 + 25;
        
        const shouldBeNearby = distance <= proximityDistance;
        
        if (shouldBeNearby !== isNearby) {
            isNearby = shouldBeNearby;
            settingsLink.classList.toggle('nearby', isNearby);
        }
    });
}

// Weather Forecast Functions
async function fetchWeatherForecast() {
    try {
        const response = await fetch('https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast');
        const data = await response.json();
        
        if (data.code === 0 && data.data && data.data.records && data.data.records.length > 0) {
            const record = data.data.records[0];
            const periods = record.periods || [];
            
            updateWeatherTableHeaders(); // Update headers with highlighting
            updateWeatherTable(periods);
            updateHeaderWeather(periods); // Update header weather icons
        } else {
            console.error('Invalid weather data structure:', data);
            showWeatherError();
        }
    } catch (error) {
        console.error('Error fetching weather forecast:', error);
        showWeatherError();
    }
}

function updateWeatherTableHeaders() {
    const tableHead = document.querySelector('#weatherTable thead tr');
    if (!tableHead) return;
    
    // Determine which header to highlight based on majority region
    const westClass = majorityRegion === 'west' ? 'highlighted-region-header' : '';
    const northClass = majorityRegion === 'north' ? 'highlighted-region-header' : '';
    const southClass = majorityRegion === 'south' ? 'highlighted-region-header' : '';
    const eastClass = majorityRegion === 'east' ? 'highlighted-region-header' : '';
    
    tableHead.innerHTML = `
        <th>Time Period</th>
        <th class="${westClass}">West</th>
        <th class="${northClass}">North</th>
        <th class="${southClass}">South</th>
        <th class="${eastClass}">East</th>
    `;
}

function updateWeatherTable(periods) {
    const tableBody = document.querySelector('#weatherTable tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';
    
    periods.forEach(period => {
        if (!period.timePeriod || !period.regions) return;
        
        const row = document.createElement('tr');
        
        // Format time period text for better display
        const timePeriodText = formatTimePeriod(period.timePeriod.text);
        
        // Determine which columns to highlight based on majority region
        const westClass = majorityRegion === 'west' ? 'weather-cell highlighted-region' : 'weather-cell';
        const northClass = majorityRegion === 'north' ? 'weather-cell highlighted-region' : 'weather-cell';
        const southClass = majorityRegion === 'south' ? 'weather-cell highlighted-region' : 'weather-cell';
        const eastClass = majorityRegion === 'east' ? 'weather-cell highlighted-region' : 'weather-cell';
        
        row.innerHTML = `
            <td class="time-period-cell">${timePeriodText}</td>
            <td class="${westClass}">${getWeatherImage(period.regions.west?.text)}</td>
            <td class="${northClass}">${getWeatherImage(period.regions.north?.text)}</td>
            <td class="${southClass}">${getWeatherImage(period.regions.south?.text)}</td>
            <td class="${eastClass}">${getWeatherImage(period.regions.east?.text)}</td>
        `;
        
        tableBody.appendChild(row);
    });
    
    // Add last updated timestamp
    const lastUpdated = new Date().toLocaleTimeString();
    const timestampRow = document.createElement('tr');
    timestampRow.className = 'weather-timestamp';
    timestampRow.innerHTML = `
        <td colspan="5" style="text-align: center; font-size: 0.9em; color: #666; font-style: italic;">
            Last updated: ${lastUpdated}
            ${majorityRegion ? ` | Highlighting ${majorityRegion.charAt(0).toUpperCase() + majorityRegion.slice(1)} region (majority of selected bus stops)` : ''}
        </td>
    `;
    tableBody.appendChild(timestampRow);
}

function formatTimePeriod(text) {
    // Convert API time period text to more readable format
    // Examples: "Midday to 6 pm 26 Jul" -> "12 PM - 6 PM"
    //          "6 pm 26 Jul to 6 am 27 Jul" -> "6 PM - 6 AM (Next Day)"
    //          "6 am to Midday 27 Jul" -> "6 AM - 12 PM"
    
    if (text.includes('Midday to 6 pm')) {
        return '12 PM - 6 PM';
    } else if (text.includes('6 pm') && text.includes('6 am')) {
        return '6 PM - 6 AM (+1)';
    } else if (text.includes('6 am to Midday')) {
        return '6 AM - 12 PM';
    }
    
    // Fallback: return original text
    return text;
}

function getWeatherImage(weatherText) {
    if (!weatherText || weatherText === 'N/A') {
        return '<span style="color: #666;">N/A</span>';
    }
    
    // Map weather text to image filename
    const imagePath = `Weather_Images/${weatherText}.png`;
    
    return `<div class="weather-icon-container">
                <img src="${imagePath}" alt="${weatherText}" class="weather-icon" title="${weatherText}" />
                <span class="weather-text">${weatherText}</span>
            </div>`;
}

function showWeatherError() {
    const tableBody = document.querySelector('#weatherTable tbody');
    if (!tableBody) return;
    
    tableBody.innerHTML = `
        <tr>
            <td colspan="5" style="text-align: center; color: #ff6b6b; font-style: italic;">
                Unable to load weather forecast. Please try again later.
            </td>
        </tr>
    `;
}

// Setup collapsible weather functionality
function setupWeatherToggle() {
    const weatherHeader = document.getElementById('weatherHeader');
    const weatherToggle = document.getElementById('weatherToggle');
    const weatherContent = document.getElementById('weatherContent');
    
    if (!weatherHeader || !weatherToggle || !weatherContent) return;
    
    weatherHeader.addEventListener('click', () => {
        const isCollapsed = weatherContent.classList.contains('hidden');
        
        if (isCollapsed) {
            // Expand
            weatherContent.classList.remove('hidden');
            weatherToggle.classList.remove('collapsed');
        } else {
            // Collapse
            weatherContent.classList.add('hidden');
            weatherToggle.classList.add('collapsed');
        }
    });
}

// Update header weather icons for majority region
function updateHeaderWeather(periods) {
    const headerWeather = document.getElementById('headerWeather');
    if (!headerWeather) return;
    
    if (!majorityRegion) {
        // Show a message when no bus stops are selected
        headerWeather.innerHTML = `
            <div style="color: #888; font-size: 0.9em; text-align: center; padding: 10px;">
                Select bus stops to see regional weather
            </div>
        `;
        return;
    }
    
    headerWeather.innerHTML = '';
    
    periods.forEach(period => {
        if (!period.timePeriod || !period.regions) return;
        
        const regionWeather = period.regions[majorityRegion];
        if (!regionWeather) return;
        
        const timePeriodText = formatTimePeriodShort(period.timePeriod.text);
        
        const weatherItem = document.createElement('div');
        weatherItem.className = 'header-weather-item';
        
        weatherItem.innerHTML = `
            <div class="header-weather-period">${timePeriodText}</div>
            <div class="header-weather-icon-container">
                <img src="Weather_Images/${regionWeather.text}.png" alt="${regionWeather.text}" class="header-weather-icon" />
                <div class="header-weather-text">${regionWeather.text}</div>
            </div>
        `;
        
        headerWeather.appendChild(weatherItem);
    });
}

// Format time period for header display (shorter version)
function formatTimePeriodShort(text) {
    if (text.includes('Midday to 6 pm')) {
        return '12-6PM';
    } else if (text.includes('6 pm') && text.includes('6 am')) {
        return '6PM-6AM';
    } else if (text.includes('6 am to Midday')) {
        return '6AM-12PM';
    }
    
    // Fallback: return first few words
    return text.split(' ').slice(0, 2).join(' ');
}
