# Deploy Targets

Use these target maps as the single source of truth for staging and production hostnames.

Files:

- `staging.example.json`
- `production.example.json`

Workflow:

1. Copy the example file to `deploy/targets/<name>.json`
2. Replace domains, Mongo URI, release SHA, mail sender values, and monitoring DSNs
3. Render the exact env files:

```powershell
npm.cmd run deploy:render:target -- --source deploy/targets/production.json --write
```

Topology:

- `same-origin`: the shipped default. The frontend is served from one host and proxies `/api`
- `split-origin`: use separate public `app` and `api` origins

Important mapping rules:

- `frontendOrigin` is the browser-facing web app origin
- `PUBLIC_BASE_URL` renders from `frontendOrigin` because passkeys and browser trust checks use the app origin
- `apiOrigin` controls `ALLOWED_HOSTS`, `VITE_BACKEND_URL`, `VITE_API_URL` for split-origin, and client-error intake for split-origin
- In same-origin mode the renderer leaves `VITE_API_URL` blank so the SPA uses relative `/api` requests

Outputs:

- `deploy/env/backend.<environment>.env`
- `deploy/env/frontend.<environment>.env`
