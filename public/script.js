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
    // Initialize weather, calendar toggles, and today's snippet
    setupWeatherToggle(true);
    setupCalendarToggle(true);
    loadTodayCalendarSnippet();

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
            <div style="font-size: 1.1em; text-align: center; color: #ffffff; line-height: 1.3; font-weight: 500; word-wrap: break-word; white-space: normal; padding: 4px 2px;">
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

// Setup collapsible calendar functionality
function setupCalendarToggle(startCollapsed = false) {
    const calendarHeader = document.getElementById('calendarHeader');
    const calendarToggle = document.getElementById('calendarToggle');
    const calendarContent = document.getElementById('calendarContent');

    if (!calendarHeader || !calendarToggle || !calendarContent) return;

    // Collapse by default if requested
    if (startCollapsed) {
        calendarContent.classList.add('hidden');
        calendarToggle.classList.add('collapsed');
    }

    // Only toggle when clicking the button, not the whole header
    calendarToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = calendarContent.classList.contains('hidden');
        if (isCollapsed) {
            calendarContent.classList.remove('hidden');
            calendarToggle.classList.remove('collapsed');
            // Load calendar data when first opened
            loadCalendarEvents();
        } else {
            calendarContent.classList.add('hidden');
            calendarToggle.classList.add('collapsed');
        }
    });
}

