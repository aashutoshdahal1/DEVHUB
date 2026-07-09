/**
 * processManager.js
 * Spawns, stops, and restarts OS-level child processes for project services.
 * Auto-installs dependencies before starting. Emits log lines to logStream.
 */

"use strict";

const { spawn, execSync } = require("child_process");
const net = require("net");
const path = require("path");
const setupManager = require("./setupManager");

// processes: Map<string, ProcessBag>
const processes = new Map();
const logBuffers = new Map();
const LOG_BUFFER_SIZE = 200;

let _broadcast = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getKey(projectId, serviceType) {
  return `${projectId}:${serviceType}`;
}

function pushLog(projectId, serviceType, level, message) {
  const key = getKey(projectId, serviceType);
  const line = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    level,
    timestamp: new Date().toTimeString().slice(0, 8),
    message: message.trimEnd(),
  };
  if (!logBuffers.has(key)) logBuffers.set(key, []);
  const buf = logBuffers.get(key);
  buf.push(line);
  if (buf.length > LOG_BUFFER_SIZE) buf.shift();
  if (_broadcast) _broadcast(projectId, serviceType, line);
}

function createBag() {
  return {
    frontend: null,
    backend: null,
    frontendPort: null,
    backendPort: null,
    frontendPhase: "stopped",
    backendPhase: "stopped",
    frontendTask: null,
    backendTask: null,
  };
}

function getProcessBag(projectId) {
  if (!processes.has(projectId)) {
    processes.set(projectId, createBag());
  }
  return processes.get(projectId);
}

function setPhase(bag, serviceType, phase) {
  bag[`${serviceType}Phase`] = phase;
}

function getPhase(bag, serviceType) {
  if (bag[serviceType]) return "running";
  return bag[`${serviceType}Phase`] || "stopped";
}

function isBusy(bag, serviceType) {
  const phase = getPhase(bag, serviceType);
  return phase === "installing" || phase === "starting";
}

async function isPortListening(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (val) => {
      socket.destroy();
      resolve(val);
    };
    socket.setTimeout(800);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForPort(port, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return true;
    await sleep(500);
  }
  return false;
}

function buildEnv(project, serviceType) {
  const env = { ...process.env };
  if (serviceType === "frontend" && project.backend?.port) {
    env.DEVHUB_BACKEND_PORT = String(project.backend.port);
    env.CHATTERBOX_API_PORT = String(project.backend.port);
  }
  if (serviceType === "backend" && project.backend?.port) {
    env.PORT = String(project.backend.port);
  }
  return env;
}


function freePort(port) {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: "ignore" });
  } catch { /* nothing on that port */ }
}

function spawnServiceProcess(project, serviceType) {
  const bag = getProcessBag(project.id);
  const svcConfig = project[serviceType];
  const cwd = path.join(project.path, svcConfig.cwd || ".");

  if (svcConfig.port) freePort(svcConfig.port);
  pushLog(project.id, serviceType, "info", `▶ Starting: ${svcConfig.cmd} (cwd: ${cwd})`);

  const child = spawn(svcConfig.cmd, {
    cwd,
    env: buildEnv(project, serviceType),
    shell: true,
    detached: false,
  });

  bag[serviceType] = child;
  bag[`${serviceType}Port`] = svcConfig.port ?? null;

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (data) => {
    for (const line of data.split("\n")) {
      if (!line.trim()) continue;
      pushLog(project.id, serviceType, "info", line);
      const match = line.match(/http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)/i);
      if (match) bag[`${serviceType}Port`] = parseInt(match[1], 10);
    }
  });

  child.stderr.on("data", (data) => {
    for (const line of data.split("\n")) {
      if (line.trim()) pushLog(project.id, serviceType, "error", line);
    }
  });

  child.on("exit", (code, signal) => {
    bag[serviceType] = null;
    bag[`${serviceType}Port`] = null;
    setPhase(bag, serviceType, code === 0 ? "stopped" : "error");
    const msg =
      code !== null
        ? `Process exited with code ${code}`
        : `Process killed by signal ${signal}`;
    pushLog(project.id, serviceType, code === 0 ? "info" : "warn", `■ ${msg}`);
  });

  child.on("error", (err) => {
    bag[serviceType] = null;
    setPhase(bag, serviceType, "error");
    pushLog(project.id, serviceType, "error", `Process error: ${err.message}`);
  });

  setPhase(bag, serviceType, "running");
  return child;
}

