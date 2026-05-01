# AfroSpice Release Checklist

## 1. Production environment

Backend:

- Copy [`backend/src/.env.example`](C:/Users/regan/Downloads/afrospice/backend/src/.env.example)
- Set `NODE_ENV=production`
- Set real values for `MONGO_URI`, `FRONTEND_ORIGIN`, `PUBLIC_BASE_URL`, `TRUST_PROXY`, `JWT_SECRET`
- Keep `PUBLIC_BASE_URL` aligned to the browser-facing app origin, not the backend-only origin
- Keep `AUTH_COOKIE_SECURE=true`
- Keep `BOOTSTRAP_SAMPLE_DATA=false`
- Keep `SERVER_SHUTDOWN_GRACE_PERIOD_MS` set so rolling restarts can drain traffic safely

Frontend:

- Copy [`frontend/.env.example`](C:/Users/regan/Downloads/afrospice/frontend/.env.example)
- Set `VITE_API_URL` only if the frontend and backend are deployed on different origins
- Set `VITE_CLIENT_ERROR_REPORTING_ENDPOINT` to the API origin only when using split-origin deployment

Deployment assets:

- Review [`DEPLOYMENT.md`](C:/Users/regan/Downloads/afrospice/DEPLOYMENT.md)
- Review the deploy env templates in [`deploy/env`](C:/Users/regan/Downloads/afrospice/deploy/env/README.md)
- Prefer rendering exact env values from [`deploy/targets`](C:/Users/regan/Downloads/afrospice/deploy/targets/README.md)
- Backend container: [`backend/Dockerfile`](C:/Users/regan/Downloads/afrospice/backend/Dockerfile)
- Frontend container: [`frontend/Dockerfile`](C:/Users/regan/Downloads/afrospice/frontend/Dockerfile)
- Reverse proxy config: [`deploy/nginx/default.conf`](C:/Users/regan/Downloads/afrospice/deploy/nginx/default.conf)
- Compose example: [`deploy/docker-compose.production.yml`](C:/Users/regan/Downloads/afrospice/deploy/docker-compose.production.yml)

## 2. Release gate

Strict gate:

```powershell
npm.cmd run verify:release
```

Local validation with readiness warnings allowed:

```powershell
npm.cmd run verify:release:local
```

CI:

- GitHub Actions release gate: [`.github/workflows/release-gate.yml`](C:/Users/regan/Downloads/afrospice/.github/workflows/release-gate.yml)

## 3. Backend runtime checks

```powershell
npm.cmd run verify:runtime
npm.cmd run verify:transactions
npm.cmd run verify:readiness
npm.cmd run verify:backup
npm.cmd run verify:restore
```

Expected production outcome:

- `verify:runtime` passes
- `verify:transactions` confirms native transactions
- `verify:readiness` reports `ready`
- `verify:backup` confirms the exported backup snapshot matches live storage counts
- `verify:restore` confirms the backup can be restored into a temporary database and validated

## 4. Live smoke checks

1. `GET /api/system/health`
2. `GET /api/system/readiness`
3. Sign in with a real staff account
4. Confirm `/api/auth/me` works through the deployed frontend
5. Create a sale, refund it, and verify inventory movement/audit trails
6. Perform a controlled restart and confirm non-health requests return `503 SERVICE_RESTARTING` only during drain

## 5. AI posture

- Grounded assistant is always safe to keep enabled
- External AI routing should only be enabled when `OPENAI_API_KEY` is configured intentionally

## 6. Observability and test gates

- Set `OBSERVABILITY_WEBHOOK_URL`, `OBSERVABILITY_RELEASE`, and `VITE_APP_RELEASE`
- Set `SENTRY_DSN` and `VITE_SENTRY_DSN` when Sentry monitoring is required
- Verify frontend runtime errors can reach `/api/system/client-events`
- Verify Sentry receives one backend 5xx test event and one frontend runtime test event
- Run `npm.cmd run verify:browser:e2e`
- Run `npm.cmd run verify:load:smoke`
- Run `npm.cmd run verify:load:proof`
