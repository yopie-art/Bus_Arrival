const defaultFetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function requestText(url, { fetchImpl = defaultFetch, headers = {}, maxBytes = 2 * 1024 * 1024, timeoutMs = 10000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, {
            headers: { ...headers, 'Accept-Encoding': 'identity' },
            signal: controller.signal, redirect: 'error', size: maxBytes, compress: false
        });
        if (!response.ok) {
            response.body?.destroy();
            throw new Error('Upstream service returned an unsuccessful response.');
        }
        const encoding = response.headers?.get('content-encoding');
        if (encoding && encoding.toLowerCase() !== 'identity') {
            response.body?.destroy();
            throw new Error('Compressed upstream responses are not accepted.');
        }
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Upstream response exceeds the size limit.');
        return text;
    } finally {
        clearTimeout(timer);
    }
}

async function requestJson(url, options) {
    return JSON.parse(await requestText(url, options));
}

module.exports = { requestText, requestJson };
