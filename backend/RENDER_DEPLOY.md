# Render Backend Deploy

This backend can run on Render as a Node web service. The repository now includes a backend-only blueprint at [`render.yaml`](C:/Users/regan/Downloads/afrospice/render.yaml).

## What this blueprint does

- deploys only the backend from `backend/`
- uses the repo `engines` declaration for Node/npm
- health-checks `GET /api/system/health`
- keeps Python ML disabled on Render so the verified Node forecasting engine stays active without extra system packages
- prompts for the production env values this runtime requires before it will boot

## Required production values

These are not optional for this backend in production:

- `MONGO_URI`
- `JWT_SECRET`
- `FRONTEND_ORIGIN`
- `PUBLIC_BASE_URL`
- `ALLOWED_HOSTS`

Important:

- `FRONTEND_ORIGIN` is the browser app origin, for example `https://app.afrospice.com`
- `PUBLIC_BASE_URL` must also be the browser-facing app origin for passkeys and browser trust rules
- `ALLOWED_HOSTS` must list the backend hostnames that receive requests, for example `afrospice-api.onrender.com,api.afrospice.com`

If you deploy only the backend on Render, this is a split-origin setup. That means:

- frontend/app origin and backend/api origin are different
- `FRONTEND_ORIGIN` and `PUBLIC_BASE_URL` should point to the frontend
- `ALLOWED_HOSTS` should point to the backend hostnames

## Recommended Render flow

1. Create or confirm a managed MongoDB replica-set URI.
2. Copy [`deploy/targets/production.example.json`](C:/Users/regan/Downloads/afrospice/deploy/targets/production.example.json) to `deploy/targets/production.json`.
3. Fill in:
   - real frontend origin
   - real API origin
   - real Mongo URI
   - release SHA
   - mail sender values
4. Preview the exact env set locally:

```powershell
npm.cmd run deploy:render:target -- --source deploy/targets/production.json
```

5. In Render, create a Blueprint deployment from the repository root so it reads [`render.yaml`](C:/Users/regan/Downloads/afrospice/render.yaml).
6. When Render prompts for unsynced variables, paste the real values from your target map or rendered preview.
7. After the first deploy, verify:
   - `/api/system/health`
   - `/api/system/readiness`

## Minimum production-safe values

Use these defaults unless you have a reason to change them:

- `NODE_ENV=production`
- `TRUST_PROXY=1`
- `ENFORCE_HTTPS=true`
- `AUTH_COOKIE_SECURE=true`
- `AUTH_COOKIE_SAMESITE=strict`
- `EXTERNAL_ASSISTANT_ENABLED=false` until `OPENAI_API_KEY` is configured intentionally
- `SENTRY_ENABLED=false` until `SENTRY_DSN` is configured intentionally

## Exact values you still need from yourself

I cannot invent these safely:

- frontend domain
- backend/API domain
- MongoDB production URI
- JWT secret
- optional OpenAI key
- optional Resend/SMTP credentials
- optional Sentry DSN

## Post-deploy checks

Run these after Render goes green:

1. `GET https://<backend-host>/api/system/health`
2. `GET https://<backend-host>/api/system/readiness`
3. sign in from the real frontend origin
4. open Reports and confirm `/api/reports` loads
5. open the owner assistant and confirm backend responses return without CORS or cookie failures
