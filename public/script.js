// Main page JavaScript for unified bus arrival display
let selectedBusStops = [];
let busStopServices = {}; // Cache for bus services at each stop

// Load selected bus stops from settings
async function loadSelectedBusStops() {
    try {
        const response = await fetch('/bus-stop-selections');
        if (response.ok) {
            selectedBusStops = await response.json();
            console.log('Loaded selected bus stops:', selectedBusStops);
        } else {
            selectedBusStops = [];
        }
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
        fetchBusTimes();
        setInterval(fetchBusTimes, 60000); // Update every minute
    }
    
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
