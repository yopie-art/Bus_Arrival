# Security maintenance

Use Node.js 22.23.4 or a later patched 22.x release. The deployment version is
pinned in `.node-version`; update that pin when installing subsequent security
releases. Render must rebuild the service to change its runtime. The startup log
includes the actual Node version, and `/healthz` checks that the server is running.

Install dependencies with `npm ci`, run `npm test`, and check `npm audit` before
publishing changes. The browser assets do not have a separate npm project.

## LTA credential rotation

The previously embedded LTA key must be treated as exposed, including in Git
history. Generate a replacement through LTA DataMall, set `LTA_API_KEY` in the
existing Render service's Environment page, deploy, and verify bus arrivals.
Revoke the old key through DataMall. Removing it from the current source does
not revoke it or remove historical copies. Never put the replacement in Git,
issue comments, logs, or chat. Local development can use an ignored `.env` file
based on `.env.example`.

## Calendar privacy

Calendar addresses and bus selections are saved in the device's browser storage.
Calendar addresses are sent to the server in POST bodies, forwarded only to the
Google Calendar iCal endpoint, and excluded from application logs and request
URLs. Calendar responses are not cached. Do not enable request-body logging in
external monitoring. Old calendar addresses that appeared in logs should be
regenerated in Google Calendar settings and replaced on each dashboard device.

The proxy rejects redirects, compressed data, oversized responses and slow
upstream requests. The service limits upstream concurrency and request rate.
These limits are per process and intended for this personal dashboard.
