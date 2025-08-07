// Settings page JavaScript with single search bar and selection basket
let allBusStops = [];
let selectedBusStops = new Set(); // Store selected bus stop codes to prevent duplicates
let originalSelections = new Set(); // Store original selections to track changes
let originalCalendarUrl = ''; // Store original calendar URL to track changes
let hasChanges = false;
let fullCalendarUrl = ''; // Global scope for calendar URL

document.addEventListener("DOMContentLoaded", async () => {
    const searchInput = document.getElementById('busStopSearch');
    const dropdown = document.getElementById('searchDropdown');
    const basket = document.getElementById('selectedBasket');
    const saveButton = document.getElementById('saveChanges');
    const saveStatus = document.getElementById('saveStatus');
    const calendarUrl = document.getElementById('calendarUrl');
    const toggleCalendarUrl = document.getElementById('toggleCalendarUrl');
    const copyCalendarUrl = document.getElementById('copyCalendarUrl');
    
    // Load bus stops data
    await loadBusStops();
    
    // Load existing selections if any
    await loadExistingSelections();
    
    // Load existing calendar URL
    loadCalendarUrl();
    
    // Setup search functionality
    setupSearchInput(searchInput, dropdown, basket);
    
    // Setup calendar URL change detection and character limiting
    calendarUrl.addEventListener('input', (e) => {
        if (calendarUrl.type === 'password') {
            // Store the full URL
            fullCalendarUrl = e.target.value;
            
            // Limit display to exactly 12 dots maximum
            if (fullCalendarUrl.length > 0) {
                if (fullCalendarUrl.length <= 12) {
                    e.target.value = '•'.repeat(fullCalendarUrl.length);
                } else {
                    e.target.value = '•'.repeat(12);
                }
            }
        } else {
            fullCalendarUrl = e.target.value;
        }
        checkForChanges();
    });
    
    // Function to get the actual calendar URL value
    function getCalendarUrlValue() {
        return calendarUrl.type === 'password' ? fullCalendarUrl : calendarUrl.value;
    }
    
    // Setup toggle functionality
    toggleCalendarUrl.addEventListener('click', () => {
        if (calendarUrl.type === 'password') {
            // Show the URL
            calendarUrl.type = 'text';
            calendarUrl.value = fullCalendarUrl; // Show full URL
            toggleCalendarUrl.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M22 12l-2-2-2 2 2 2 2-2z"/>
                </svg>`;
        } else {
            // Hide the URL
            calendarUrl.type = 'password';
            fullCalendarUrl = calendarUrl.value; // Update stored value
            // Apply character limiting for display
            if (fullCalendarUrl.length > 0) {
                if (fullCalendarUrl.length <= 12) {
                    calendarUrl.value = '•'.repeat(fullCalendarUrl.length);
                } else {
                    calendarUrl.value = '•'.repeat(12);
                }
            }
            toggleCalendarUrl.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>`;
        }
    });
    
    // Setup copy functionality
    copyCalendarUrl.addEventListener('click', async () => {
        try {
            const url = getCalendarUrlValue().trim();
            if (!url) {
                showCopyFeedback(copyCalendarUrl, 'No URL to copy', false);
                return;
            }
            
            await navigator.clipboard.writeText(url);
            showCopyFeedback(copyCalendarUrl, 'Copied!', true);
        } catch (err) {
            console.error('Failed to copy: ', err);
            showCopyFeedback(copyCalendarUrl, 'Copy failed', false);
        }
    });
    
    // Setup save functionality
    saveButton.addEventListener('click', async () => {
        await saveSelections(saveStatus);
    });
});

// Function to show copy feedback
function showCopyFeedback(button, message, success) {
    const originalColor = button.style.color;
    const originalTitle = button.title;
    
    button.style.color = success ? '#4ade80' : '#ff6b6b';
    button.title = message;
    
    setTimeout(() => {
        button.style.color = originalColor;
        button.title = originalTitle;
    }, 1500);
}

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
                console.log(`Loaded ${selections.length} existing selections from localStorage`);
                return;
            }
        }

        // If no localStorage data, try to fetch from backend
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
                console.log(`Loaded ${selections.length} existing selections from backend`);
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
                console.log('Option click:', option.dataset.code, option.dataset.description);
                selectOption(input, dropdown, option, basket);
            });
            
            dropdown.appendChild(option);
        });
    }
    
    dropdown.style.display = 'block';
}

function updateSelection(options, selectedIndex) {
    options.forEach((option, index) => {
        if (index === selectedIndex) {
            option.classList.add('selected');
            option.scrollIntoView({ block: 'nearest' });
        } else {
            option.classList.remove('selected');
        }
    });
}

