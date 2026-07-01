# DevHub — Local Project Manager

A local-only developer dashboard for managing local dev projects.
Auto-detects project structure, installs dependencies, starts services, streams logs, and edits `.env` files — all from one browser tab.

---

## Architecture

```
devhub-server/   ← Node.js + Express REST API + ws log streaming  (port 3001)
code-haven-ui/   ← React + TanStack Router dashboard              (port 5173)
```

---

## Quick Start

### 1. Start the backend server

```bash
cd devhub-server
npm install          # first time only
npm run dev          # uses nodemon for auto-reload
# → http://localhost:3001
```

### 2. Start the frontend

```bash
cd code-haven-ui
npm install          # first time only
npm run dev
# → http://localhost:5173
```

Open **http://localhost:5173** in your browser.

---

## Automatic Dependency Setup

DevHub installs dependencies **before starting any service**:

| Stack | What DevHub runs |
|-------|------------------|
| **Node** | `npm install`, `pnpm install`, `yarn install`, or `bun install` (auto-detected from lockfile) |
| **Python** | Creates `venv` if missing, then `pip install -e .` and/or `pip install -r requirements*.txt` |

Use **Start All** on a project overview to install everything and launch backend → frontend in order.
When adding a project, enable **Install & start after adding** (on by default).

Service status shows `installing dependencies…` and `starting…` while work is in progress.
Install output appears in the **Logs** tab.

> If the backend is offline the UI shows an orange "DevHub server offline" banner at the top.

---

## Adding a New Project

### Option A — Via the UI

1. Click **Add Project** in the sidebar.
2. Fill in the name, absolute folder path, start commands, and ports.
3. Click **Add Project** — it's saved to `devhub-server/src/data/projects.json` immediately.

### Option B — Edit `projects.json` directly

Edit `devhub-server/src/data/projects.json` and restart the server:

```json
{
  "id": "my-uuid-here",
  "name": "my-app",
  "type": "mern",
  "path": "/Users/you/projects/my-app",
  "frontend": {
    "cwd": "client",
    "cmd": "npm run dev",
    "port": 5173
  },
  "backend": {
    "cwd": "server",
    "cmd": "npm start",
    "port": 4000
  },
  "envFilePath": "server/.env"
}
```

Fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Unique identifier — generate with `uuidgen` |
| `name` | string | Display name |
| `type` | `"mern"` \| `"html"` \| `"other"` | Project type |
| `path` | string | **Absolute** path to the project root |
| `frontend` | object \| null | `{ cwd, cmd, port }` — subdirectory relative to `path` |
| `backend` | object \| null | `{ cwd, cmd, port }` — null for HTML projects |
| `envFilePath` | string \| null | Path to `.env` file, relative to `path` or absolute |

---

## REST API

Base URL: `http://localhost:3001/api`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects` | List all projects + live status |
| `GET` | `/projects/:id` | Get single project |
| `POST` | `/projects` | Add project |
| `PUT` | `/projects/:id` | Update project metadata |
| `DELETE` | `/projects/:id` | Remove project |
| `POST` | `/projects/:id/setup` | Install dependencies for all services |
| `POST` | `/projects/:id/services/start-all` | Install deps + start backend then frontend |
| `POST` | `/projects/:id/services/frontend/start` | Install deps (if needed) + start frontend |
| `POST` | `/projects/:id/services/frontend/stop` | Stop frontend process |
| `POST` | `/projects/:id/services/frontend/restart` | Restart frontend process |
| `POST` | `/projects/:id/services/backend/start` | Install deps (if needed) + start backend |
| `POST` | `/projects/:id/services/backend/stop` | Stop backend process |
| `POST` | `/projects/:id/services/backend/restart` | Restart backend process |
| `GET` | `/projects/:id/status` | Get live process status |
| `GET` | `/projects/:id/env` | Read `.env` → `[{key, value}]` |
| `PUT` | `/projects/:id/env` | Write `[{key, value}]` → `.env` file |
| `GET` | `/health` | Server health check |

---

## WebSocket Log Streaming

```
ws://localhost:3001/ws/logs/:projectId/:serviceType
```

- `serviceType` is `frontend` or `backend`
- On connect: replays the last 200 buffered log lines
- Subsequent messages: `{ type: "log", id, level, timestamp, message }`

Example (browser console):

```js
const ws = new WebSocket("ws://localhost:3001/ws/logs/p1/frontend");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | devhub-server listen port |
| `VITE_DEVHUB_API_URL` | `http://localhost:3001` | Override API URL in the frontend |
