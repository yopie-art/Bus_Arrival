const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { createApp } = require('../proxy');
const { normalizeCalendarUrl, fetchCalendar } = require('../calendar');
const { requestText } = require('../http-client');
const Safety = require('../public/client-safety');
const vm = require('node:vm');
const fs = require('node:fs');

const calendarUrl = 'https://calendar.google.com/calendar/ical/example%40gmail.com/private-test-secret/basic.ics';
const calendarText = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const reply = text => ({ ok: true, headers: new Headers(), text: async () => text });

async function serve(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return `http://127.0.0.1:${server.address().port}`;
}

test('calendar allowlist rejects host, scheme, credentials and path bypasses', () => {
    assert.equal(normalizeCalendarUrl(calendarUrl), calendarUrl);
    assert.equal(normalizeCalendarUrl(calendarUrl.replace('private-test-secret', 'public')), calendarUrl.replace('private-test-secret', 'public'));
    for (const url of [
        'http://calendar.google.com/calendar/ical/user/public/basic.ics',
        'https://evil.example/calendar.google.com/calendar/ical/user/public/basic.ics',
        calendarUrl.replace('calendar.google.com', 'calendar.google.com.evil.example'),
        calendarUrl.replace('calendar.google.com', 'user:password@calendar.google.com'),
        calendarUrl.replace('calendar.google.com', 'calendar.google.com:444'),
        calendarUrl + '?redirect=https://127.0.0.1', calendarUrl + '#fragment',
        'https://calendar.google.com/other/path', null, ['https://calendar.google.com/']
    ]) assert.throws(() => normalizeCalendarUrl(url));
});

test('outbound calendar fetch disables redirects and compression and bounds size', async () => {
    const result = await fetchCalendar(calendarUrl, async (url, options) => {
        assert.equal(url, calendarUrl);
        assert.equal(options.redirect, 'error');
        assert.equal(options.compress, false);
        assert.equal(options.headers['Accept-Encoding'], 'identity');
        assert.equal(options.size, 1024 * 1024);
        return reply(calendarText);
    });
    assert.equal(result, calendarText);
    await assert.rejects(fetchCalendar(calendarUrl, async () => reply('<html>not a calendar</html>')));
    await assert.rejects(requestText('https://example.com', { fetchImpl: async () => reply('oversized'), maxBytes: 2 }));
    await assert.rejects(fetchCalendar(calendarUrl, async () => ({ ...reply(calendarText), headers: new Headers({ 'content-encoding': 'br' }) })), /Compressed/);
});

test('real HTTP transport refuses redirects and cancels a slow response body', async t => {
    let redirected = false;
    const upstream = createServer((req, res) => {
        if (req.url === '/redirect') { res.writeHead(302, { Location: '/secret' }); res.end(); }
        else if (req.url === '/slow') { res.writeHead(200); res.write('partial'); }
        else { redirected = true; res.end('unexpected'); }
    });
    const base = await serve(t, upstream);
    await assert.rejects(requestText(base + '/redirect'), /redirect/i);
    assert.equal(redirected, false);
    await assert.rejects(requestText(base + '/slow', { timeoutMs: 50 }), /abort/i);
});

test('calendar POST is private, old GET does not fetch, upstream failures do not echo URLs', async t => {
    let calls = 0;
    let fail = false;
    const base = await serve(t, createApp({ busStops: [], fetchImpl: async () => {
        calls++;
        if (fail) throw new Error('failed at ' + calendarUrl);
        return reply(calendarText);
    } }));
    const post = url => fetch(base + '/calendar-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const old = await fetch(base + '/calendar-proxy?url=' + encodeURIComponent(calendarUrl));
    assert.equal(old.status, 410);
    assert.equal(calls, 0);
    assert.equal((await post('https://evil.example/calendar.google.com/calendar/ical/foo')).status, 400);
    assert.equal(calls, 0);
    const response = await post(calendarUrl);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /text\/calendar/);
    assert.equal(await response.text(), calendarText);
    fail = true;
    const failed = await post(calendarUrl);
    assert.equal(failed.status, 502);
    assert.doesNotMatch(await failed.text(), /test-secret|calendar\.google/);
});

test('request parser rejects compressed, oversized and malformed bodies before upstream access', async t => {
    let calls = 0;
    const base = await serve(t, createApp({ busStops: [], fetchImpl: async () => { calls++; return reply(calendarText); } }));
    for (const encoding of ['br', 'gzip', 'deflate']) {
        const response = await fetch(base + '/calendar-proxy', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding }, body: 'deliberately not compressed'
        });
        assert.equal(response.status, 415);
    }
    const huge = await fetch(base + '/calendar-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'x'.repeat(9000) }) });
    assert.equal(huge.status, 413);
    const invalid = await fetch(base + '/calendar-proxy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
    assert.equal(invalid.status, 400);
    assert.equal(calls, 0);
});

