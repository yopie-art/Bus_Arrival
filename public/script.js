// Fetch and display bus stop descriptions
function fetchBusStopDescriptions() {
  const stopCodes = TABLES.map(t => t.stopCode).join(',');
  fetch(`/bus-stop-description?codes=${stopCodes}`)
    .then(res => res.json())
    .then(descs => {
      TABLES.forEach(t => {
        const desc = descs[t.stopCode] || t.stopCode;
        const h1 = document.getElementById(`desc-${t.stopCode}`);
        if (h1) h1.textContent = `Bus Arrival Times for ${desc}`;
      });
    })
    .catch(() => {
      // fallback: leave as is
    });
}


const TABLES = [
  {
    stopCode: "43479",
    prefix: "bus-43479-"
  },
  {
    stopCode: "43471",
    prefix: "bus-"
  }
];
const API_BASE = "https://bus-arrival.onrender.com/bus-arrival?BusStopCode=";

let busStopServices = {}; // Cache for bus services at each stop

function fetchBusTimes() {
  TABLES.forEach(table => {
    fetch(API_BASE + table.stopCode)
      .then(response => response.json())
      .then(data => {
        // Get all available bus services for this stop
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
        
        // Update the table structure if services changed
        if (!busStopServices[table.stopCode] || 
            JSON.stringify(busStopServices[table.stopCode]) !== JSON.stringify(serviceNumbers)) {
          busStopServices[table.stopCode] = serviceNumbers;
          updateTableStructure(table, serviceNumbers);
        }
        
        // Update arrival times for each service
        availableServices.forEach(service => {
          const busNo = service.ServiceNo;
          for (let i = 1; i <= 3; i++) {
            const elemId = `${table.prefix}${busNo}-${i}`;
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
      })
      .catch((err) => {
        console.error("Fetch error:", err);
        // Handle error for existing services only
        const existingServices = busStopServices[table.stopCode] || [];
        existingServices.forEach(busNo => {
          for (let i = 1; i <= 3; i++) {
            const elemId = `${table.prefix}${busNo}-${i}`;
            const elem = document.getElementById(elemId);
            if (elem && elem.getAttribute('data-key') !== "error") {
              elem.setAttribute('data-key', "error");
              elem.textContent = "Error";
            }
          }
        });
      });
  });
}

function updateTableStructure(table, serviceNumbers) {
  // Find the table body for this stop
  let tableBody;
  if (table.stopCode === "43479") {
    tableBody = document.querySelector('#bus-times-43479 tbody');
  } else {
    tableBody = document.querySelector('#bus-times tbody');
  }
  
  if (!tableBody) return;
  
  // Clear existing rows
  tableBody.innerHTML = '';
  
  // Create rows for each service
  serviceNumbers.forEach(busNo => {
    const row = document.createElement('tr');
    row.id = `row-${table.prefix.replace('bus-', '')}${busNo}`;
    
    row.innerHTML = `
      <td>${busNo}</td>
      <td class="arrival arrival-cell" id="${table.prefix}${busNo}-1">Loading...</td>
      <td class="arrival arrival-cell" id="${table.prefix}${busNo}-2">Loading...</td>
      <td class="arrival arrival-cell" id="${table.prefix}${busNo}-3">Loading...</td>
    `;
    
    tableBody.appendChild(row);
  });
}

function getMinutesToArrival(estimatedArrival) {
    const arrival = new Date(estimatedArrival);
    const now = new Date();
    const diffMs = arrival - now;
    return Math.max(0, Math.round(diffMs / 60000));
}

document.addEventListener("DOMContentLoaded", () => {
    fetchBusStopDescriptions();
    fetchBusTimes();
    setInterval(fetchBusTimes, 10000); // Refresh every 10 seconds
    
    // Setup settings button proximity effect
    setupSettingsProximity();
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