async function runStartPipeline(project, serviceType) {
  const bag = getProcessBag(project.id);

  try {
    setPhase(bag, serviceType, "installing");
    pushLog(project.id, serviceType, "info", "▶ Checking dependencies…");

    await setupManager.setupService(project, serviceType, (level, msg) => {
      pushLog(project.id, serviceType, level, msg);
    });

    if (getPhase(bag, serviceType) === "stopped" && !bag[serviceType]) return;
    if (bag[serviceType]) return;

    setPhase(bag, serviceType, "starting");
    spawnServiceProcess(project, serviceType);

    const port = project[serviceType]?.port;
    if (port) {
      const ready = await waitForPort(port, 120_000);
      if (ready) {
        pushLog(project.id, serviceType, "info", `✓ Listening on port ${port}`);
      } else if (bag[serviceType]) {
        pushLog(project.id, serviceType, "warn", `Service started but port ${port} not confirmed yet`);
      }
    }
  } catch (err) {
    setPhase(bag, serviceType, "error");
    pushLog(project.id, serviceType, "error", `Setup/start failed: ${err.message}`);
  } finally {
    bag[`${serviceType}Task`] = null;
  }
}

function setBroadcast(fn) {
  _broadcast = fn;
}

function getLogBuffer(projectId, serviceType) {
  return logBuffers.get(getKey(projectId, serviceType)) || [];
}

function startService(project, serviceType) {
  const bag = getProcessBag(project.id);

  if (bag[serviceType]) {
    return { ok: false, reason: `${serviceType} is already running` };
  }
  if (isBusy(bag, serviceType)) {
    return { ok: false, reason: `${serviceType} is already starting` };
  }
  if (!project[serviceType]) {
    return { ok: false, reason: `No ${serviceType} config for this project` };
  }

  const task = runStartPipeline(project, serviceType);
  bag[`${serviceType}Task`] = task;

  return { ok: true };
}

async function startAllServices(project) {
  if (project.backend) {
    const backendResult = startService(project, "backend");
    if (!backendResult.ok) return backendResult;

    const bag = getProcessBag(project.id);
    while (isBusy(bag, "backend")) {
      await sleep(400);
    }
    if (getPhase(bag, "backend") === "error") {
      return { ok: false, reason: "Backend failed to start" };
    }
  }

  if (project.frontend) {
    return startService(project, "frontend");
  }

  return { ok: true };
}

async function setupProject(project) {
  const results = {};
  for (const type of ["backend", "frontend"]) {
    if (!project[type]) continue;
    pushLog(project.id, type, "info", `▶ Setting up ${type}…`);
    try {
      results[type] = await setupManager.setupService(project, type, (level, msg) => {
        pushLog(project.id, type, level, msg);
      });
    } catch (err) {
      results[type] = { ok: false, error: err.message };
      pushLog(project.id, type, "error", err.message);
    }
  }
  return { ok: true, results };
}

function stopService(projectId, serviceType) {
  const bag = getProcessBag(projectId);
  const child = bag[serviceType];

  if (!child && !isBusy(bag, serviceType)) {
    return { ok: false, reason: `${serviceType} is not running` };
  }

  pushLog(projectId, serviceType, "info", `■ Stopping ${serviceType}…`);

  if (child) {
    try {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => {
        if (bag[serviceType]) child.kill("SIGKILL");
      }, 5000);
      killTimer.unref();
    } catch (err) {
      return { ok: false, reason: err.message };
    }
    bag[serviceType] = null;
  }

  bag[`${serviceType}Task`] = null;
  setPhase(bag, serviceType, "stopped");
  bag[`${serviceType}Port`] = null;

  return { ok: true };
}

async function restartService(project, serviceType) {
  stopService(project.id, serviceType);
  await sleep(800);
  return startService(project, serviceType);
}

function getStatus(projectId) {
  const bag = getProcessBag(projectId);
  return {
    frontend: getPhase(bag, "frontend"),
    backend: getPhase(bag, "backend"),
    frontendPort: bag.frontendPort || null,
    backendPort: bag.backendPort || null,
  };
}

function stopAll() {
  for (const [projectId, bag] of processes.entries()) {
    for (const type of ["frontend", "backend"]) {
      if (bag[type] || isBusy(bag, type)) stopService(projectId, type);
    }
  }
}

module.exports = {
  setBroadcast,
  getLogBuffer,
  startService,
  startAllServices,
  setupProject,
  stopService,
  restartService,
  getStatus,
  stopAll,
};
