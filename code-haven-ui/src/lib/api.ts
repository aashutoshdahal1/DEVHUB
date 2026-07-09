/**
 * api.ts
 * Thin fetch wrapper for all DevHub backend REST endpoints.
 * Throws on non-2xx responses so callers (React Query) handle errors uniformly.
 */

const BACKEND_URL = import.meta.env.VITE_DEVHUB_API_URL ?? "http://localhost:3001";
export const WS_BASE = BACKEND_URL.replace(/^http/, "ws");
export const API_BASE = `${BACKEND_URL}/api`;

// ── Generic fetch helper ──────────────────────────────────────────────────────
async function req<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ServiceStatus {
  frontend: "running" | "stopped" | "error" | "installing" | "starting";
  backend: "running" | "stopped" | "error" | "installing" | "starting";
  frontendPort?: number | null;
  backendPort?: number | null;
}

export interface BackendProject {
  id: string;
  name: string;
  type: "mern" | "html" | "other";
  path: string;
  frontend: { cwd: string; cmd: string; port: number } | null;
  backend: { cwd: string; cmd: string; port: number } | null;
  envFilePath: string | null;
  status: ServiceStatus;
}

export interface EnvVar {
  id: string;
  key: string;
  value: string;
}

export interface NewProjectPayload {
  name: string;
  type: "mern" | "html" | "other";
  path: string;
  frontend: { cwd: string; cmd: string; port: number } | null;
  backend: { cwd: string; cmd: string; port: number } | null;
  envFilePath: string | null;
  autoStart?: boolean;
}

// ── Project CRUD ──────────────────────────────────────────────────────────────
export const fetchProjects = () =>
  req<BackendProject[]>("GET", "/projects");

export const fetchProject = (id: string) =>
  req<BackendProject>("GET", `/projects/${id}`);

export const addProject = (payload: NewProjectPayload) =>
  req<BackendProject>("POST", "/projects", payload);

export const updateProject = (id: string, payload: Partial<NewProjectPayload>) =>
  req<BackendProject>("PUT", `/projects/${id}`, payload);

export const deleteProject = (id: string) =>
  req<{ ok: boolean }>("DELETE", `/projects/${id}`);

// ── Service control ───────────────────────────────────────────────────────────
export const startService = (id: string, type: "frontend" | "backend") =>
  req<{ ok: boolean; status: ServiceStatus }>(
    "POST", `/projects/${id}/services/${type}/start`
  );

export const stopService = (id: string, type: "frontend" | "backend") =>
  req<{ ok: boolean; status: ServiceStatus }>(
    "POST", `/projects/${id}/services/${type}/stop`
  );

export const restartService = (id: string, type: "frontend" | "backend") =>
  req<{ ok: boolean; status: ServiceStatus }>(
    "POST", `/projects/${id}/services/${type}/restart`
  );

export const setupProject = (id: string) =>
  req<{ ok: boolean; status: ServiceStatus; results?: Record<string, unknown> }>(
    "POST", `/projects/${id}/setup`
  );

export const startAllServices = (id: string) =>
  req<{ ok: boolean; status: ServiceStatus }>(
    "POST", `/projects/${id}/services/start-all`
  );

export const fetchStatus = (id: string) =>
  req<ServiceStatus>("GET", `/projects/${id}/status`);

// ── Env vars ──────────────────────────────────────────────────────────────────
export const fetchEnvVars = (id: string) =>
  req<EnvVar[]>("GET", `/projects/${id}/env`);

export const saveEnvVars = (id: string, vars: Array<{ key: string; value: string }>) =>
  req<{ ok: boolean; count: number }>("PUT", `/projects/${id}/env`, vars);

// ── Auto-detect ───────────────────────────────────────────────────────────────
export async function detectProject(
  folderPath: string
): Promise<Partial<NewProjectPayload> & { name: string; type: string }> {
  const res = await fetch(
    `${BACKEND_URL}/api/detect?path=${encodeURIComponent(folderPath)}`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text);
  }
  return res.json();
}

// ── Folder picker ─────────────────────────────────────────────────────────────
export const pickFolder = (): Promise<string | null> =>
  fetch(`${BACKEND_URL}/api/pick-folder`)
    .then((r) => r.json())
    .then((d) => d.path ?? null)
    .catch(() => null);

// ── Health ────────────────────────────────────────────────────────────────────
export const checkHealth = () =>
  fetch(`${BACKEND_URL}/health`)
    .then((r) => r.ok)
    .catch(() => false);
