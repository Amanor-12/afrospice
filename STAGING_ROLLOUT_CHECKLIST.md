# AfroSpice Staging Rollout Checklist

## 1. Render staging env files

1. Copy [`deploy/targets/staging.example.json`](C:/Users/regan/Downloads/afrospice/deploy/targets/staging.example.json) to `deploy/targets/staging.json`
2. Replace the placeholder Mongo URI, release SHA, webhook URL, Sentry DSNs, and mail sender values
3. Render the exact env files:

```powershell
npm.cmd run deploy:render:target -- --source deploy/targets/staging.json --write
```

## 2. Confirm staging inputs

- `FRONTEND_ORIGIN=https://staging.afrospice.example.com`
- `PUBLIC_BASE_URL=https://staging.afrospice.example.com`
- `ALLOWED_HOSTS=staging.afrospice.example.com`
- `TRUST_PROXY=1`
- `ENFORCE_HTTPS=true`
- `AUTH_COOKIE_SECURE=true`
- `OBSERVABILITY_RELEASE` and `VITE_APP_RELEASE` set to the deployed commit SHA
- `SENTRY_DSN` and `VITE_SENTRY_DSN` set only when staging monitoring is intentional

## 3. Build and deploy

```powershell
docker compose -f deploy/docker-compose.staging.yml up --build -d
```

## 4. Validate health and readiness

1. `GET /api/system/health`
2. `GET /api/system/readiness`
3. Confirm readiness reports `ready`

## 5. Validate browser-critical paths

1. Sign in through the staging frontend
2. Confirm `/api/auth/me` succeeds
3. Confirm owner assistant bootstrap and reply both succeed
4. Confirm light mode and dark mode both render correctly after a hard refresh
5. Confirm passkey flows use the staging app origin without browser-origin errors

## 6. Validate operational paths

1. Create a sale
2. Create and resolve a refund request
3. Receive a purchase order
4. Confirm audit logging and notifications update as expected

## 7. Validate monitoring

1. Trigger one controlled backend 5xx and confirm it appears in the monitoring target
2. Trigger one controlled frontend runtime incident and confirm it appears in the monitoring target
3. Confirm `/api/system/client-events` accepts frontend incident intake

## 8. Validate restart safety

1. Perform a controlled restart
2. Confirm `/api/system/readiness` flips non-ready during drain
3. Confirm in-flight requests finish cleanly and new non-health requests receive `SERVICE_RESTARTING`

## 9. Run proof gates

```powershell
npm.cmd run verify:browser:e2e
npm.cmd run verify:load:smoke
npm.cmd run verify:load:proof
```

If authenticated load proof is required, set `LOAD_OWNER_PIN` before the proof run.
