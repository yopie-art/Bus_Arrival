const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractFeed, decodePm25, normalizeFeed, fetchForecast, stationForecastFeed } = require('../aqicn');
const { normalizeUrl, todaySlots, dayKey, aqiColor } = require('../public/aqicn-shared');

const url = 'https://aqicn.org/forecast/singapore/';
const now = Date.parse('2026-10-15T04:00:00Z');
function feed() {
    return {
        timestamp: now / 1000, city: { name: 'Central, Singapore' },
        forecast: {
            species: { pm25: { data: ['', 1, [[now / 3600000 - 12, 50], 'bAZ'], 3600], model: { extracted: new Date(now).toISOString() } } },
            wind: [{ t: '2026-10-14T16:00:00Z', c: 26 }, { t: '2026-10-15T04:00:00Z', c: 30 }]
        }
    };
}

test('accepts city forecast URLs and rejects alternate hosts, credentials and paths', () => {
    assert.equal(normalizeUrl(url + '?tracking=1#chart'), url);
    assert.equal(normalizeUrl('https://aqicn.org/city/singapore/west'), 'https://aqicn.org/city/singapore/west/');
    assert.equal(normalizeUrl('https://aqicn.org/city/singapore/west/'), 'https://aqicn.org/city/singapore/west/');
    assert.equal(normalizeUrl(url.slice(0, -1)), url);
    for (const bad of [undefined, {}, 'http://aqicn.org/forecast/singapore/',
        'https://aqicn.org.evil.test/forecast/singapore/', 'https://aqicn.org@evil.test/forecast/singapore/',
        'https://user:pass@aqicn.org/forecast/singapore/', 'https://aqicn.org:8443/forecast/singapore/',
        'https://aqicn.org/city/', 'https://aqicn.org/city/singapore/west/file.json',
        'https://aqicn.org/forecast/../api/', 'https://127.0.0.1/forecast/singapore/']) {
        assert.throws(() => normalizeUrl(bad));
    }
});

function stationData() {
    return {
        station: { city: { idx: 1665, name: 'West, Singapore' }, timestamp: now / 1000 },
        payload: { rxs: { obs: [{ msg: {
            city: { name: 'West, Singapore', timezone: '+08:00' }, xsync: { gen: now / 1000 },
            hourly: { aqi: feed().forecast.species, met: [
                { at: '2026-10-15 00:00:00', t: 26 }, { at: '2026-10-15 12:00:00', t: 30 }
            ] }
        } }] } }
    };
}

test('station pages retain West identity and request that station forecast without a token', async () => {
    const { station, payload } = stationData();
    const stationUrl = 'https://aqicn.org/city/singapore/west/';
    const requests = [];
    const result = await fetchForecast(stationUrl, async (requested, options) => {
        requests.push(requested);
        assert.equal(options.redirect, 'error');
        assert.equal(options.compress, false);
        assert.equal(options.headers['Accept-Encoding'], 'identity');
        return { ok: true, text: async () => requested === stationUrl
            ? `<script>try { setWidgetAqiGraphModel(${JSON.stringify(station)}); } catch(e) {}</script>`
            : JSON.stringify(payload) };
    });
    assert.deepEqual(requests, [stationUrl, 'https://api2.waqi.info/api/feed/@1665/forecast.json']);
    assert.equal(result.sourceUrl, stationUrl);
    assert.equal(result.location, 'West, Singapore');
    assert.equal(result.pm25.points.length, 4);
    assert.equal(todaySlots(result.temperature, now)[0], 26);
    assert.equal(result.temperature.points[0].time, '2026-10-14T16:00:00.000Z');
});

test('station schema changes and invalid station IDs fail safely', async () => {
    const { station, payload } = stationData();
    assert.throws(() => stationForecastFeed(station, {}), /unavailable/);
    payload.rxs.obs[0].msg.city.timezone = 'unrecognized';
    assert.throws(() => stationForecastFeed(station, payload), /timezone/);
    station.city.idx = 'https://evil.test/';
    let requests = 0;
    await assert.rejects(fetchForecast('https://aqicn.org/city/singapore/west/', async () => {
        requests++;
        return { ok: true, text: async () => `<script>setWidgetAqiGraphModel(${JSON.stringify(station)});</script>` };
    }), /station ID/);
    assert.equal(requests, 1);
});