test('bus APIs validate stop codes and preserve arrivals, descriptions and majority region', async t => {
    const stops = [{ BusStopCode: '12345', Description: 'Test stop', Region: 'West' }];
    const base = await serve(t, createApp({ busStops: stops, ltaApiKey: 'test-only', fetchImpl: async (url, options) => {
        assert.equal(url, 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode=12345');
        assert.equal(options.headers.AccountKey, 'test-only');
        assert.equal(options.compress, false);
        return reply(JSON.stringify({ Services: [{ ServiceNo: '77A' }] }));
    } }));
    assert.equal((await fetch(base + '/bus-arrival?BusStopCode=12345%26other=1')).status, 400);
    assert.equal((await fetch(base + '/bus-arrival?BusStopCode=12345&BusStopCode=54321')).status, 400);
    assert.deepEqual(await (await fetch(base + '/bus-arrival?BusStopCode=12345')).json(), { Services: [{ ServiceNo: '77A' }] });
    assert.deepEqual(await (await fetch(base + '/bus-stop-description?codes=all')).json(), { '12345': 'Test stop' });
    assert.deepEqual(await (await fetch(base + '/majority-region?codes=12345')).json(), { majorityRegion: 'West', totalStops: 1 });
});

test('browser defenses and removed shared settings prevent cross-device injection', async t => {
    const base = await serve(t, createApp({ busStops: [] }));
    for (const method of ['GET', 'POST']) assert.equal((await fetch(base + '/bus-stop-selections', { method })).status, 404);
    const blocked = await fetch(base + '/calendar-proxy', { method: 'POST', headers: { Origin: 'https://evil.example' } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self';/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('x-powered-by'), null);
    assert.equal((await fetch(base + '/package-lock.json')).status, 404);
    assert.deepEqual(await (await fetch(base + '/healthz')).json(), { status: 'ok' });
});

test('upstream request rate is bounded', async t => {
    const base = await serve(t, createApp({ busStops: [], apiLimit: 2 }));
    await fetch(base + '/calendar-proxy');
    await fetch(base + '/calendar-proxy');
    const response = await fetch(base + '/calendar-proxy');
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal((await fetch(base + '/healthz')).status, 200);
});

test('local selections are bounded and escaped, including malicious descriptions and attributes', () => {
    const payload = '<img src=x onerror="alert(1)">';
    const selections = Safety.sanitizeBusStops([{ code: '12345', description: payload }, { code: '12345' }, { code: "bad' onclick=" }, null]);
    assert.deepEqual(selections, [{ code: '12345', description: payload }]);
    assert.equal(Safety.sanitizeBusStops({ code: '12345' }).length, 0);
    assert.equal(Safety.sanitizeBusStops(Array.from({ length: 30 }, (_, i) => ({ code: String(10000 + i) }))).length, 20);
    assert.equal(Safety.escapeHtml(payload), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(Safety.escapeHtml("' & >"), '&#39; &amp; &gt;');
});

test('dashboard and settings render saved markup as text, and settings remove uses an event listener', async () => {
    class Element {
        constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.style = {}; this.listeners = {}; }
        set innerHTML(value) { assert.fail('Untrusted bus selections must never use innerHTML'); }
        append(...children) { this.children.push(...children); }
        appendChild(child) { this.append(child); }
        replaceChildren() { this.children = []; }
        setAttribute(name, value) { this.attrs[name] = value; }
        addEventListener(name, listener) { this.listeners[name] = listener; }
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
        querySelector(selector) { return selector === '.basket-empty' ? null : this.children.find(child => selector === `[data-code="${child.dataset.code}"]`); }
    }
    const payload = '<img src=x onerror="alert(1)">';
    const table = new Element('tbody');
    const basket = new Element('div');
    const context = vm.createContext({
        ClientSafety: Safety, console: { log() {}, error() {} }, window: {},
        fetch: () => assert.fail('Selections must not use shared server storage'),
        localStorage: { getItem: () => JSON.stringify([{ code: '12345', description: payload }]) },
        document: {
            addEventListener() {}, createElement: tag => new Element(tag),
            querySelector: () => table, getElementById: () => basket
        }
    });
    vm.runInContext(fs.readFileSync(require.resolve('../public/script'), 'utf8'), context);
    await context.loadSelectedBusStops();
    vm.runInContext("busStopServices['12345'] = ['77A']; buildTableStructure();", context);
    assert.equal(table.children[0].children[0].children[1].textContent, payload);
    assert.equal(table.children[0].children[1].textContent, '77A');

    const settingsContext = vm.createContext({ ...context, document: context.document });
    vm.runInContext(fs.readFileSync(require.resolve('../public/settings'), 'utf8'), settingsContext);
    settingsContext.addToBasket('12345', payload, false);
    const item = basket.children[0];
    assert.equal(item.children[0].children[2].textContent, payload);
    const remove = item.children[1];
    assert.equal(remove.attrs.onclick, undefined);
    assert.equal(typeof remove.listeners.click, 'function');
    settingsContext.checkForChanges = () => {};
    remove.listeners.click();
    assert.equal(basket.children.includes(item), false);
});
