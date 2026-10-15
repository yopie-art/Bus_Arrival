const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Aqicn = require('../public/aqicn-shared');

// A minimal DOM and clock let failure, recovery, rollover and rotation run deterministically.
class Element {
    constructor(id) { this.id = id; this.children = []; this.attrs = {}; this.classes = new Set(); this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) }; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attrs[key] = value; }
}
function harness({ configured = true, fail = false, partial = false } = {}) {
    let now = Date.parse('2026-10-15T04:00:00Z');
    let stored = configured ? 'https://aqicn.org/forecast/singapore/' : '';
    let failure = fail;
    let requests = 0;
    let pending = false;
    let resolvePending;
    const nodes = ['headerWeather', 'pm25Forecast', 'temperatureForecast'].map(id => new Element(id));
    const listeners = {};
    const intervals = [];
    const day = Aqicn.dayKey(now);
    const series = { updatedAt: new Date(now).toISOString(), points: Array.from({ length: 24 }, (_, h) => ({ time: `${day}T${String(h).padStart(2, '0')}:00:00+08:00`, value: 25 + h })) };
    const response = { sourceUrl: stored, location: 'Singapore', pm25: partial ? null : series, temperature: series };
    class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
    const document = {
        hidden: false, getElementById: id => nodes.find(n => n.id === id), querySelectorAll: () => nodes,
        createElement: () => new Element(), createElementNS: () => new Element(),
        addEventListener: (name, fn) => { listeners[name] = fn; }
    };
    const window = { addEventListener: (name, fn) => { listeners[name] = fn; } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../public/environment.js'), 'utf8'), {
        window, document, localStorage: { getItem: () => stored }, Aqicn, Date: FakeDate, Intl, AbortController,
        setInterval: fn => intervals.push(fn), setTimeout: () => 1, clearTimeout() {}, console: { warn() {} },
        fetch: async () => {
            requests++;
            if (pending) await new Promise(resolve => { resolvePending = resolve; });
            if (failure) throw new Error('offline');
            return { ok: true, json: async () => response };
        }
    });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    return {
        nodes, response, start: async () => { window.DashboardEnvironment.start(); await flush(); },
        active: () => nodes.find(node => node.classes.has('is-active')).id,
        advance: async ms => { now += ms; intervals.forEach(fn => fn()); await flush(); },
        setFailure: value => { failure = value; }, requests: () => requests,
        clear: async () => { stored = ''; listeners.storage({ key: 'aqicnForecastUrl' }); await flush(); },
        setPending: () => { pending = true; }, resolve: async () => { resolvePending(); await flush(); }
    };
}

test('three views rotate at thirty seconds and hidden panels are inaccessible', async () => {
    const h = harness();
    await h.start();
    assert.equal(h.active(), 'headerWeather');
    await h.advance(29999);
    assert.equal(h.active(), 'headerWeather');
    await h.advance(1);
    assert.equal(h.active(), 'pm25Forecast');
    assert.equal(h.nodes[0].attrs['aria-hidden'], 'true');
    assert.equal(h.nodes[0].inert, true);
    await h.advance(30000);
    assert.equal(h.active(), 'temperatureForecast');
    await h.advance(30000);
    assert.equal(h.active(), 'headerWeather');
    assert.equal(h.requests(), 1);
});

test('no URL means weather only and no external requests', async () => {
    const h = harness({ configured: false });
    await h.start();
    await h.advance(30000);
    assert.equal(h.active(), 'headerWeather');
    assert.equal(h.requests(), 0);
});

test('partial data skips PM2.5 and still rotates temperature', async () => {
    const h = harness({ partial: true });
    await h.start();
    await h.advance(30000);
    assert.equal(h.active(), 'temperatureForecast');
    await h.advance(30000);
    assert.equal(h.active(), 'headerWeather');
});

test('initial failure falls back to weather, retries and recovers', async () => {
    const h = harness({ fail: true });
    await h.start();
    await h.advance(30000);
    assert.equal(h.active(), 'headerWeather');
    h.setFailure(false);
    await h.advance(5 * 60000);
    assert.equal(h.requests(), 2);
    await h.advance(30000);
    assert.equal(h.active(), 'pm25Forecast');
});

test('midnight removes yesterday data even when the next request fails', async () => {
    const h = harness();
    await h.start();
    await h.advance(30000);
    assert.equal(h.active(), 'pm25Forecast');
    h.setFailure(true);
    await h.advance(12 * 3600000);
    assert.equal(h.active(), 'headerWeather');
    await h.advance(30000);
    assert.equal(h.active(), 'headerWeather');
});

test('late responses cannot restore forecasts after the URL is cleared', async () => {
    const h = harness();
    h.setPending();
    await h.start();
    await h.clear();
    await h.resolve();
    await h.advance(30000);
    assert.equal(h.active(), 'headerWeather');
});

test('failed refresh retains current-day data, then expires old model runs', async () => {
    const h = harness();
    await h.start();
    h.setFailure(true);
    await h.advance(30 * 60000);
    await h.advance(30000);
    assert.equal(h.active(), 'temperatureForecast');
    const tomorrow = '2026-10-19T12:00:00+08:00';
    h.response.pm25.points = [{ time: tomorrow, value: 50 }];
    h.response.temperature.points = [{ time: tomorrow, value: 30 }];
    await h.advance(4 * 86400000);
    assert.equal(h.active(), 'headerWeather');
});