// Load today's calendar events snippet
async function loadTodayCalendarSnippet() {
    const container = document.getElementById('today-calendar-snippet');
    
    if (!container) return;
    
    // Get calendar URL from localStorage
    const calendarUrl = localStorage.getItem('calendarUrl');
    
    if (!calendarUrl) {
        // Hide snippet if no calendar URL configured
        container.classList.remove('has-events');
        container.style.display = 'none';
        return;
    }
    
    try {
        console.log('Attempting to fetch calendar from:', calendarUrl);
        
        // Use server-side proxy to avoid CORS issues
        const proxyUrl = `/calendar-proxy?url=${encodeURIComponent(calendarUrl)}`;
        const response = await fetch(proxyUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const icalData = await response.text();
        console.log('iCal data received, length:', icalData.length);
        
        const events = parseICalData(icalData);
        console.log('Parsed events:', events.length);
        
        const todayEvents = filterTodayEvents(events);
        console.log('Today events:', todayEvents.length);
        
        if (todayEvents.length > 0) {
            displayTodaySnippet(todayEvents);
        } else {
            // Hide snippet if no events today
            container.classList.remove('has-events');
            container.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading today calendar snippet:', error);
        
        // Show a fallback message for CORS issues
        if (error.message.includes('CORS') || error.message.includes('fetch')) {
            container.innerHTML = `
                <div class="today-snippet-events">
                    <div class="today-snippet-event">
                        <div class="today-snippet-time">📅</div>
                        <div class="today-snippet-title">Calendar configured (CORS limitation)</div>
                    </div>
                </div>
            `;
            container.classList.add('has-events');
            container.style.display = 'block';
        } else {
            // Hide snippet on other errors
            container.classList.remove('has-events');
            container.style.display = 'none';
        }
    }
}

// Extract calendar ID from Google Calendar embed URL (keeping for potential future use)
function extractCalendarId(embedUrl) {
    try {
        const url = new URL(embedUrl);
        const src = url.searchParams.get('src');
        if (src) {
            return decodeURIComponent(src);
        }
        return null;
    } catch (error) {
        console.error('Error parsing calendar URL:', error);
        return null;
    }
}

// Simple iCal parser for basic event extraction
function parseICalData(icalData) {
    const events = [];
    const lines = icalData.split('\n').map(line => line.trim());
    
    let currentEvent = null;
    
    for (let line of lines) {
        if (line === 'BEGIN:VEVENT') {
            currentEvent = {};
        } else if (line === 'END:VEVENT' && currentEvent) {
            if (currentEvent.dtstart && currentEvent.summary) {
                events.push(currentEvent);
            }
            currentEvent = null;
        } else if (currentEvent && line.includes(':')) {
            const colonIndex = line.indexOf(':');
            const key = line.substring(0, colonIndex).toLowerCase();
            const value = line.substring(colonIndex + 1);
            
            if (key.startsWith('dtstart')) {
                currentEvent.dtstart = parseICalDate(value);
            } else if (key.startsWith('dtend')) {
                currentEvent.dtend = parseICalDate(value);
            } else if (key === 'summary') {
                currentEvent.summary = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
            } else if (key === 'description') {
                currentEvent.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
            } else if (key === 'location') {
                currentEvent.location = value.replace(/\\n/g, '\n').replace(/\\,/g, ',');
            }
        }
    }
    
    return events;
}

// Parse iCal date format
function parseICalDate(dateString) {
    if (dateString.includes('T')) {
        // DateTime format: 20250803T143000Z
        const clean = dateString.replace('Z', '').replace(/[^\d]/g, '');
        if (clean.length >= 8) {
            const year = clean.substring(0, 4);
            const month = clean.substring(4, 6);
            const day = clean.substring(6, 8);
            const hour = clean.substring(8, 10) || '00';
            const minute = clean.substring(10, 12) || '00';
            const second = clean.substring(12, 14) || '00';
            
            return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${dateString.endsWith('Z') ? 'Z' : ''}`);
        }
    } else {
        // Date only format: 20250803
        const clean = dateString.replace(/[^\d]/g, '');
        if (clean.length >= 8) {
            const year = clean.substring(0, 4);
            const month = clean.substring(4, 6);
            const day = clean.substring(6, 8);
            return new Date(`${year}-${month}-${day}`);
        }
    }
    return new Date(dateString);
}

// Filter events for today only
function filterTodayEvents(events) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    
    return events
        .filter(event => {
            if (!event.dtstart) return false;
            const eventDate = new Date(event.dtstart.getFullYear(), event.dtstart.getMonth(), event.dtstart.getDate());
            return eventDate.getTime() === today.getTime() && event.dtstart >= now;
        })
        .sort((a, b) => a.dtstart - b.dtstart)
        .slice(0, 3); // Limit to 3 events for snippet
}

// Filter events for upcoming week
function filterUpcomingEvents(events) {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    return events
        .filter(event => {
            if (!event.dtstart) return false;
            return event.dtstart >= now && event.dtstart <= weekFromNow;
        })
        .sort((a, b) => a.dtstart - b.dtstart)
        .slice(0, 10); // Limit to 10 events
}

// Display today's events snippet
function displayTodaySnippet(events) {
    const container = document.getElementById('today-calendar-snippet');
    
    if (!container || events.length === 0) return;
    
    let html = '<div class="today-snippet-events">';
    
    events.forEach(event => {
        const startTime = event.dtstart;
        const endTime = event.dtend;
        
        const startTimeStr = startTime.toLocaleTimeString('en-SG', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        
        const endTimeStr = endTime ? endTime.toLocaleTimeString('en-SG', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        }) : '';
        
        const timeStr = endTime ? `${startTimeStr} - ${endTimeStr}` : startTimeStr;
        
        html += `
            <div class="today-snippet-event">
                <div class="today-snippet-time">${timeStr}</div>
                <div class="today-snippet-title">${escapeHtml(event.summary)}</div>
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
    container.classList.add('has-events');
    container.style.display = 'block';
}

// Load calendar events from server
async function loadCalendarEvents() {
    const container = document.getElementById('calendarEventsContainer');
    
    if (!container) return;
    
    // Get calendar URL from localStorage
    const calendarUrl = localStorage.getItem('calendarUrl');
    
    if (!calendarUrl) {
        container.innerHTML = '<div class="no-events">No calendar configured. Please add a calendar URL in Settings.</div>';
        return;
    }
    
    // Show loading state
    container.innerHTML = '<div class="calendar-loading">Loading calendar events...</div>';
    
    try {
        console.log('Attempting to fetch full calendar from:', calendarUrl);
        
        // Use server-side proxy to avoid CORS issues
        const proxyUrl = `/calendar-proxy?url=${encodeURIComponent(calendarUrl)}`;
        const response = await fetch(proxyUrl);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const icalData = await response.text();
        console.log('Full calendar iCal data received, length:', icalData.length);
        
        const events = parseICalData(icalData);
        console.log('Full calendar parsed events:', events.length);
        
        const upcomingEvents = filterUpcomingEvents(events);
        console.log('Full calendar upcoming events:', upcomingEvents.length);
        
        if (upcomingEvents.length > 0) {
            displayCalendarEvents(upcomingEvents);
        } else {
            container.innerHTML = '<div class="no-events">No upcoming events in the next 7 days</div>';
        }
    } catch (error) {
        console.error('Error loading calendar:', error);
        
        // Show specific error message for CORS issues
        if (error.message.includes('CORS') || error.message.includes('fetch')) {
            showCalendarError('Google Calendar blocks direct browser access due to CORS policy. This is a browser security limitation.');
        } else {
            showCalendarError('Unable to load calendar. Please check your calendar secret URL in Settings.');
        }
    }
}

// Display calendar events in the UI
function displayCalendarEvents(events) {
    const container = document.getElementById('calendarEventsContainer');
    
    if (!container) return;
    
    if (!events || events.length === 0) {
        container.innerHTML = '<div class="no-events">No upcoming events in the next 7 days</div>';
        return;
    }
    
    let html = '<div class="events-list">';
    
    events.forEach(event => {
        const startTime = event.dtstart;
        const endTime = event.dtend;
        
        html += `
            <div class="event-item">
                <div class="event-time">${formatEventTime(startTime, endTime)}</div>
                <div class="event-summary">${escapeHtml(event.summary)}</div>
                ${event.description ? `<div class="event-description">${escapeHtml(event.description)}</div>` : ''}
                ${event.location ? `<div class="event-location">📍 ${escapeHtml(event.location)}</div>` : ''}
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Show calendar error message
function showCalendarError(message) {
    const container = document.getElementById('calendarEventsContainer');
    if (container) {
        container.innerHTML = `<div class="calendar-error">${escapeHtml(message)}</div>`;
    }
}

// Format event time for display
function formatEventTime(startTime, endTime) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const eventDate = new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate());
    
    let dateStr = '';
    if (eventDate.getTime() === today.getTime()) {
        dateStr = 'Today';
    } else if (eventDate.getTime() === tomorrow.getTime()) {
        dateStr = 'Tomorrow';
    } else {
        dateStr = startTime.toLocaleDateString('en-SG', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });
    }
    
    const timeStr = startTime.toLocaleTimeString('en-SG', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
    });
    
    if (endTime) {
        const endTimeStr = endTime.toLocaleTimeString('en-SG', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        });
        return `${dateStr} ${timeStr} - ${endTimeStr}`;
    } else {
        return `${dateStr} ${timeStr}`;
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
