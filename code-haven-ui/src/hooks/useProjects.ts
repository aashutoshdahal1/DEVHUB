/**
 * useProjects.ts
 * TanStack Query hooks for the DevHub project registry.
 *
 * - useProjects()           → list + live status polling
 * - useProjectMutations()   → add / update / delete / start / stop / restart
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { BackendProject, NewProjectPayload } from "@/lib/api";

const PROJECTS_KEY = ["projects"] as const;

// ── Query ─────────────────────────────────────────────────────────────────────
export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: api.fetchProjects,
    refetchInterval: 4000,    // poll status every 4 s
    retry: false,             // don't retry on network error (backend offline)
    staleTime: 1000,
  });
}

// ── Backend health ────────────────────────────────────────────────────────────
export function useBackendHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: api.checkHealth,
    refetchInterval: 5000,
    retry: false,
    staleTime: 0,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────
export function useProjectMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: PROJECTS_KEY });

  const addProject = useMutation({
    mutationFn: (payload: NewProjectPayload) => api.addProject(payload),
    onSuccess: invalidate,
  });

  const updateProject = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<NewProjectPayload> }) =>
      api.updateProject(id, payload),
    onSuccess: invalidate,
  });

  const deleteProject = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: invalidate,
  });

  const startService = useMutation({
    mutationFn: ({ id, type, force }: { id: string; type: "frontend" | "backend"; force?: boolean }) =>
      api.startService(id, type, force),
    onSuccess: invalidate,
  });

  const stopService = useMutation({
    mutationFn: ({ id, type }: { id: string; type: "frontend" | "backend" }) =>
      api.stopService(id, type),
    onSuccess: invalidate,
  });

  const restartService = useMutation({
    mutationFn: ({ id, type }: { id: string; type: "frontend" | "backend" }) =>
      api.restartService(id, type),
    onSuccess: invalidate,
  });

  const setupProject = useMutation({
    mutationFn: (id: string) => api.setupProject(id),
    onSuccess: invalidate,
  });

  const startAllServices = useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => api.startAllServices(id, force),
    onSuccess: invalidate,
  });

  const updateServicePort = useMutation({
    mutationFn: ({ id, type, port }: { id: string; type: "frontend" | "backend"; port: number }) =>
      api.updateServicePort(id, type, port),
    onSuccess: invalidate,
  });

  return {
    addProject, updateProject, deleteProject,
    startService, stopService, restartService,
    setupProject, startAllServices, updateServicePort,
  };
}

// ── Env mutations ─────────────────────────────────────────────────────────────
export function useEnvVars(projectId: string) {
  return useQuery({
    queryKey: ["env", projectId],
    queryFn: () => api.fetchEnvVars(projectId),
    enabled: !!projectId,
    retry: false,
    staleTime: 30_000,
  });
}

export function useSaveEnvVars(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Array<{ key: string; value: string }>) =>
      api.saveEnvVars(projectId, vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["env", projectId] }),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map a BackendProject to the shape the existing UI components expect.
 * This keeps backward compatibility with the Service[] model used in index.tsx.
 */
export function toUIProject(p: BackendProject) {
  type ServiceStatus = "running" | "stopped" | "error";
  type LogLine = { id: string; level: "info" | "warn" | "error"; timestamp: string; message: string };
  type Service = {
    name: "Frontend" | "Backend";
    status: ServiceStatus;
    port: number;
    startCommand: string;
    uptimeMinutes: number;
    logs: LogLine[];
    serviceType: "frontend" | "backend";
  };

  const services: Service[] = [];

  const placeholder = (name: "Frontend" | "Backend", status: ServiceStatus, serviceType: "frontend" | "backend", port: number, cmd: string): Service => ({
    name,
    status,
    port,
    startCommand: cmd,
    uptimeMinutes: 0,
    logs: [],
    serviceType,
  });

  if (p.frontend) {
    services.push(placeholder(
      "Frontend",
      p.status?.frontend ?? "stopped",
      "frontend",
      p.status?.frontendPort ?? p.frontend.port,
      p.frontend.cmd,
    ));
  }
  if (p.backend) {
    services.push(placeholder(
      "Backend",
      p.status?.backend ?? "stopped",
      "backend",
      p.status?.backendPort ?? p.backend.port,
      p.backend.cmd,
    ));
  }

  return {
    id: p.id,
    name: p.name,
    type: (p.type.toUpperCase() as "MERN" | "HTML" | "Other"),
    path: p.path,
    envFilePath: p.envFilePath ?? undefined,
    services,
    envVars: [] as Array<{ id: string; key: string; value: string }>,
  };
}