function selectOption(input, dropdown, option, basket) {
    const code = option.dataset.code;
    const description = option.dataset.description;
    
    console.log('Selecting option:', { code, description });
    
    if (!code || !description) {
        console.error('Invalid option data:', option.dataset);
        return;
    }
    
    addToBasket(code, description);
    input.value = '';
    hideDropdown(dropdown);
}

function hideDropdown(dropdown) {
    dropdown.style.display = 'none';
}

function addToBasket(code, description, triggerChangeDetection = true) {
    // Check if already selected
    if (selectedBusStops.has(code)) {
        console.log(`Bus stop ${code} already selected`);
        return;
    }
    
    selectedBusStops.add(code);
    console.log(`Added bus stop ${code} to selections`);
    
    const basket = document.getElementById('selectedBasket');
    
    // Remove empty message if it exists
    const emptyMessage = basket.querySelector('.basket-empty');
    if (emptyMessage) {
        emptyMessage.remove();
    }
    
    const item = document.createElement('div');
    item.className = 'selected-item';
    item.dataset.code = code;
    
    item.innerHTML = `
        <span class="selected-item-text">
            <strong>${code}</strong><br>
            <small>${description}</small>
        </span>
        <button class="remove-item" onclick="removeFromBasket('${code}')">×</button>
    `;
    
    basket.appendChild(item);
    
    if (triggerChangeDetection) {
        checkForChanges();
    }
}

function removeFromBasket(code) {
    selectedBusStops.delete(code);
    console.log(`Removed bus stop ${code} from selections`);
    
    const basket = document.getElementById('selectedBasket');
    const item = basket.querySelector(`[data-code="${code}"]`);
    if (item) {
        basket.removeChild(item);
    }
    
    // Show empty message if no items left
    if (selectedBusStops.size === 0 && !basket.querySelector('.basket-empty')) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'basket-empty';
        emptyMessage.textContent = 'No bus stops selected. Search and click on a bus stop to add it here.';
        basket.appendChild(emptyMessage);
    }
    
    checkForChanges();
}

function loadCalendarUrl() {
    const savedUrl = localStorage.getItem('calendarUrl');
    const calendarInput = document.getElementById('calendarUrl');
    if (savedUrl && calendarInput) {
        fullCalendarUrl = savedUrl; // Set the global variable
        calendarInput.value = savedUrl;
        originalCalendarUrl = savedUrl;
        
        // If it's in password mode, mask it
        if (calendarInput.type === 'password' && savedUrl.length > 0) {
            if (savedUrl.length <= 12) {
                calendarInput.value = '•'.repeat(savedUrl.length);
            } else {
                calendarInput.value = '•'.repeat(12);
            }
        }
    }
}

// Check for any changes (bus stops or calendar URL)
function checkForChanges() {
    const calendarInput = document.getElementById('calendarUrl');
    const currentCalendarUrl = calendarInput ? (calendarInput.type === 'password' ? fullCalendarUrl : calendarInput.value.trim()) : '';
    
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
            const calendarUrl = calendarInput.type === 'password' ? fullCalendarUrl : calendarInput.value.trim();
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
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(selectionsArray)
            });
            
            if (response.ok) {
                console.log('Selections saved to backend successfully');
            } else {
                console.warn('Failed to save to backend, but localStorage save succeeded');
            }
        } catch (backendError) {
            console.warn('Backend save failed, but localStorage save succeeded:', backendError);
        }
        
        // Update original selections to match current
        originalSelections.clear();
        selectedBusStops.forEach(code => originalSelections.add(code));
        
        // Update original calendar URL
        originalCalendarUrl = calendarInput.type === 'password' ? fullCalendarUrl : calendarInput.value.trim();
        
        // Show success message
        saveStatus.textContent = 'Settings saved successfully!';
        saveStatus.className = 'save-status success';
        saveStatus.style.display = 'block';
        
        // Reset button
        saveButton.textContent = 'Save Changes';
        hasChanges = false;
        checkForChanges(); // This will disable the button since no changes
        
        // Hide success message after 3 seconds
        setTimeout(() => {
            saveStatus.style.display = 'none';
        }, 3000);
        
    } catch (error) {
        console.error('Save error:', error);
        
        // Show error message
        saveStatus.textContent = 'Failed to save settings. Please try again.';
        saveStatus.className = 'save-status error';
        saveStatus.style.display = 'block';
        
        // Reset button
        saveButton.textContent = 'Save Changes';
        saveButton.disabled = false;
        
        // Hide error message after 5 seconds
        setTimeout(() => {
            saveStatus.style.display = 'none';
        }, 5000);
    }
}
