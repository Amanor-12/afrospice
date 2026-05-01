# AfroSpice Deployment

## Production baseline

- Node `>=20.19.0`
- npm `>=10`
- MongoDB replica set with native transaction support
- HTTPS at the public edge
- `JWT_SECRET` set to a real secret
- `AUTH_COOKIE_SECURE=true`
- `ENFORCE_HTTPS=true`
- `TRUST_PROXY=1` when TLS terminates before Express
- explicit backend timeout policy for request, headers, and keep-alive
- graceful shutdown drain window configured with `SERVER_SHUTDOWN_GRACE_PERIOD_MS`

## Render backend

- Backend Blueprint: [`render.yaml`](C:/Users/regan/Downloads/afrospice/render.yaml)
- Render-specific guide: [`backend/RENDER_DEPLOY.md`](C:/Users/regan/Downloads/afrospice/backend/RENDER_DEPLOY.md)
- For Render env values, use the target renderer instead of typing them from memory:

```powershell
npm.cmd run deploy:render:target -- --source deploy/targets/production.json
```

## Environment files

Backend:

- Start from [`backend/src/.env.example`](C:/Users/regan/Downloads/afrospice/backend/src/.env.example)
- Save the real file as `backend/src/.env`
- For deployment-specific values, start from the staged templates under [`deploy/env`](C:/Users/regan/Downloads/afrospice/deploy/env/README.md)
- Prefer rendering exact environment files from a target map in [`deploy/targets`](C:/Users/regan/Downloads/afrospice/deploy/targets/README.md)

Frontend:

- Start from [`frontend/.env.example`](C:/Users/regan/Downloads/afrospice/frontend/.env.example)
- Save the real file as `frontend/.env` only when you need build-time overrides
- Use [`deploy/env/frontend.staging.env.example`](C:/Users/regan/Downloads/afrospice/deploy/env/frontend.staging.env.example) or [`deploy/env/frontend.production.env.example`](C:/Users/regan/Downloads/afrospice/deploy/env/frontend.production.env.example) when you want environment-specific build values

Render exact environment files from a target map:

```powershell
npm.cmd run deploy:render:target -- --source deploy/targets/staging.json --write
npm.cmd run deploy:render:target -- --source deploy/targets/production.json --write
```

## Container artifacts

- Backend image: [`backend/Dockerfile`](C:/Users/regan/Downloads/afrospice/backend/Dockerfile)
- Frontend image: [`frontend/Dockerfile`](C:/Users/regan/Downloads/afrospice/frontend/Dockerfile)
- Frontend reverse proxy: [`deploy/nginx/default.conf`](C:/Users/regan/Downloads/afrospice/deploy/nginx/default.conf)
- Staging compose example: [`deploy/docker-compose.staging.yml`](C:/Users/regan/Downloads/afrospice/deploy/docker-compose.staging.yml)
- Production compose example: [`deploy/docker-compose.production.yml`](C:/Users/regan/Downloads/afrospice/deploy/docker-compose.production.yml)

## Recommended production topology

Default topology:

1. Managed MongoDB replica set
2. One backend container
3. One frontend container serving the built SPA and reverse-proxying `/api`
4. External TLS termination or ingress in front of the frontend container

Domain mapping:

- Staging app origin: `https://staging.afrospice.example.com`
- Production app origin: `https://app.afrospice.example.com`
- `PUBLIC_BASE_URL` must point at the browser-facing app origin because passkeys and browser trust checks depend on that origin
- `ALLOWED_HOSTS` must list the hostnames that actually reach the backend
- `VITE_API_URL` should stay blank for same-origin deployments and only be set for split-origin deployments

Optional split-origin topology:

- Frontend origin: `https://app.afrospice.example.com`
- API origin: `https://api.afrospice.example.com`
- When split-origin is used, render env files from a split-origin target so `VITE_API_URL` and `VITE_CLIENT_ERROR_REPORTING_ENDPOINT` point to the API origin explicitly

## Build and release checks

From the repository root:

```powershell
npm.cmd run verify:release
```

For local validation where readiness warnings are acceptable:

```powershell
npm.cmd run verify:release:local
```

## Compose example

The compose example is intended for a production-like web tier only. It does not provision MongoDB for you because production should use a managed replica set.

```powershell
docker compose -f deploy/docker-compose.production.yml up --build -d
```

## Post-deploy smoke checks

1. `GET /api/system/health`
2. `GET /api/system/readiness`
3. Sign in through the deployed frontend
4. Confirm the owner assistant loads and answers
5. Create a sale, refund request, and purchase-order receive event
6. Trigger a rolling restart and confirm `/api/system/readiness` flips non-ready while in-flight sessions complete cleanly

## Observability

- Frontend runtime errors can post to `/api/system/client-events`
- Frontend runtime incidents can also go directly to Sentry with `VITE_SENTRY_DSN`
- Backend Express 5xx and process-level failures can go directly to Sentry with `SENTRY_DSN`
- Backend incidents can forward to `OBSERVABILITY_WEBHOOK_URL`
- Set `OBSERVABILITY_RELEASE` and `VITE_APP_RELEASE` to the deployed commit SHA for traceability
- Keep Sentry sample rates at `0` until you intentionally enable tracing

## Test Scaffolding

```powershell
npm.cmd run verify:browser:e2e
npm.cmd run verify:load:smoke
npm.cmd run verify:load:proof
```

## Rollout checklist

- Staging rollout checklist: [`STAGING_ROLLOUT_CHECKLIST.md`](C:/Users/regan/Downloads/afrospice/STAGING_ROLLOUT_CHECKLIST.md)
- Release checklist: [`RELEASE_CHECKLIST.md`](C:/Users/regan/Downloads/afrospice/RELEASE_CHECKLIST.md)
