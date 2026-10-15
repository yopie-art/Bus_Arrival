/* Shared validation and time helpers; usable in the browser and Node. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Aqicn = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const TIME_ZONE = 'Asia/Singapore';
    const MAX_AGE_MS = 72 * 60 * 60 * 1000;

    function normalizeUrl(value) {
        if (typeof value !== 'string' || value.length > 300) throw new Error('Enter an AQICN forecast or station URL.');
        let url;
        try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete https://aqicn.org/forecast/.../ or https://aqicn.org/city/.../ URL.'); }
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        const forecastPath = /^\/forecast\/[a-z0-9_-]+\/(?:[a-z]{2}\/)?$/i.test(url.pathname);
        const stationPath = /^\/city\/(?:[a-z0-9_-]+\/){1,6}$/i.test(url.pathname);
        if (url.protocol !== 'https:' || url.hostname !== 'aqicn.org' || url.port || url.username || url.password ||
            (!forecastPath && !stationPath)) {
            throw new Error('Use an https://aqicn.org/forecast/.../ or https://aqicn.org/city/.../ URL.');
        }
        url.search = '';
        url.hash = '';
        return url.href;
    }

    function dayKey(value = Date.now()) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(new Date(value));
        const get = type => parts.find(part => part.type === type).value;
        return `${get('year')}-${get('month')}-${get('day')}`;
    }

    function hourOf(value) {
        return Number(new Intl.DateTimeFormat('en-GB', {
            timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23'
        }).format(new Date(value)));
    }

    function todaySlots(series, now = Date.now()) {
        const slots = Array(24).fill(null);
        if (!series || !Array.isArray(series.points)) return slots;
        const updated = Date.parse(series.updatedAt);
        // An old model run must not masquerade as a fresh forecast.
        if (!Number.isFinite(updated) || now - updated > MAX_AGE_MS || updated - now > 60 * 60 * 1000) return slots;
        const day = dayKey(now);
        for (const point of series.points) {
            if (Number.isFinite(Date.parse(point.time)) && Number.isFinite(point.value) && dayKey(point.time) === day) {
                slots[hourOf(point.time)] = point.value;
            }
        }
        return slots;
    }

    function aqiColor(value) {
        if (value <= 50) return '#009966';
        if (value <= 100) return '#ffde33';
        if (value <= 150) return '#ff9933';
        if (value <= 200) return '#cc0033';
        if (value <= 300) return '#660099';
        return '#7e0023';
    }

    return { normalizeUrl, dayKey, hourOf, todaySlots, aqiColor, TIME_ZONE };
}));
