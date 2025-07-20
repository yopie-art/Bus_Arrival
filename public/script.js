
const BUS_STOP_CODE = "43471";
const BUS_NUMBERS = ["947", "985", "187", "868E"];
const API_URL = `https://bus-arrival.onrender.com/bus-arrival?BusStopCode=${BUS_STOP_CODE}`;

function fetchBusTimes() {
    // Set all cells to Loading...
    BUS_NUMBERS.forEach(busNo => {
        for (let i = 1; i <= 3; i++) {
            document.getElementById(`bus-${busNo}-${i}`).innerHTML = "Loading...";
        }
    });

    fetch(API_URL)
        .then(response => response.json())
        .then(data => {
            // Debug: log the data structure
            console.log("API response:", data);

            BUS_NUMBERS.forEach(busNo => {
                const bus = data.Services.find(s => s.ServiceNo === busNo);
                for (let i = 1; i <= 3; i++) {
                    const arrivalElem = document.getElementById(`bus-${busNo}-${i}`);
                    let nextBus = null;
                    if (bus) {
                        if (i === 1) nextBus = bus.NextBus;
                        if (i === 2) nextBus = bus.NextBus2;
                        if (i === 3) nextBus = bus.NextBus3;
                    }
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

                        arrivalElem.innerHTML = `<span class='arrival ${loadClass}'>${eta} min${ddIcon}</span>`;
                    } else {
                        arrivalElem.innerHTML = "No data";
                    }
                }
            });
        })
        .catch((err) => {
            console.error("Fetch error:", err);
            BUS_NUMBERS.forEach(busNo => {
                for (let i = 1; i <= 3; i++) {
                    document.getElementById(`bus-${busNo}-${i}`).textContent = "Error";
                }
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
    fetchBusTimes();
    setInterval(fetchBusTimes, 10000); // Refresh every 10 seconds
});
