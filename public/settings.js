// Settings page JavaScript with searchable dropdowns
let allBusStops = [];

document.addEventListener("DOMContentLoaded", async () => {
    const busStop1Input = document.getElementById('busStop1');
    const busStop2Input = document.getElementById('busStop2');
    const dropdown1 = document.getElementById('dropdown1');
    const dropdown2 = document.getElementById('dropdown2');
    
    // Load bus stops data
    await loadBusStops();
    
    // Setup search functionality for both inputs
    setupSearchInput(busStop1Input, dropdown1);
    setupSearchInput(busStop2Input, dropdown2);
});

async function loadBusStops() {
    try {
        // Fetch all bus stops from the backend
        const response = await fetch('/bus-stop-description?codes=all');
        
        if (response.ok) {
            const data = await response.json();
            // Convert the response to an array format
            allBusStops = Object.entries(data).map(([code, description]) => ({
                BusStopCode: code,
                Description: description || `Stop ${code}`,
                searchText: `${code} ${description || ''}`.toLowerCase()
            }));
        } else {
            // Fallback: try to get bus stops directly
            const fallbackResponse = await fetch('/bus-stops-all');
            if (fallbackResponse.ok) {
                const busStopsData = await fallbackResponse.json();
                allBusStops = busStopsData.map(stop => ({
                    BusStopCode: stop.BusStopCode,
                    Description: stop.Description || `Stop ${stop.BusStopCode}`,
                    searchText: `${stop.BusStopCode} ${stop.Description || ''}`.toLowerCase()
                }));
            } else {
                throw new Error('Could not fetch bus stops');
            }
        }
        
        // Sort bus stops by code
        allBusStops.sort((a, b) => a.BusStopCode.localeCompare(b.BusStopCode));
        console.log(`Loaded ${allBusStops.length} bus stops`);
        
    } catch (error) {
        console.error('Error loading bus stops:', error);
        allBusStops = [];
    }
}

function setupSearchInput(input, dropdown) {
    let selectedIndex = -1;
    
    input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        selectedIndex = -1;
        
        if (query.length === 0) {
            hideDropdown(dropdown);
            return;
        }
        
        // Split query into individual search terms
        const searchTerms = query.split(/\s+/).filter(term => term.length > 0);
        
        // Filter bus stops based on search query - all terms must match
        const filteredStops = allBusStops.filter(stop => {
            const searchText = stop.searchText;
            // Check if all search terms are found in the bus stop text
            return searchTerms.every(term => searchText.includes(term));
        }).slice(0, 10); // Limit to 10 results for performance
        
        showDropdown(dropdown, filteredStops, input);
    });
    
    input.addEventListener('keydown', (e) => {
        const options = dropdown.querySelectorAll('.search-option');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, options.length - 1);
            updateSelection(options, selectedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelection(options, selectedIndex);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && options[selectedIndex]) {
                selectOption(input, dropdown, options[selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            hideDropdown(dropdown);
        }
    });
    
    input.addEventListener('blur', () => {
        // Delay hiding to allow click events on dropdown
        setTimeout(() => hideDropdown(dropdown), 200);
    });
}

function showDropdown(dropdown, filteredStops, input) {
    dropdown.innerHTML = '';
    
    if (filteredStops.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'no-results';
        noResults.textContent = 'No bus stops found';
        dropdown.appendChild(noResults);
    } else {
        filteredStops.forEach(stop => {
            const option = document.createElement('div');
            option.className = 'search-option';
            option.textContent = `${stop.BusStopCode} - ${stop.Description}`;
            option.dataset.code = stop.BusStopCode;
            option.dataset.description = stop.Description;
            
            option.addEventListener('click', () => {
                selectOption(input, dropdown, option);
            });
            
            dropdown.appendChild(option);
        });
    }
    
    dropdown.style.display = 'block';
}

function hideDropdown(dropdown) {
    dropdown.style.display = 'none';
}

function updateSelection(options, selectedIndex) {
    options.forEach((option, index) => {
        option.classList.toggle('selected', index === selectedIndex);
    });
}

function selectOption(input, dropdown, option) {
    const code = option.dataset.code;
    const description = option.dataset.description;
    
    input.value = `${code} - ${description}`;
    input.dataset.selectedCode = code;
    
    hideDropdown(dropdown);
    
    console.log(`Selected bus stop: ${code} - ${description}`);
}
