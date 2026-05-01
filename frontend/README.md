# AfroSpice Frontend

React 19 + Vite 8 owner workspace for AfroSpice.

## Node baseline

- Node `>=20.19.0`
- npm `>=10`

## Local development

From the repository root:

```powershell
npm.cmd run dev
```

Frontend only:

```powershell
npm.cmd --prefix frontend run dev
```

## Quality gates

```powershell
npm.cmd --prefix frontend run lint
npm.cmd --prefix frontend run build
```

## Environment

Start from [`frontend/.env.example`](C:/Users/regan/Downloads/afrospice/frontend/.env.example).

- Leave `VITE_API_URL` blank when the deployed frontend and backend share the same origin and `/api` is reverse-proxied.
- Set `VITE_API_URL` when the frontend is deployed on a different origin than the API.
- `VITE_BACKEND_URL` is only used by the local Vite proxy.

## Production packaging

- Frontend container build: [`frontend/Dockerfile`](C:/Users/regan/Downloads/afrospice/frontend/Dockerfile)
- Reverse proxy config: [`deploy/nginx/default.conf`](C:/Users/regan/Downloads/afrospice/deploy/nginx/default.conf)
- Compose example: [`deploy/docker-compose.production.yml`](C:/Users/regan/Downloads/afrospice/deploy/docker-compose.production.yml)

## Important runtime note

This frontend expects:

- `/api/*` to be available at runtime
- SPA route fallback to `index.html`
- cookies to be preserved for authenticated API calls
