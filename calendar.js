const { requestText } = require('./http-client');

function normalizeCalendarUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a valid Google Calendar iCal address.');
    let url;
    try { url = new URL(value.trim()); } catch { throw new Error('Enter a valid Google Calendar iCal address.'); }
    if (url.protocol !== 'https:' || url.hostname !== 'calendar.google.com' || url.username || url.password ||
        url.port || url.search || url.hash ||
        !/^\/calendar\/ical\/[^/]+\/(?:private-[a-zA-Z0-9_-]+|public)\/(?:basic|full)\.ics$/.test(url.pathname)) {
        throw new Error('Use the HTTPS iCal address supplied by Google Calendar.');
    }
    return url.href;
}

async function fetchCalendar(value, fetchImpl) {
    const text = await requestText(normalizeCalendarUrl(value), {
        fetchImpl, headers: { Accept: 'text/calendar' }, maxBytes: 1024 * 1024
    });
    if (!/^BEGIN:VCALENDAR\r?$/m.test(text) || !/^END:VCALENDAR\r?$/m.test(text)) {
        throw new Error('Upstream did not return a calendar.');
    }
    return text;
}

module.exports = { normalizeCalendarUrl, fetchCalendar };
