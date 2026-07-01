import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import {
  Plus, Settings, Play, Square, RotateCw, ExternalLink, Trash2,
  Eye, EyeOff, Search, X, FolderOpen, Terminal, AlertCircle,
  Wifi, WifiOff, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast, Toaster } from "sonner";
import { cn } from "@/lib/utils";
import { formatUptime } from "@/lib/devhub-data";
import type { EnvVar, LogLine, Service, ServiceStatus } from "@/lib/devhub-data";
import {
  useProjects, useBackendHealth, useProjectMutations,
  useEnvVars, useSaveEnvVars, toUIProject,
} from "@/hooks/useProjects";
import type { NewProjectPayload } from "@/lib/api";
import { useLogStream } from "@/hooks/useLogStream";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DevHub — Local Project Dashboard" },
      { name: "description", content: "Manage your local MERN and HTML dev projects from one dashboard." },
      { property: "og:title", content: "DevHub" },
      { property: "og:description", content: "Manage your local MERN and HTML dev projects from one dashboard." },
    ],
  }),
  component: DevHubPage,
});

// ── UI helpers ─────────────────────────────────────────────────────────────────
const statusDotClass: Record<ServiceStatus, string> = {
  running: "bg-success shadow-[0_0_8px_var(--success)]",
  stopped: "bg-muted-foreground/50",
  error:   "bg-destructive shadow-[0_0_8px_var(--destructive)]",
  installing: "bg-warning shadow-[0_0_8px_var(--warning)] animate-pulse",
  starting: "bg-primary shadow-[0_0_8px_var(--primary)] animate-pulse",
};

const statusTextClass: Record<ServiceStatus, string> = {
  running: "text-success",
  stopped: "text-muted-foreground",
  error:   "text-destructive",
  installing: "text-warning",
  starting: "text-primary",
};

const statusLabel: Record<ServiceStatus, string> = {
  running: "running",
  stopped: "stopped",
  error: "error",
  installing: "installing dependencies…",
  starting: "starting…",
};

