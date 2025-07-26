// Settings page JavaScript with single search bar and selection basket
let allBusStops = [];
let selectedBusStops = new Set(); // Store selected bus stop codes to prevent duplicates

document.addEventListener("DOMContentLoaded", async () => {
    const searchInput = document.getElementById('busStopSearch');
    const dropdown = document.getElementById('searchDropdown');
    const basket = document.getElementById('selectedBasket');
    const saveButton = document.getElementById('saveChanges');
    const saveStatus = document.getElementById('saveStatus');
    
    // Load bus stops data
    await loadBusStops();
    
    // Load existing selections if any
    await loadExistingSelections();
    
    // Setup search functionality
    setupSearchInput(searchInput, dropdown, basket);
    
    // Setup save functionality
    saveButton.addEventListener('click', async () => {
        await saveSelections(saveStatus);
    });
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

async function loadExistingSelections() {
    try {
        // First try to load from localStorage
        const localSelections = localStorage.getItem('busStopSelections');
        if (localSelections) {
            const selections = JSON.parse(localSelections);
            if (Array.isArray(selections) && selections.length > 0) {
                selections.forEach(selection => {
                    if (selection.code && selection.description) {
                        addToBasket(selection.code, selection.description);
                    }
                });
                console.log('Loaded selections from localStorage:', selections.length);
                return;
            }
        }
        
        // Fallback: try to load from backend (for migration purposes)
        const response = await fetch('/bus-stop-selections');
        if (response.ok) {
            const selections = await response.json();
            if (Array.isArray(selections) && selections.length > 0) {
                selections.forEach(selection => {
                    if (selection.code && selection.description) {
                        addToBasket(selection.code, selection.description);
                    }
                });
                // Migrate to localStorage
                localStorage.setItem('busStopSelections', JSON.stringify(selections));
                console.log('Migrated selections from backend to localStorage');
            }
        }
    } catch (error) {
        console.log('No existing selections found or error loading them');
    }
}

function setupSearchInput(input, dropdown, basket) {
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
        
        showDropdown(dropdown, filteredStops, input, basket);
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
                selectOption(input, dropdown, options[selectedIndex], basket);
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

function showDropdown(dropdown, filteredStops, input, basket) {
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
            
            // Show if already selected
            const isSelected = selectedBusStops.has(stop.BusStopCode);
            option.textContent = `${stop.BusStopCode} - ${stop.Description}${isSelected ? ' (already selected)' : ''}`;
            option.dataset.code = stop.BusStopCode;
            option.dataset.description = stop.Description;
            
            if (isSelected) {
                option.style.opacity = '0.6';
                option.style.fontStyle = 'italic';
            }
            
            option.addEventListener('click', () => {
                selectOption(input, dropdown, option, basket);
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

function selectOption(input, dropdown, option, basket) {
    const code = option.dataset.code;
    const description = option.dataset.description;
    
    // Check if already selected
    if (selectedBusStops.has(code)) {
        console.log(`Bus stop ${code} is already selected`);
        hideDropdown(dropdown);
        input.value = '';
        return;
    }
    
    // Add to basket
    addToBasket(code, description);
    
    // Clear input and hide dropdown
    input.value = '';
    hideDropdown(dropdown);
    
    console.log(`Added bus stop: ${code} - ${description}`);
}

function addToBasket(code, description) {
    const basket = document.getElementById('selectedBasket');
    
    // Remove empty message if it exists
    const emptyMessage = basket.querySelector('.basket-empty');
    if (emptyMessage) {
        emptyMessage.remove();
    }
    
    // Add to selected set
    selectedBusStops.add(code);
    
    // Create basket item
    const item = document.createElement('div');
    item.className = 'selected-item';
    item.dataset.code = code;
    
    const text = document.createElement('span');
    text.className = 'selected-item-text';
    text.textContent = `${code} - ${description}`;
    text.title = `${code} - ${description}`; // Tooltip for long names
    
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-item';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove this bus stop';
    removeBtn.addEventListener('click', () => {
        removeFromBasket(code, item);
    });
    
    item.appendChild(text);
    item.appendChild(removeBtn);
    basket.appendChild(item);
}

function removeFromBasket(code, itemElement) {
    const basket = document.getElementById('selectedBasket');
    
    // Remove from selected set
    selectedBusStops.delete(code);
    
    // Remove DOM element
    itemElement.remove();
    
    // Add empty message if no items left
    if (selectedBusStops.size === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'basket-empty';
        emptyMessage.textContent = 'No bus stops selected. Search and click on a bus stop to add it here.';
        basket.appendChild(emptyMessage);
    }
    
    console.log(`Removed bus stop: ${code}`);
}

// Debug function to clear localStorage (can be called from browser console)
window.clearBusStopSelections = function() {
    localStorage.removeItem('busStopSelections');
    console.log('Cleared bus stop selections from localStorage');
    location.reload();
};

async function saveSelections(saveStatus) {
    const saveButton = document.getElementById('saveChanges');
    
    try {
        // Disable button during save
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
        saveStatus.style.display = 'none';
        
        // Prepare data to save
        const selectionsArray = Array.from(selectedBusStops).map(code => {
            // Find the bus stop details
            const busStop = allBusStops.find(stop => stop.BusStopCode === code);
            return {
                code: code,
                description: busStop ? busStop.Description : `Stop ${code}`
            };
        });
        
        // Save to localStorage (primary storage)
        localStorage.setItem('busStopSelections', JSON.stringify(selectionsArray));
        
        // Also save to backend (as backup/fallback)
        try {
            const response = await fetch('/bus-stop-selections', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(selectionsArray)
            });
            
            if (!response.ok) {
                console.warn('Backend save failed, but localStorage save succeeded');
            }
        } catch (backendError) {
            console.warn('Backend unavailable, but localStorage save succeeded:', backendError);
        }
        
        saveStatus.textContent = 'Settings saved successfully!';
        saveStatus.style.color = '#4ade80';
        saveStatus.style.display = 'inline';
        console.log('Bus stop selections saved to localStorage:', selectionsArray.length);
        
        // Hide success message after 3 seconds
        setTimeout(() => {
            saveStatus.style.display = 'none';
        }, 3000);
        
    } catch (error) {
        console.error('Error saving settings:', error);
        saveStatus.textContent = 'Error saving settings. Please try again.';
        saveStatus.style.color = '#ff4444';
        saveStatus.style.display = 'inline';
    } finally {
        // Re-enable button
        saveButton.disabled = false;
        saveButton.textContent = 'Save Changes';
    }
}
