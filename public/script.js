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
    buses: ["188", "985", "187", "947"],
    prefix: "bus-43479-"
  },
  {
    stopCode: "43471",
    buses: ["947", "985", "187", "868E"],
    prefix: "bus-"
  }
];
const API_BASE = "https://bus-arrival.onrender.com/bus-arrival?BusStopCode=";


function fetchBusTimes() {
  TABLES.forEach(table => {
    fetch(API_BASE + table.stopCode)
      .then(response => response.json())
      .then(data => {
        table.buses.forEach(busNo => {
          const bus = data.Services.find(s => s.ServiceNo === busNo);
          for (let i = 1; i <= 3; i++) {
            const elemId = `${table.prefix}${busNo}-${i}`;
            const arrivalElem = document.getElementById(elemId);
            let nextBus = null;
            if (bus) {
              if (i === 1) nextBus = bus.NextBus;
              if (i === 2) nextBus = bus.NextBus2;
              if (i === 3) nextBus = bus.NextBus3;
            }
            
            let newContent;
            let dataKey; // Key to compare actual data changes
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
              }, 500); // Half of the 1-second transition
            }
          }
        });
      })
      .catch((err) => {
        console.error("Fetch error:", err);
        table.buses.forEach(busNo => {
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
});
