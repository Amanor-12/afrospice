# Deployment Environment Templates

These files give you exact staging/production variable layouts without committing secrets.

## Suggested domains

Default same-origin topology:

- Staging app: `https://staging.afrospice.example.com`
- Production app: `https://app.afrospice.example.com`

Optional split-origin topology:

- Staging app: `https://staging.afrospice.example.com`
- Staging API: `https://staging-api.afrospice.example.com`
- Production app: `https://app.afrospice.example.com`
- Production API: `https://api.afrospice.example.com`

## Files

- [`backend.staging.env.example`](C:/Users/regan/Downloads/afrospice/deploy/env/backend.staging.env.example)
- [`backend.production.env.example`](C:/Users/regan/Downloads/afrospice/deploy/env/backend.production.env.example)
- [`frontend.staging.env.example`](C:/Users/regan/Downloads/afrospice/deploy/env/frontend.staging.env.example)
- [`frontend.production.env.example`](C:/Users/regan/Downloads/afrospice/deploy/env/frontend.production.env.example)

## Usage

1. Copy the example that matches the target environment
2. Remove the `.example` suffix
3. Replace every placeholder secret and domain
4. Keep real env files out of git

Preferred workflow:

1. Copy [`deploy/targets/staging.example.json`](C:/Users/regan/Downloads/afrospice/deploy/targets/staging.example.json) or [`deploy/targets/production.example.json`](C:/Users/regan/Downloads/afrospice/deploy/targets/production.example.json)
2. Save it as `deploy/targets/<environment>.json`
3. Render exact env files:

```powershell
npm.cmd run deploy:render:target -- --source deploy/targets/staging.json --write
npm.cmd run deploy:render:target -- --source deploy/targets/production.json --write
```

Notes:

- `PUBLIC_BASE_URL` is the browser-facing app origin used by passkeys and browser trust flows
- Keep `VITE_API_URL` blank for same-origin deployments
- In split-origin deployments the renderer will emit an absolute `VITE_CLIENT_ERROR_REPORTING_ENDPOINT` that points at the API origin
