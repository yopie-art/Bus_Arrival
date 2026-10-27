const path = require('node:path');
const [major, minor, patch] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 23 || (minor === 23 && patch < 4)) {
    throw new Error('Use patched Node.js 22.23.4 or a newer 22.x release. See .node-version.');
}

// Read local development secrets without adding a dependency or logging values.
try {
    process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Unable to load the local environment file.');
}

function getLtaApiKey() {
    const value = process.env.LTA_API_KEY?.trim();
    if (!value) throw new Error('LTA_API_KEY must be configured in the environment.');
    return value;
}

module.exports = { getLtaApiKey };
