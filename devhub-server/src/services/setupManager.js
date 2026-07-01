/**
 * setupManager.js
 * Detects and installs project dependencies before services start.
 */

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Helpers ───────────────────────────────────────────────────────────────────

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function findRequirementsFile(dir) {
  for (const name of ["requirements.txt", "requirements-web.txt", "requirements-dev.txt"]) {
    if (exists(path.join(dir, name))) return name;
  }
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^requirements-.+\.txt$/.test(f)) return f;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getServiceDir(project, serviceType) {
  const svc = project[serviceType];
  if (!svc) return null;
  return path.join(project.path, svc.cwd || ".");
}

function detectPackageManager(dir) {
  if (exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (exists(path.join(dir, "yarn.lock"))) return "yarn";
  if (exists(path.join(dir, "bun.lockb")) || exists(path.join(dir, "bun.lock"))) return "bun";
  return "npm";
}

function isPythonService(dir) {
  if (exists(path.join(dir, "pyproject.toml"))) return true;
  if (findRequirementsFile(dir)) return true;
  for (const f of ["api_server.py", "main.py", "app.py", "server.py", "manage.py"]) {
    if (!exists(path.join(dir, f))) continue;
    try {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      if (/from fastapi|import fastapi|FastAPI\s*\(|from flask|import django/.test(src)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function isNodeService(dir) {
  return exists(path.join(dir, "package.json"));
}

function nodeModulesStale(dir) {
  const pkgPath = path.join(dir, "package.json");
  const nmPath = path.join(dir, "node_modules");
  if (!exists(nmPath)) return true;

  const pkgMtime = fs.statSync(pkgPath).mtimeMs;
  let nmMtime = fs.statSync(nmPath).mtimeMs;

  for (const lock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]) {
    const lockPath = path.join(dir, lock);
    if (exists(lockPath)) {
      nmMtime = Math.max(nmMtime, fs.statSync(lockPath).mtimeMs);
      if (fs.statSync(lockPath).mtimeMs > pkgMtime && fs.statSync(lockPath).mtimeMs > nmMtime - 1000) {
        return true;
      }
    }
  }

  return pkgMtime > nmMtime + 1000;
}

function pythonNeedsInstall(dir) {
  const venvDir = path.join(dir, "venv");
  if (!exists(venvDir)) return true;

  const markers = [
    path.join(dir, "pyproject.toml"),
    findRequirementsFile(dir) ? path.join(dir, findRequirementsFile(dir)) : null,
  ].filter(Boolean);

  const venvMtime = fs.statSync(venvDir).mtimeMs;
  for (const marker of markers) {
    if (exists(marker) && fs.statSync(marker).mtimeMs > venvMtime) return true;
  }

  // Verify pip can import uvicorn when this looks like a FastAPI app
  const reqFile = findRequirementsFile(dir);
  if (reqFile) {
    try {
      const reqs = fs.readFileSync(path.join(dir, reqFile), "utf8").toLowerCase();
      if (/fastapi|uvicorn/.test(reqs)) {
        const uvicornBin = path.join(venvDir, "bin", "uvicorn");
        if (!exists(uvicornBin)) return true;
      }
    } catch {
      return true;
    }
  }

  if (exists(path.join(dir, "pyproject.toml"))) {
    const pipShow = path.join(venvDir, "lib");
    if (!exists(pipShow)) return true;
  }

  return false;
}

function getNodeInstallCommand(dir) {
  const pm = detectPackageManager(dir);
  switch (pm) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
    default:
      return "npm install";
  }
}

function getPythonInstallCommands(dir) {
  const cmds = [];
  const activate = "source venv/bin/activate";
  const reqFile = findRequirementsFile(dir);

  if (!exists(path.join(dir, "venv"))) {
    cmds.push("python3 -m venv venv");
  }

  cmds.push(`bash -c "${activate} && pip install -U pip"`);

  if (exists(path.join(dir, "pyproject.toml"))) {
    cmds.push(`bash -c "${activate} && pip install -e ."`);
  }

  if (reqFile) {
    cmds.push(`bash -c "${activate} && pip install -r ${reqFile}"`);
  } else if (!exists(path.join(dir, "pyproject.toml"))) {
    cmds.push(`bash -c "${activate} && pip install fastapi 'uvicorn[standard]' python-multipart"`);
  }

  return cmds;
}

function describeSetupPlan(project, serviceType) {
  const dir = getServiceDir(project, serviceType);
  if (!dir || !exists(dir)) {
    return { needed: false, steps: [], reason: "Service directory not found" };
  }

  const steps = [];

  if (isNodeService(dir)) {
    if (nodeModulesStale(dir)) {
      steps.push({ kind: "node", cmd: getNodeInstallCommand(dir) });
    }
  }

  if (isPythonService(dir)) {
    if (pythonNeedsInstall(dir)) {
      for (const cmd of getPythonInstallCommands(dir)) {
        steps.push({ kind: "python", cmd });
      }
    }
  }

  return { needed: steps.length > 0, steps, dir };
}

function runCommand(cmd, cwd, onLine) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, { cwd, shell: true, env: process.env, detached: false });
    } catch (err) {
      reject(err);
      return;
    }

    const handleData = (data, level) => {
      for (const line of data.toString().split("\n")) {
        if (line.trim()) onLine(level, line);
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => handleData(d, "info"));
    child.stderr.on("data", (d) => handleData(d, "error"));

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (exit ${code}): ${cmd}`));
    });
  });
}

async function setupService(project, serviceType, onLine) {
  const plan = describeSetupPlan(project, serviceType);

  if (!plan.needed) {
    onLine("info", "✓ Dependencies up to date");
    return { ok: true, skipped: true };
  }

  onLine("info", `▶ Installing dependencies in ${plan.dir}`);

  for (const step of plan.steps) {
    onLine("info", `$ ${step.cmd}`);
    await runCommand(step.cmd, plan.dir, onLine);
  }

  onLine("info", "✓ Dependencies installed");
  return { ok: true, skipped: false };
}

async function setupProject(project, onLine) {
  const results = {};
  for (const type of ["backend", "frontend"]) {
    if (!project[type]) continue;
    onLine(type, "info", `── ${type} setup ──`);
    results[type] = await setupService(project, type, (level, msg) => onLine(type, level, msg));
  }
  return results;
}

module.exports = {
  describeSetupPlan,
  setupService,
  setupProject,
  getServiceDir,
  isNodeService,
  isPythonService,
};
