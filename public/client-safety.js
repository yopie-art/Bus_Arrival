(function (root) {
    function sanitizeBusStops(value) {
        if (!Array.isArray(value)) return [];
        const seen = new Set();
        return value.filter(stop => {
            if (!stop || typeof stop.code !== 'string' || !/^\d{5}$/.test(stop.code) || seen.has(stop.code)) return false;
            seen.add(stop.code);
            return true;
        }).slice(0, 20).map(stop => ({
            code: stop.code,
            description: typeof stop.description === 'string' ? stop.description.slice(0, 200) : `Stop ${stop.code}`
        }));
    }
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }
    const api = { sanitizeBusStops, escapeHtml };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ClientSafety = api;
})(typeof globalThis === 'object' ? globalThis : this);