function StatusDot({ status, className }: { status: ServiceStatus; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full", statusDotClass[status], className)} />;
}

function aggregateStatus(services: Service[]): ServiceStatus {
  if (services.some((s) => s.status === "error")) return "error";
  if (services.some((s) => s.status === "installing")) return "installing";
  if (services.some((s) => s.status === "starting")) return "starting";
  if (services.some((s) => s.status === "running")) return "running";
  return "stopped";
}

// ── Page ───────────────────────────────────────────────────────────────────────
function DevHubPage() {
  const { data: rawProjects = [], isLoading, isError } = useProjects();
  const { data: backendOnline = false } = useBackendHealth();
  const mutations = useProjectMutations();

  const projects = useMemo(() => rawProjects.map(toUIProject), [rawProjects]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Auto-select first project
  useEffect(() => {
    if (!selectedId && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const selected = projects.find((p) => p.id === selectedId) ?? projects[0];

  const counts = useMemo(() => {
    let running = 0, stopped = 0, error = 0;
    for (const p of projects) {
      const s = aggregateStatus(p.services);
      if (s === "running") running++;
      else if (s === "error") error++;
      else stopped++;
    }
    return { running, stopped, error };
  }, [projects]);

  const handleServiceAction = async (
    projectId: string,
    serviceType: "frontend" | "backend",
    action: "start" | "stop" | "restart"
  ) => {
    try {
      if (action === "start") {
        await mutations.startService.mutateAsync({ id: projectId, type: serviceType });
        toast.success(`${serviceType} starting — installing dependencies if needed`);
      } else if (action === "stop") {
        await mutations.stopService.mutateAsync({ id: projectId, type: serviceType });
        toast(`${serviceType} stopped`);
      } else {
        await mutations.restartService.mutateAsync({ id: projectId, type: serviceType });
        toast.success(`${serviceType} restarted`);
      }
    } catch (err) {
      // 409 "not running" / "already running" — stale UI state, not a real error
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("not running") && !msg.includes("already running")) {
        toast.error(`Failed: ${action} → ${msg}`);
      }
    }
  };

  const handleStartAll = async (projectId: string) => {
    try {
      await mutations.startAllServices.mutateAsync(projectId);
      toast.success("Installing dependencies and starting all services…");
    } catch (err) {
      toast.error(`Start all failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSetup = async (projectId: string) => {
    try {
      await mutations.setupProject.mutateAsync(projectId);
      toast.success("Installing dependencies…");
    } catch (err) {
      toast.error(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDeleteProject = async (id: string) => {
    const name = projects.find((p) => p.id === id)?.name ?? id;
    try {
      await mutations.deleteProject.mutateAsync(id);
      setSelectedId((prev) => (prev === id ? projects.find((p) => p.id !== id)?.id ?? "" : prev));
      toast(`Deleted ${name}`);
    } catch (err) {
      toast.error(`Failed to delete: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Toaster theme="dark" position="bottom-right" />

      {/* Offline banner */}
      {!backendOnline && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-destructive/90 px-4 py-2 text-xs font-medium text-white backdrop-blur">
          <WifiOff className="h-3.5 w-3.5" />
          DevHub server offline — start it with <code className="rounded bg-white/20 px-1">npm run dev</code> inside <code className="rounded bg-white/20 px-1">devhub-server/</code>
        </div>
      )}

      {/* Sidebar */}
      <aside className={cn("flex w-64 shrink-0 flex-col border-r border-border bg-sidebar", !backendOnline && "pt-9")}>
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Terminal className="h-4 w-4" />
          </div>
          <span className="font-semibold tracking-tight">DevHub</span>
          <span className="ml-auto rounded bg-sidebar-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            v1.0
          </span>
          {/* Backend health dot */}
          <span title={backendOnline ? "Backend online" : "Backend offline"}>
            {backendOnline
              ? <Wifi className="h-3.5 w-3.5 text-success" />
              : <WifiOff className="h-3.5 w-3.5 text-destructive" />}
          </span>
        </div>

        <div className="px-3 py-3">
          <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Projects
          </p>
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> Could not load projects
            </div>
          ) : (
            <nav className="space-y-0.5">
              {projects.map((p) => {
                const s = aggregateStatus(p.services);
                const isConfirming = confirmDeleteId === p.id;

                if (isConfirming) {
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5"
                    >
                      <span className="truncate text-xs font-medium text-destructive flex-1">
                        Remove "{p.name}"?
                      </span>
                      <button
                        onClick={() => { setConfirmDeleteId(null); handleDeleteProject(p.id); }}
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-destructive text-white hover:bg-destructive/80 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        No
                      </button>
                    </div>
                  );
                }

                return (
                  <div key={p.id} className="group relative flex items-center">
                    <button
                      onClick={() => setSelectedId(p.id)}
                      className={cn(
                        "flex flex-1 min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors pr-7",
                        selectedId === p.id
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                      )}
                    >
                      <StatusDot status={s} />
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground/70 shrink-0">
                        {p.type}
                      </span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(p.id); }}
                      title="Remove project"
                      className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </nav>
          )}
        </div>

        <div className="mt-auto border-t border-sidebar-border p-3">
          <Button
            onClick={() => setAddOpen(true)}
            variant="outline"
            className="w-full justify-start gap-2 border-dashed bg-transparent"
            disabled={!backendOnline}
          >
            <Plus className="h-4 w-4" />
            Add Project
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className={cn("flex min-w-0 flex-1 flex-col", !backendOnline && "pt-9")}>
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-surface px-5">
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <StatusDot status="running" />
              <span className="font-mono text-foreground">{counts.running}</span> running
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <StatusDot status="stopped" />
              <span className="font-mono text-foreground">{counts.stopped}</span> stopped
            </span>
            {counts.error > 0 && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <StatusDot status="error" />
                <span className="font-mono text-foreground">{counts.error}</span> error
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Detail view */}
        {selected ? (
          <ProjectDetail
            key={selected.id}
            project={selected}
            backendOnline={backendOnline}
            onServiceAction={(svcType, action) =>
              handleServiceAction(selected.id, svcType, action)
            }
            onStartAll={() => handleStartAll(selected.id)}
            onSetup={() => handleSetup(selected.id)}
            onDeleteProject={() => handleDeleteProject(selected.id)}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            {projects.length === 0 && !isLoading
              ? "No projects. Add one to get started."
              : "Select a project."}
          </div>
        )}
      </div>

      <AddProjectDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={async (payload) => {
          try {
            const created = await mutations.addProject.mutateAsync(payload);
            setSelectedId(created.id);
            toast.success(`${payload.name} added${payload.autoStart ? " — starting services" : ""}`);
            setAddOpen(false);
          } catch (err) {
            toast.error(`Failed to add: ${err instanceof Error ? err.message : String(err)}`);
          }
        }}
      />
    </div>
  );
}

// ── ProjectDetail ──────────────────────────────────────────────────────────────
function ProjectDetail({
  project, backendOnline, onServiceAction, onStartAll, onSetup, onDeleteProject,
}: {
  project: ReturnType<typeof toUIProject>;
  backendOnline: boolean;
  onServiceAction: (type: "frontend" | "backend", action: "start" | "stop" | "restart") => void;
  onStartAll: () => void;
  onSetup: () => void;
  onDeleteProject: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="border-b border-border bg-background px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
          <Badge variant="outline" className="border-border bg-surface font-mono text-[10px]">
            {project.type}
          </Badge>
          <code className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-muted-foreground">
            <FolderOpen className="h-3 w-3" />
            {project.path}
          </code>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex-1">
        <div className="border-b border-border bg-background px-6">
          <TabsList className="h-11 bg-transparent p-0">
            {["overview", "logs", "env", "settings"].map((v) => (
              <TabsTrigger
                key={v}
                value={v}
                className="relative h-11 rounded-none border-b-2 border-transparent bg-transparent px-4 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {v === "env" ? "Environment Variables" : v[0].toUpperCase() + v.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="m-0 p-6">
          <OverviewTab
            project={project}
            backendOnline={backendOnline}
            onServiceAction={onServiceAction}
            onStartAll={onStartAll}
            onSetup={onSetup}
          />
        </TabsContent>
        <TabsContent value="logs" className="m-0 p-6">
          <LogsTab project={project} />
        </TabsContent>
        <TabsContent value="env" className="m-0 p-6">
          <EnvTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="settings" className="m-0 p-6">
          <SettingsTab project={project} onDelete={onDeleteProject} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── OverviewTab ────────────────────────────────────────────────────────────────
function OverviewTab({
  project, backendOnline, onServiceAction, onStartAll, onSetup,
}: {
  project: ReturnType<typeof toUIProject>;
  backendOnline: boolean;
  onServiceAction: (type: "frontend" | "backend", action: "start" | "stop" | "restart") => void;
  onStartAll: () => void;
  onSetup: () => void;
}) {
  const anyBusy = project.services.some((s) => s.status === "installing" || s.status === "starting");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!backendOnline || anyBusy}
          onClick={onStartAll}
          className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Play className="h-3 w-3 fill-current" /> Start All
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!backendOnline || anyBusy}
          onClick={onSetup}
          className="gap-1.5"
        >
          <Terminal className="h-3 w-3" /> Install Dependencies
        </Button>
        <p className="text-xs text-muted-foreground">
          DevHub auto-installs npm/pip dependencies before each start.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Services</h2>
          <p className="text-xs text-muted-foreground">Control individual processes for this project.</p>
        </div>
        <div className="divide-y divide-border">
          {project.services.map((svc) => (
            <ServiceRow
              key={svc.name}
              service={svc}
              disabled={!backendOnline}
              onAction={(action) => onServiceAction(svc.serviceType as "frontend" | "backend", action)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ServiceRow({
  service, disabled, onAction,
}: {
  service: Service & { serviceType?: string };
  disabled?: boolean;
  onAction: (a: "start" | "stop" | "restart") => void;
}) {
  const running = service.status === "running";
  const busy = service.status === "installing" || service.status === "starting";
  const [actionBusy, setActionBusy] = useState(false);

  const act = async (a: "start" | "stop" | "restart") => {
    setActionBusy(true);
    try { await onAction(a); } finally { setActionBusy(false); }
  };

  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-4">
      <div className="flex min-w-48 items-center gap-3">
        <StatusDot status={service.status} />
        <div>
          <p className="text-sm font-medium">{service.name}</p>
          <p className={cn("text-xs font-mono", statusTextClass[service.status])}>
            {running
              ? `running for ${formatUptime(service.uptimeMinutes)}`
              : statusLabel[service.status]}
          </p>
        </div>
      </div>

      <code className="rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-muted-foreground">
        :{service.port}
      </code>

      <div className="ml-auto flex items-center gap-2">
        {running ? (
          <Button size="sm" variant="outline" onClick={() => act("stop")} disabled={disabled || actionBusy} className="gap-1.5">
            {actionBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3 fill-current" />} Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => act("start")} disabled={disabled || actionBusy || busy} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
            {(actionBusy || busy) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 fill-current" />} Start
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => act("restart")} disabled={disabled || actionBusy || busy || !running} className="gap-1.5">
          <RotateCw className="h-3 w-3" /> Restart
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!running}
          onClick={() => window.open(`http://localhost:${service.port}`, "_blank")}
          className="gap-1.5"
        >
          <ExternalLink className="h-3 w-3" /> Open
        </Button>
      </div>
    </div>
  );
}

// ── LogsTab — real-time WebSocket ─────────────────────────────────────────────
function LogsTab({ project }: { project: ReturnType<typeof toUIProject> }) {
  const [activeService, setActiveService] = useState<"frontend" | "backend">(
    (project.services[0] as Service & { serviceType?: string }).serviceType as "frontend" | "backend" ?? "frontend"
  );
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { logs, connected, clear } = useLogStream(project.id, activeService);

  const filtered = filter
    ? logs.filter((l) => l.message.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-border bg-surface p-0.5">
          {project.services.map((s) => {
            const st = (s as Service & { serviceType?: string }).serviceType as "frontend" | "backend" ?? s.name.toLowerCase();
            return (
              <button
                key={s.name}
                onClick={() => setActiveService(st)}
                className={cn(
                  "rounded px-3 py-1 text-xs font-medium transition-colors",
                  activeService === st
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.name} logs
              </button>
            );
          })}
        </div>

        {/* Connection indicator */}
        <span className={cn("flex items-center gap-1 text-[10px] font-mono",
          connected ? "text-success" : "text-muted-foreground/60")}>
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full",
            connected ? "bg-success animate-pulse" : "bg-muted-foreground/50")} />
          {connected ? "live" : "connecting…"}
        </span>

        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter logs…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 bg-surface pl-8 font-mono text-xs"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={autoScroll} onCheckedChange={setAutoScroll} />
          Auto-scroll
        </label>

        <Button variant="outline" size="sm" onClick={clear} className="gap-1.5">
          <X className="h-3 w-3" /> Clear
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="h-[480px] overflow-y-auto rounded-lg border border-border bg-[oklch(0.12_0_0)] p-3 font-mono text-xs leading-relaxed"
      >
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {connected ? "Waiting for log output…" : "Connecting to log stream…"}
          </div>
        ) : (
          filtered.map((line) => <LogRow key={line.id} line={line} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ line }: { line: LogLine }) {
  const color =
    line.level === "error" ? "text-destructive"
    : line.level === "warn" ? "text-warning"
    : "text-foreground/85";
  return (
    <div className="flex gap-3 whitespace-pre-wrap break-all py-0.5">
      <span className="shrink-0 text-muted-foreground/60">{line.timestamp}</span>
      <span className={cn("shrink-0 uppercase", color)}>{line.level.padEnd(5)}</span>
      <span className={color}>{line.message}</span>
    </div>
  );
}

// ── EnvTab — real API ─────────────────────────────────────────────────────────
function EnvTab({ projectId }: { projectId: string }) {
  const { data: backendVars = [], isLoading } = useEnvVars(projectId);
  const saveEnvVars = useSaveEnvVars(projectId);

  const [rows, setRows] = useState<EnvVar[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState(false);

  // Sync from server on load
  useEffect(() => {
    setRows(backendVars);
    setDirty(false);
  }, [backendVars]);

  const update = (id: string, patch: Partial<EnvVar>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const remove = (id: string) => { setRows((rs) => rs.filter((r) => r.id !== id)); setDirty(true); };
  const add = () => {
    setRows((rs) => [...rs, { id: crypto.randomUUID(), key: "", value: "" }]);
    setDirty(true);
  };

  const save = async () => {
    try {
      await saveEnvVars.mutateAsync(rows.map(({ key, value }) => ({ key, value })));
      toast.success("Environment variables saved to disk");
      setDirty(false);
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading env vars…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="grid grid-cols-[1fr_2fr_auto] gap-2 border-b border-border bg-surface px-4 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Key</span>
          <span>Value</span>
          <span className="w-8" />
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            No environment variables. Click "Add Variable" to start.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.id} className="grid grid-cols-[1fr_2fr_auto] items-center gap-2 px-3 py-2">
                <Input
                  value={row.key}
                  onChange={(e) => update(row.id, { key: e.target.value })}
                  placeholder="KEY_NAME"
                  className="h-8 border-transparent bg-transparent font-mono text-xs focus-visible:border-input focus-visible:bg-surface"
                />
                <div className="relative">
                  <Input
                    type={revealed[row.id] ? "text" : "password"}
                    value={row.value}
                    onChange={(e) => update(row.id, { value: e.target.value })}
                    placeholder="value"
                    className="h-8 border-transparent bg-transparent pr-9 font-mono text-xs focus-visible:border-input focus-visible:bg-surface"
                  />
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [row.id]: !r[row.id] }))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {revealed[row.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => remove(row.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={add} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add Variable
        </Button>
        <div className="flex items-center gap-3">
          {dirty && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" />
              Unsaved changes — restart services to apply
            </p>
          )}
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || saveEnvVars.isPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saveEnvVars.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── SettingsTab ────────────────────────────────────────────────────────────────
function SettingsTab({
  project, onDelete,
}: {
  project: ReturnType<typeof toUIProject>;
  onDelete: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [isUpdating, setIsUpdating] = useState(false);
  const mutations = useProjectMutations();

  useEffect(() => {
    setName(project.name);
  }, [project.name]);

  const handleRename = async () => {
    if (name.trim() === project.name || !name.trim()) return;
    setIsUpdating(true);
    try {
      await mutations.updateProject.mutateAsync({ id: project.id, payload: { name: name.trim() } });
      toast.success("Project renamed successfully");
    } catch (err) {
      toast.error(`Failed to rename: ${err instanceof Error ? err.message : String(err)}`);
      setName(project.name); // Revert on failure
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold">General</h3>
        <Field label="Project Name">
          <div className="flex gap-2">
            <Input 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
              className="bg-surface" 
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
            />
            <Button 
              onClick={handleRename} 
              disabled={isUpdating || name.trim() === project.name || !name.trim()}
              className="shrink-0"
            >
              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </Field>
        <Field label="Folder Path">
          <Input value={project.path} readOnly className="bg-surface font-mono text-xs" />
        </Field>
        <p className="text-xs text-muted-foreground">
          To edit project metadata, update <code className="rounded bg-surface px-1">projects.json</code> in the devhub-server directory and restart the server.
        </p>
      </div>

      {project.services.map((svc) => (
        <div key={svc.name} className="space-y-4 rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold">{svc.name}</h3>
          <div className="grid grid-cols-[1fr_140px] gap-3">
            <Field label="Start Command">
              <Input value={svc.startCommand} readOnly className="bg-surface font-mono text-xs" />
            </Field>
            <Field label="Port">
              <Input value={String(svc.port)} readOnly className="bg-surface font-mono text-xs" />
            </Field>
          </div>
        </div>
      ))}

      <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-5">
        <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>
        <p className="text-xs text-muted-foreground">
          Deleting a project removes it from DevHub. Files on disk are not touched.
        </p>
        <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)} className="gap-1.5">
          <Trash2 className="h-3.5 w-3.5" /> Delete Project
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{project.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the project from DevHub. Files on disk remain untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ── AddProjectDialog — smart auto-detect ──────────────────────────────────────
function AddProjectDialog({
  open, onOpenChange, onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdd: (p: NewProjectPayload) => Promise<void>;
}) {
  const BLANK = {
    name: "", path: "",
    frontendCmd: "npm run dev", frontendPort: "5173", frontendCwd: ".",
    backendCmd: "npm start", backendPort: "3000", backendCwd: "server",
    envFile: "",
  };

  const [step, setStep] = useState<"path" | "review">("path");
  const [pathInput, setPathInput] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState("");
  const [portConflict, setPortConflict] = useState<Record<string, unknown> | null>(null);
  const [type, setType] = useState<NewProjectPayload["type"]>("mern");
  const [form, setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const [autoStart, setAutoStart] = useState(true);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      setStep("path");
      setPathInput("");
      setDetectError("");
      setPortConflict(null);
      setForm(BLANK);
      setType("mern");
      setAutoStart(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDetect = async () => {
    const p = pathInput.trim();
    if (!p) { setDetectError("Enter a folder path first"); return; }
    setDetecting(true);
    setDetectError("");
    try {
      const { detectProject } = await import("@/lib/api");
      const result = await detectProject(p);
      const fe = result.frontend;
      const be = result.backend;
      setType((result.type as NewProjectPayload["type"]) || "mern");
      setPortConflict((result as Record<string, unknown>).portConflict as Record<string, unknown> ?? null);
      setForm({
        name: result.name || p.split("/").pop() || "",
        path: p,
        frontendCmd:  fe?.cmd  || "npm run dev",
        frontendPort: String(fe?.port  || 5173),
        frontendCwd:  fe?.cwd  || ".",
        backendCmd:   be?.cmd  || "npm start",
        backendPort:  String(be?.port  || 3000),
        backendCwd:   be?.cwd  || "server",
        envFile:      result.envFilePath || "",
      });
      setStep("review");
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetecting(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim() || !form.path.trim()) {
      toast.error("Name and folder path are required");
      return;
    }
    setSubmitting(true);
    try {
      await onAdd({
        name: form.name.trim(),
        type,
        path: form.path.trim(),
        frontend: {
          cwd: form.frontendCwd || ".",
          cmd: form.frontendCmd,
          port: Number(form.frontendPort) || 5173,
        },
        backend: type === "mern"
          ? { cwd: form.backendCwd || ".", cmd: form.backendCmd, port: Number(form.backendPort) || 3000 }
          : null,
        envFilePath: form.envFile.trim() || null,
        autoStart,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Project</DialogTitle>
          <DialogDescription>
            {step === "path"
              ? "Paste the absolute path to your project folder — DevHub will detect everything automatically."
              : "Review the detected settings, tweak anything if needed, then add."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: path + detect ── */}
        {step === "path" && (
          <div className="space-y-4">
            <Field label="Project Folder Path">
              <div className="flex gap-2">
                <Input
                  value={pathInput}
                  onChange={(e) => { setPathInput(e.target.value); setDetectError(""); }}
                  placeholder="/Users/you/projects/my-app"
                  className="font-mono text-xs"
                  onKeyDown={(e) => e.key === "Enter" && handleDetect()}
                  autoFocus
                />
                <Button
                  onClick={handleDetect}
                  disabled={detecting || !pathInput.trim()}
                  className="shrink-0 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {detecting
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Search className="h-3.5 w-3.5" />}
                  {detecting ? "Detecting…" : "Detect"}
                </Button>
              </div>
            </Field>

            {detectError && (
              <p className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {detectError}
              </p>
            )}

            <div className="rounded-md border border-border bg-surface/50 px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">What gets auto-detected:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Project type (MERN / HTML / Other)</li>
                <li>Frontend &amp; backend sub-directories</li>
                <li>Start commands from <code className="rounded bg-surface px-1">package.json</code></li>
                <li>Ports from <code className="rounded bg-surface px-1">vite.config</code> / <code className="rounded bg-surface px-1">server.js</code></li>
                <li>Env file path (<code className="rounded bg-surface px-1">.env</code> / <code className="rounded bg-surface px-1">.env.local</code>)</li>
                <li>Dependency setup (npm / pnpm / yarn / pip / venv)</li>
              </ul>
            </div>
          </div>
        )}

        {/* ── Step 2: review ── */}
        {step === "review" && (
          <div className="space-y-4">
            {/* Detected badge */}
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              Auto-detected from <code className="font-mono">{form.path}</code>
              <button
                onClick={() => setStep("path")}
                className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Port conflict notice */}
            {portConflict && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Port conflict detected — ports were automatically reassigned.{" "}
                  {portConflict.service === "frontend" || portConflict.original ? (
                    <>Frontend: <code className="rounded bg-warning/20 px-1">{String(portConflict.original)}</code> → <code className="rounded bg-warning/20 px-1">{form.frontendPort}</code></>
                  ) : null}
                  {portConflict.backendOriginal ? (
                    <>, Backend: <code className="rounded bg-warning/20 px-1">{String(portConflict.backendOriginal)}</code> → <code className="rounded bg-warning/20 px-1">{form.backendPort}</code></>
                  ) : null}
                </span>
              </div>
            )}

            <div className="grid grid-cols-[1fr_140px] gap-3">
              <Field label="Project Name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Type">
                <Select value={type} onValueChange={(v) => setType(v as NewProjectPayload["type"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mern">MERN</SelectItem>
                    <SelectItem value="html">HTML</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {/* Frontend */}
            <div className="rounded-md border border-border bg-surface p-3 space-y-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Frontend</p>
              <div className="grid grid-cols-[70px_1fr_90px] gap-2">
                <Field label="Sub-dir">
                  <Input value={form.frontendCwd} onChange={(e) => setForm({ ...form, frontendCwd: e.target.value })} className="font-mono text-xs" />
                </Field>
                <Field label="Start Command">
                  <Input value={form.frontendCmd} onChange={(e) => setForm({ ...form, frontendCmd: e.target.value })} className="font-mono text-xs" />
                </Field>
                <Field label="Port">
                  <Input value={form.frontendPort} onChange={(e) => setForm({ ...form, frontendPort: e.target.value })} className="font-mono text-xs" />
                </Field>
              </div>
            </div>

            {/* Backend — only for mern */}
            {type === "mern" && (
              <div className="rounded-md border border-border bg-surface p-3 space-y-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Backend</p>
                <div className="grid grid-cols-[70px_1fr_90px] gap-2">
                  <Field label="Sub-dir">
                    <Input value={form.backendCwd} onChange={(e) => setForm({ ...form, backendCwd: e.target.value })} className="font-mono text-xs" />
                  </Field>
                  <Field label="Start Command">
                    <Input value={form.backendCmd} onChange={(e) => setForm({ ...form, backendCmd: e.target.value })} className="font-mono text-xs" />
                  </Field>
                  <Field label="Port">
                    <Input value={form.backendPort} onChange={(e) => setForm({ ...form, backendPort: e.target.value })} className="font-mono text-xs" />
                  </Field>
                </div>
              </div>
            )}

            <Field label="Env File (relative path, optional)">
              <Input value={form.envFile} onChange={(e) => setForm({ ...form, envFile: e.target.value })} placeholder="server/.env" className="font-mono text-xs" />
            </Field>

            <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Install &amp; start after adding</p>
                <p className="text-xs text-muted-foreground">Installs dependencies, starts backend then frontend.</p>
              </div>
              <Switch checked={autoStart} onCheckedChange={setAutoStart} />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {step === "path" ? (
            <Button
              onClick={handleDetect}
              disabled={detecting || !pathInput.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
            >
              {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {detecting ? "Detecting…" : "Detect Project"}
            </Button>
          ) : (
            <Button onClick={submit} disabled={submitting} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Add Project
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