test('extracts JSON with quoted braces and escaped quotes; never evaluates page scripts', () => {
    const input = feed();
    input.city.name = 'City } "quoted" \\ name';
    const html = `<script src="other.js"></script><script>var feed = ${JSON.stringify(input)}; throw new Error('never execute');</script>`;
    assert.deepEqual(extractFeed(html), input);
    assert.throws(() => extractFeed('<script>var feed = {forecast: runCode()};</script>'));
    assert.throws(() => extractFeed('<html>upstream error or changed markup</html>'));
    assert.throws(() => extractFeed('<script>var feed = {"broken":true</script>'));
});

test('decodes hourly PM2.5 deltas and rejects unsupported or corrupt encodings', () => {
    const decoded = decodePm25(feed().forecast.species.pm25.data);
    assert.deepEqual(decoded.map(p => p.value), [50, 51, 50, 24]);
    assert.equal(decoded[0].time, '2026-10-14T16:00:00.000Z');
    assert.equal(Date.parse(decoded[1].time) - Date.parse(decoded[0].time), 3600000);
    for (const bad of [null, ['', 2, [], 3600], ['', 1, [], 7200], ['', 1, [[1, -1]], 3600], ['', 1, [[1, 50], '3'], 3600], ['', 1, [[1, 50], [-1, 0]], 3600]]) {
        assert.throws(() => decodePm25(bad));
    }
});

test('a corrupt PM2.5 series preserves valid temperature and vice versa', () => {
    const input = feed();
    input.forecast.species.pm25.data = ['changed'];
    const normalized = normalizeFeed(input, url);
    assert.equal(normalized.pm25, null);
    assert.equal(normalized.temperature.points.length, 2);
    const other = feed();
    other.forecast.wind = [{ t: 'not a date', c: 30 }, { t: new Date(now).toISOString(), c: '30' }];
    assert.equal(normalizeFeed(other, url).temperature, null);
    assert.throws(() => normalizeFeed({ forecast: {} }, url));
});

test('today uses Singapore midnight, keeps gaps and expires old/future model runs', () => {
    const series = normalizeFeed(feed(), url).temperature;
    const slots = todaySlots(series, now);
    assert.equal(slots.length, 24);
    assert.equal(slots[0], 26);
    assert.equal(slots[12], 30);
    assert.equal(slots[1], null);
    assert.equal(dayKey('2026-10-15T16:00:00Z'), '2026-10-16');
    assert.ok(todaySlots(series, Date.parse('2026-10-15T16:00:00Z')).every(p => p === null));
    assert.ok(todaySlots({ ...series, updatedAt: '2026-10-10T00:00:00Z' }, now).every(p => p === null));
    assert.ok(todaySlots({ ...series, updatedAt: '2026-10-20T00:00:00Z' }, now).every(p => p === null));
    assert.equal(aqiColor(50), '#009966');
    assert.equal(aqiColor(51), '#ffde33');
    assert.equal(aqiColor(301), '#7e0023');
});

test('fetches only the validated URL, refuses redirects and propagates upstream failures', async () => {
    let called = false;
    const result = await fetchForecast(url, async (requested, options) => {
        called = true;
        assert.equal(requested, url);
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.size, 2097152);
        return { ok: true, text: async () => `<script>var feed=${JSON.stringify(feed())};</script>` };
    });
    assert.ok(called);
    assert.equal(result.location, 'Central, Singapore');
    await assert.rejects(fetchForecast('https://evil.test/', () => assert.fail('must not fetch')));
    await assert.rejects(fetchForecast(url, async () => ({ ok: false, status: 503 })), /503/);
    await assert.rejects(fetchForecast(url, async () => ({ ok: true, text: async () => '<html>No forecast</html>' })), /not found/);
    await assert.rejects(fetchForecast(url, async () => ({ ok: true, text: async () => 'x'.repeat(2097153) })), /too large/);
    await assert.rejects(fetchForecast(url, async () => ({ ok: true, headers: new Headers({ 'content-encoding': 'br' }), text: async () => assert.fail('must not read compressed data') })), /Compressed/);
});

test('a slow upstream request is aborted after ten seconds', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const request = fetchForecast(url, async (_, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const rejected = assert.rejects(request, /aborted/);
    t.mock.timers.tick(10000);
    await rejected;
});
