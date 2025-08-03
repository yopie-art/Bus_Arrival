// Settings page JavaScript with single search bar and selection basket
let allBusStops = [];
let selectedBusStops = new Set(); // Store selected bus stop codes to prevent duplicates
let originalSelections = new Set(); // Store original selections to track changes
let originalCalendarUrl = ''; // Store original calendar URL to track changes
let hasChanges = false;

document.addEventListener("DOMContentLoaded", async () => {
    const searchInput = document.getElementById('busStopSearch');
    const dropdown = document.getElementById('searchDropdown');
    const basket = document.getElementById('selectedBasket');
    const saveButton = document.getElementById('saveChanges');
    const saveStatus = document.getElementById('saveStatus');
    const calendarUrl = document.getElementById('calendarUrl');
    const toggleCalendarUrl = document.getElementById('toggleCalendarUrl');
    
    // Load bus stops data
    await loadBusStops();
    
    // Load existing selections if any
    await loadExistingSelections();
    
    // Load existing calendar URL
    loadCalendarUrl();
    
    // Setup search functionality
    setupSearchInput(searchInput, dropdown, basket);
    
    // Setup calendar URL change detection
    calendarUrl.addEventListener('input', checkForChanges);
    
    // Setup calendar URL toggle functionality
    toggleCalendarUrl.addEventListener('click', () => {
        if (calendarUrl.type === 'password') {
            calendarUrl.type = 'text';
            // Change to "eye-off" icon when showing
            toggleCalendarUrl.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                </svg>
            `;
            toggleCalendarUrl.style.color = '#60a5fa';
        } else {
            calendarUrl.type = 'password';
            // Change back to "eye" icon when hiding
            toggleCalendarUrl.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                </svg>
            `;
            toggleCalendarUrl.style.color = '#888';
        }
    });
    
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
                        addToBasket(selection.code, selection.description, false); // Don't trigger change detection
                        originalSelections.add(selection.code); // Track original selections
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
                        addToBasket(selection.code, selection.description, false); // Don't trigger change detection
                        originalSelections.add(selection.code); // Track original selections
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
    let isSelecting = false; // Flag to prevent blur interference
    
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
        
        showDropdown(dropdown, filteredStops, input, basket, () => { isSelecting = true; });
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
                isSelecting = true;
                selectOption(input, dropdown, options[selectedIndex], basket);
                isSelecting = false;
            }
        } else if (e.key === 'Escape') {
            hideDropdown(dropdown);
        }
    });
    
    input.addEventListener('blur', () => {
        // Only hide dropdown if we're not in the middle of selecting
        if (!isSelecting) {
            setTimeout(() => {
                if (!isSelecting) {
                    hideDropdown(dropdown);
                }
            }, 300);
        }
    });
}

function showDropdown(dropdown, filteredStops, input, basket, setSelectingCallback) {
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
            
            console.log('Created option:', { code: option.dataset.code, description: option.dataset.description, stopCode: stop.BusStopCode, stopDesc: stop.Description });
            
            if (isSelected) {
                option.style.opacity = '0.6';
                option.style.fontStyle = 'italic';
            }
            
            option.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent blur from happening
                if (setSelectingCallback) setSelectingCallback();
                console.log('Option mousedown:', option.dataset.code, option.dataset.description);
                selectOption(input, dropdown, option, basket);
            });
            
            option.addEventListener('click', (e) => {
                e.preventDefault(); // Prevent any default behavior
                if (setSelectingCallback) setSelectingCallback();
                console.log('Option clicked:', option.dataset.code, option.dataset.description);
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
    
    console.log('selectOption called with:', { code, description, option, hasCode: !!code, hasDescription: !!description });
    
    if (!code || !description) {
        console.error('Missing code or description:', { code, description });
        return;
    }
    
    // Check if already selected
    if (selectedBusStops.has(code)) {
        console.log(`Bus stop ${code} is already selected`);
        hideDropdown(dropdown);
        input.value = '';
        return;
    }
    
    // Add to basket
    addToBasket(code, description, true); // Enable change detection
    
    // Clear input and hide dropdown
    input.value = '';
    hideDropdown(dropdown);
    
    console.log(`Added bus stop: ${code} - ${description}`);
    
    // Re-focus the input for continued searching
    setTimeout(() => input.focus(), 50);
}

function addToBasket(code, description, detectChanges = true) {
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
    
    // Check for changes if enabled
    if (detectChanges) {
        checkForChanges();
    }
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
    
    // Check for changes
    checkForChanges();
}

// Debug function to clear localStorage (can be called from browser console)
window.clearBusStopSelections = function() {
    localStorage.removeItem('busStopSelections');
    console.log('Cleared bus stop selections from localStorage');
    location.reload();
};

// Load calendar URL from localStorage
function loadCalendarUrl() {
    const savedUrl = localStorage.getItem('calendarUrl');
    const calendarInput = document.getElementById('calendarUrl');
    if (savedUrl && calendarInput) {
        calendarInput.value = savedUrl;
        originalCalendarUrl = savedUrl;
    }
}

// Check for any changes (bus stops or calendar URL)
function checkForChanges() {
    const calendarInput = document.getElementById('calendarUrl');
    const currentCalendarUrl = calendarInput ? calendarInput.value.trim() : '';
    
    // Check if bus stop selections have changed
    const busStopsChanged = selectedBusStops.size !== originalSelections.size || 
                           ![...selectedBusStops].every(code => originalSelections.has(code));
    
    // Check if calendar URL has changed
    const calendarChanged = currentCalendarUrl !== originalCalendarUrl;
    
    hasChanges = busStopsChanged || calendarChanged;
    
    const saveButton = document.getElementById('saveChanges');
    if (saveButton) {
        saveButton.disabled = !hasChanges;
    }
}

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
        
        // Save calendar URL to localStorage
        const calendarInput = document.getElementById('calendarUrl');
        if (calendarInput) {
            const calendarUrl = calendarInput.value.trim();
            if (calendarUrl) {
                localStorage.setItem('calendarUrl', calendarUrl);
            } else {
                localStorage.removeItem('calendarUrl');
            }
        }
        
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
        
        // Update original selections to reflect saved state
        originalSelections = new Set(selectedBusStops);
        checkForChanges(); // Update button state
        
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
        saveButton.disabled = !hasChanges; // Only enable if there are changes
        saveButton.textContent = hasChanges ? 'Apply Changes' : 'No Changes';
    }
}
