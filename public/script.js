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

    // Setup collapsible weather (collapsed by default)
    setupWeatherToggle(true);

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
        // Fetch both 24-hour regional forecast (for header) and 4-day outlook (for table)
        const [regionalResponse, fourDayResponse] = await Promise.all([
            fetch('https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast'),
            fetch('https://api-open.data.gov.sg/v2/real-time/api/four-day-outlook')
        ]);
        
        const regionalData = await regionalResponse.json();
        const fourDayData = await fourDayResponse.json();
        
        // Handle regional data for header weather icons
        if (regionalData.code === 0 && regionalData.data && regionalData.data.records && regionalData.data.records.length > 0) {
            const record = regionalData.data.records[0];
            const periods = record.periods || [];
            updateHeaderWeather(periods); // Update header weather icons
        }
        
        // Handle 4-day outlook data for the main weather table
        if (fourDayData.code === 0 && fourDayData.data && fourDayData.data.records && fourDayData.data.records.length > 0) {
            const record = fourDayData.data.records[0];
            const forecasts = record.forecasts || [];
            
            updateFourDayWeatherTable(forecasts);
        } else {
            console.error('Invalid 4-day weather data structure:', fourDayData);
            showWeatherError();
        }
    } catch (error) {
        console.error('Error fetching weather forecast:', error);
        showWeatherError();
    }
}

function updateFourDayWeatherTable(forecasts) {
    const tableHead = document.querySelector('#weatherTable thead tr');
    const tableBody = document.querySelector('#weatherTable tbody');
    if (!tableHead || !tableBody) return;
    
    // Update table headers with days
    let headerHTML = '<th></th>'; // Empty first column header
    forecasts.forEach(forecast => {
        if (forecast.day && forecast.timestamp) {
            const date = new Date(forecast.timestamp);
            const dayName = forecast.day.slice(0, 3); // Mon, Tue, etc.
            const dayMonth = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            headerHTML += `<th>${dayName}<br><small>${dayMonth}</small></th>`;
        }
    });
    tableHead.innerHTML = headerHTML;
    
    // Clear existing body content
    tableBody.innerHTML = '';
    
    // Summary Row (new)
    const summaryRow = document.createElement('tr');
    summaryRow.innerHTML = '<td class="time-period-cell">Summary</td>';
    forecasts.forEach(forecast => {
        const summary = forecast.forecast?.summary || 'N/A';
        summaryRow.innerHTML += `<td class="weather-cell">
            <div style="font-size: 0.85em; text-align: center; color: #cccccc; line-height: 1.2;">
                ${summary}
            </div>
        </td>`;
    });
    tableBody.appendChild(summaryRow);
    
    // Weather Row
    const weatherRow = document.createElement('tr');
    weatherRow.innerHTML = '<td class="time-period-cell">Weather</td>';
    forecasts.forEach(forecast => {
        const weatherText = forecast.forecast?.text || 'N/A';
        weatherRow.innerHTML += `<td class="weather-cell">${getWeatherImageForFourDay(weatherText)}</td>`;
    });
    tableBody.appendChild(weatherRow);
    
    // Temperature Row
    const tempRow = document.createElement('tr');
    tempRow.innerHTML = '<td class="time-period-cell">Temperature</td>';
    forecasts.forEach(forecast => {
        const tempLow = forecast.temperature?.low || '-';
        const tempHigh = forecast.temperature?.high || '-';
        tempRow.innerHTML += `<td class="weather-cell">
            <div style="font-weight: bold; color: #ff6b6b; font-size: 0.9em;">${tempHigh}°C</div>
            <div style="font-weight: bold; color: #60a5fa; font-size: 0.9em;">${tempLow}°C</div>
            <div style="font-size: 0.7em; color: #888;">High / Low</div>
        </td>`;
    });
    tableBody.appendChild(tempRow);
    
    // Humidity Row
    const humidityRow = document.createElement('tr');
    humidityRow.innerHTML = '<td class="time-period-cell">Humidity</td>';
    forecasts.forEach(forecast => {
        const humidityLow = forecast.relativeHumidity?.low || '-';
        const humidityHigh = forecast.relativeHumidity?.high || '-';
        humidityRow.innerHTML += `<td class="weather-cell">
            <div style="font-weight: bold;">${humidityHigh}%</div>
            <div style="font-size: 0.8em; color: #888;">${humidityLow}%</div>
            <div style="font-size: 0.7em; color: #888;">High / Low</div>
        </td>`;
    });
    tableBody.appendChild(humidityRow);
    
    // Add last updated timestamp
    const lastUpdated = new Date().toLocaleTimeString();
    const timestampRow = document.createElement('tr');
    timestampRow.className = 'weather-timestamp';
    timestampRow.innerHTML = `
        <td colspan="${forecasts.length + 1}" style="text-align: center; font-size: 0.9em; color: #666; font-style: italic;">
            4-Day Weather Outlook | Last updated: ${lastUpdated}
        </td>
    `;
    tableBody.appendChild(timestampRow);
}

function getWeatherImageForFourDay(weatherText) {
    if (!weatherText || weatherText === 'N/A') {
        return '<span style="color: #666;">N/A</span>';
    }
    
    // Map weather text to image filename - for 4-day forecast we use the main weather directory
    const imagePath = `../Weather_Images/${weatherText}.png`;
    
    return `<div class="weather-icon-container">
                <img src="${imagePath}" alt="${weatherText}" class="weather-icon" title="${weatherText}" onerror="this.style.display='none'; this.nextElementSibling.style.color='#ff6b6b';" />
                <span class="weather-text">${weatherText}</span>
            </div>`;
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
                Unable to load 4-day weather forecast. Please try again later.
            </td>
        </tr>
    `;
}

// Setup collapsible weather functionality
function setupWeatherToggle(startCollapsed = false) {
    const weatherHeader = document.getElementById('weatherHeader');
    const weatherToggle = document.getElementById('weatherToggle');
    const weatherContent = document.getElementById('weatherContent');

    if (!weatherHeader || !weatherToggle || !weatherContent) return;

    // Collapse by default if requested
    if (startCollapsed) {
        weatherContent.classList.add('hidden');
        weatherToggle.classList.add('collapsed');
    }

    // Only toggle when clicking the button, not the whole header
    weatherToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = weatherContent.classList.contains('hidden');
        if (isCollapsed) {
            weatherContent.classList.remove('hidden');
            weatherToggle.classList.remove('collapsed');
        } else {
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
