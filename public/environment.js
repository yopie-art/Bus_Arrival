/* Three views share the existing header footprint. Data requests never block rotation. */
(function () {
    const VIEW_MS = 30000;
    const REFRESH_MS = 30 * 60 * 1000;
    const RETRY_MS = 5 * 60 * 1000;
    let started = false;
    let data = null;
    let source = '';
    let generation = 0;
    let controller = null;
    let lastAttempt = 0;
    let lastSuccess = 0;
    let currentDay = '';
    let available = ['headerWeather'];
    let active = 'headerWeather';
    let nextViewAt = 0;
    let nextFetchAt = 0;
    let lastAgeCheck = 0;

    function readUrl() {
        try { return localStorage.getItem('aqicnForecastUrl') || ''; }
        catch { return ''; }
    }

    function show(id) {
        for (const view of document.querySelectorAll('#headerEnvironment .environment-view')) {
            const selected = view.id === id;
            view.classList.toggle('is-active', selected);
            view.setAttribute('aria-hidden', String(!selected));
            view.inert = !selected;
        }
        active = id;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function svgElement(tag, attrs) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
        return node;
    }

    function chart(slots, temperature) {
        const svg = svgElement('svg', { viewBox: '0 0 300 60', role: 'img' });
        const label = slots.map((value, hour) => `${String(hour).padStart(2, '0')}:00 ${value === null ? 'unavailable' : value + (temperature ? ' degrees Celsius' : ' AQI')}`).join(', ');
        svg.setAttribute('aria-label', label);
        const values = slots.filter(value => value !== null);
        // Temperature bars use a labelled, truncated scale, as on AQICN's compact charts.
        const low = Math.floor(Math.min(...values)) - 1;
        const high = Math.ceil(Math.max(...values)) + 1;
        for (let hour = 0; hour < 24; hour++) {
            const value = slots[hour];
            const height = temperature && value !== null ? 5 + (value - low) / (high - low) * 32 : 38;
            const rect = svgElement('rect', {
                x: hour * 12.5 + 0.5, y: temperature ? 41 - height : 3,
                width: 11.5, height, rx: temperature ? 1 : 0,
                fill: value === null ? '#444' : temperature ? '#f59e0b' : Aqicn.aqiColor(value)
            });
            const title = svgElement('title', {});
            title.textContent = `${String(hour).padStart(2, '0')}:00 SGT: ${value === null ? 'No forecast' : value + (temperature ? ' °C' : ' AQI')}`;
            rect.appendChild(title);
            svg.appendChild(rect);
            if (hour % 6 === 0 || hour === 23) {
                const text = svgElement('text', { x: hour * 12.5 + 6.25, y: 55, 'text-anchor': 'middle', fill: '#bcbcbc', 'font-size': 9 });
                text.textContent = String(hour).padStart(2, '0');
                svg.appendChild(text);
            }
        }
        return svg;
    }

    function renderPanel(id, slots, series, temperature) {
        const panel = document.getElementById(id);
        panel.replaceChildren();
        const values = slots.filter(value => value !== null);
        if (!values.length) return false;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const header = element('div', 'forecast-heading');
        header.append(element('span', '', temperature ? 'Temperature · Today' : 'PM2.5 AQI · Today'));
        header.append(element('span', 'forecast-range', `${Math.round(min)}–${Math.round(max)}${temperature ? ' °C' : ''}`));
        panel.append(header, chart(slots, temperature));
        const footer = element('div', 'forecast-footer');
        const link = element('a', '', 'AQICN / WAQI');
        link.href = data.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = data.location;
        footer.append(link);
        const time = new Intl.DateTimeFormat('en-GB', { timeZone: Aqicn.TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(series.updatedAt));
        const date = Aqicn.dayKey(series.updatedAt).slice(5);
        const partial = values.length < 24 ? ` · ${values.length}/24h` : '';
        const status = lastAttempt > lastSuccess ? ' · retrying' : '';
        footer.append(element('span', '', `${date} ${time} SGT${partial}${status}`));
        panel.title = `${data.location}. Source updated ${series.updatedAt}. ${temperature ? 'Temperature bar scale: ' + (Math.floor(min) - 1) + ' to ' + (Math.ceil(max) + 1) + ' °C.' : 'US EPA AQI colours.'} Grey means no data.`;
        panel.appendChild(footer);
        return true;
    }

    function render() {
        const now = Date.now();
        lastAgeCheck = now;
        currentDay = Aqicn.dayKey(now);
        available = ['headerWeather'];
        if (data) {
            if (renderPanel('pm25Forecast', Aqicn.todaySlots(data.pm25, now), data.pm25, false)) available.push('pm25Forecast');
            if (renderPanel('temperatureForecast', Aqicn.todaySlots(data.temperature, now), data.temperature, true)) available.push('temperatureForecast');
        }
        if (!available.includes(active)) show('headerWeather');
    }

    async function refresh() {
        const requestGeneration = ++generation;
        if (controller) controller.abort();
        controller = null;
        const rawUrl = readUrl();
        if (rawUrl !== source) {
            source = rawUrl;
            data = null;
            show('headerWeather');
            render();
        }
        if (!source) return;
        lastAttempt = Date.now();
        const requestController = new AbortController();
        controller = requestController;
        const timeout = setTimeout(() => requestController.abort(), 12000);
        try {
            const url = Aqicn.normalizeUrl(source);
            const response = await fetch(`/aqicn-forecast?url=${encodeURIComponent(url)}`, { signal: requestController.signal, cache: 'no-store' });
            if (!response.ok) throw new Error('AQICN forecast unavailable');
            const next = await response.json();
            if (requestGeneration !== generation) return;
            // Do not trust source links or malformed responses received from the proxy.
            if (Aqicn.normalizeUrl(next.sourceUrl) !== url || (!next.pm25 && !next.temperature)) throw new Error('Invalid forecast response');
            const now = Date.now();
            if (![next.pm25, next.temperature].some(series => Aqicn.todaySlots(series, now).some(value => value !== null))) {
                throw new Error('No fresh forecast for today');
            }
            data = next;
            lastSuccess = Date.now();
            nextFetchAt = lastSuccess + REFRESH_MS;
        } catch (error) {
            if (requestGeneration !== generation) return;
            console.warn('Forecast views unavailable; continuing weather:', error.message);
            nextFetchAt = Date.now() + RETRY_MS;
            // Keep only usable, current-day data from a recent model run.
        } finally {
            clearTimeout(timeout);
            if (requestGeneration === generation) {
                controller = null;
                render();
            }
        }
    }

    function tick() {
        if (document.hidden) return;
        const now = Date.now();
        if (Aqicn.dayKey(now) !== currentDay) {
            render();
            nextFetchAt = 0;
        }
        // Re-evaluate model age so a TV left on cannot show stale data indefinitely.
        if (now - lastAgeCheck >= 60000) render();
        if (now >= nextViewAt) {
            show(available[(available.indexOf(active) + 1) % available.length]);
            nextViewAt = now + VIEW_MS;
        }
        if (source && !controller && now >= nextFetchAt) refresh();
    }

    function start() {
        if (started) return;
        started = true;
        nextViewAt = Date.now() + VIEW_MS;
        show('headerWeather');
        render();
        refresh();
        setInterval(tick, 1000);
        window.addEventListener('storage', event => {
            if (event.key === 'aqicnForecastUrl' || event.key === null) refresh();
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                show('headerWeather');
                nextViewAt = Date.now() + VIEW_MS;
                refresh();
            }
        });
        window.addEventListener('pageshow', event => {
            if (event.persisted) refresh();
        });
    }

    window.DashboardEnvironment = { start };
}());
