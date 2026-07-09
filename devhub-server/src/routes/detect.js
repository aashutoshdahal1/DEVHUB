/**
 * routes/detect.js
 * Auto-detect a project's type, commands, and ports from its folder structure.
 *
 * GET /api/detect?path=/absolute/path/to/project
 */

"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const net = require("net");
const setupManager = require("../services/setupManager");

const router = express.Router();

// ── Port helpers ──────────────────────────────────────────────────────────────

async function isPortFree(port) {
  const check = (host) => new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => { srv.close(); resolve(true); });
    if (host) srv.listen(port, host);
    else srv.listen(port);
  });

  // Must be free on IPv4 local, IPv6 local, and wildcard interfaces
  return (await check("127.0.0.1")) && (await check("::1")) && (await check());
}

/** Find the next free port starting from `start`, skipping `reserved` ports */
async function findFreePort(start, reserved = []) {
  let p = start;
  while (p < start + 20) {
    if (!reserved.includes(p) && await isPortFree(p)) return p;
    p++;
  }
  return start; // fallback
}

/** Inject --port flag into a backend start command */
function withBackendPort(cmd, port) {
  if (/--port\s+\d+/.test(cmd)) return cmd.replace(/--port\s+\d+/, `--port ${port}`);
  if (/runserver\s+\d+/.test(cmd)) return cmd.replace(/runserver\s+\d+/, `runserver ${port}`);
  return cmd;
}

/** Inject --port flag into a Vite/npm run command */
function withPort(cmd, port) {
  // npm run dev → npm run dev -- --port PORT
  if (/^npm run /.test(cmd)) return `${cmd} -- --port ${port}`;
  // npx vite → npx vite --port PORT
  if (/^npx /.test(cmd) || /^vite/.test(cmd)) return `${cmd} --port ${port}`;
  return cmd;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

/** Pick the best start command from a package.json scripts object */
function pickCmd(scripts = {}) {
  for (const key of ["dev", "start", "serve"]) {
    if (scripts[key]) return `npm run ${key}`;
  }
  return "npm start";
}

/** Extract the port Vite is configured to use — handles both top-level and server:{} nesting */
function detectVitePort(projectDir) {
  for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mjs"]) {
    const p = path.join(projectDir, name);
    if (!exists(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    // Matches: port: 8080  (top-level or nested inside server:{})
    const m = src.match(/\bport\s*:\s*(\d+)/);
    if (m) return Number(m[1]);
  }
  // Next.js default
  if (exists(path.join(projectDir, "next.config.ts")) || exists(path.join(projectDir, "next.config.js")) || exists(path.join(projectDir, "next.config.mjs"))) {
    return 3000;
  }
  return null;
}

/** Find a Python requirements file (requirements.txt, requirements-web.txt, etc.) */
function findRequirementsFile(dir) {
  for (const name of ["requirements.txt", "requirements-web.txt", "requirements-dev.txt"]) {
    if (exists(path.join(dir, name))) return name;
  }
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/^requirements-.+\.txt$/.test(f)) return f;
    }
  } catch { /* ignore */ }
  return null;
}

/** Infer backend port from Next.js rewrite rules (e.g. proxy to :8000) */
function detectNextProxyPort(rootDir, frontendCwd) {
  const feDir = frontendCwd && frontendCwd !== "."
    ? path.join(rootDir, frontendCwd)
    : rootDir;
  for (const name of ["next.config.ts", "next.config.js", "next.config.mjs"]) {
    const cfgPath = path.join(feDir, name);
    if (!exists(cfgPath)) continue;
    try {
      const src = fs.readFileSync(cfgPath, "utf8");
      const destMatch = src.match(/destination:\s*[`"']https?:\/\/[^`"']+:(\d+)/);
      if (destMatch) return Number(destMatch[1]);
      const fallbackMatch = src.match(/\?\?\s*["'](\d+)["']/);
      if (fallbackMatch) return Number(fallbackMatch[1]);
    } catch { /* ignore */ }
  }
  return null;
}

/** Detect a Python backend dir — returns config or null */
function detectPythonBackend(dir) {
  const reqName = findRequirementsFile(dir);
  let reqs = "";
  if (reqName) {
    try { reqs = fs.readFileSync(path.join(dir, reqName), "utf8").toLowerCase(); } catch { return null; }
  }

  const isFastAPI = /fastapi|uvicorn/.test(reqs);
  const isFlask   = /flask/.test(reqs);
  const isDjango  = /django/.test(reqs);

  // Find the main entry file
  let mainFile = null;
  for (const f of ["api_server.py", "main.py", "app.py", "server.py", "run.py", "manage.py"]) {
    if (exists(path.join(dir, f))) { mainFile = f; break; }
  }

  // FastAPI entry without requirements (e.g. api_server.py + pyproject.toml)
  const hasFastApiEntry = mainFile && exists(path.join(dir, mainFile)) && (() => {
    try {
      const src = fs.readFileSync(path.join(dir, mainFile), "utf8");
      return /from fastapi|import fastapi|FastAPI\s*\(/.test(src);
    } catch { return false; }
  })();

  if (!isFastAPI && !isFlask && !isDjango && !hasFastApiEntry) return null;
  if (!mainFile && !isDjango) return null;

  // Detect port from the main file or .env
  let port = 8000;
  if (mainFile) {
    try {
      const src = fs.readFileSync(path.join(dir, mainFile), "utf8");
      const m = src.match(/--port[=\s]+(\d+)/) || src.match(/port[=:\s]+(\d{4,5})/);
      if (m) port = Number(m[1]);
    } catch { /* ignore */ }
  }
  // .env PORT overrides
  for (const ef of [".env", ".env.local"]) {
    const ep = path.join(dir, ef);
    if (!exists(ep)) continue;
    const m = fs.readFileSync(ep, "utf8").match(/^PORT\s*=\s*(\d+)/m);
    if (m) { port = Number(m[1]); break; }
  }

  // Build start command
  let cmd;
  const usesVenv = exists(path.join(dir, "venv"));
  const pythonBin = usesVenv ? "venv/bin/python" : "python3";
  const srcLayout = exists(path.join(dir, "src"));
  const pyPathPrefix = srcLayout ? "PYTHONPATH=src " : "";
  if ((isFastAPI || hasFastApiEntry) && mainFile) {
    const module = mainFile.replace(".py", "");
    cmd = usesVenv
      ? `bash -c "source venv/bin/activate && ${pyPathPrefix}uvicorn ${module}:app --host 0.0.0.0 --port ${port} --reload"`
      : `${pyPathPrefix}uvicorn ${module}:app --host 0.0.0.0 --port ${port} --reload`;
  } else if (isDjango) {
    cmd = `${pythonBin} manage.py runserver ${port}`;
  } else {
    cmd = mainFile ? `${pythonBin} ${mainFile}` : `${pythonBin} app.py`;
  }

  return { cmd, port, lang: "python" };
}

/** Check whether a directory looks like a frontend */
function isFrontendDir(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  if (!pkg) return false;
  const scripts = Object.values(pkg.scripts || {}).join(" ");
  return (
    exists(path.join(dir, "vite.config.ts")) ||
    exists(path.join(dir, "vite.config.js")) ||
    exists(path.join(dir, "next.config.ts")) ||
    exists(path.join(dir, "next.config.js")) ||
    exists(path.join(dir, "next.config.mjs")) ||
    exists(path.join(dir, "index.html")) ||
    /vite|react-scripts|next|nuxt|angular/.test(scripts)
  );
}

/** Check whether a directory looks like a backend API */
function isBackendDir(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  if (!pkg) return false;
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  return (
    exists(path.join(dir, "server.js")) ||
    exists(path.join(dir, "app.js")) ||
    exists(path.join(dir, "index.js")) ||
    exists(path.join(dir, "src", "server.js")) ||
    exists(path.join(dir, "src", "app.js")) ||
    exists(path.join(dir, "src", "index.js")) ||
    "express" in deps ||
    "fastify" in deps ||
    "koa" in deps ||
    "hapi" in deps
  );
}

/** Detect backend port from server.js / .env */
function detectBackendPort(dir) {
  // Try .env first (most reliable)
  for (const envFile of [".env", ".env.local", ".env.development"]) {
    for (const sub of ["", "src"]) {
      const ep = path.join(dir, sub, envFile);
      if (!exists(ep)) continue;
      const m = fs.readFileSync(ep, "utf8").match(/^PORT\s*=\s*(\d+)/m);
      if (m) return Number(m[1]);
    }
  }
  // Try reading server.js / app.js / index.js (both root and src/)
  for (const sub of ["", "src"]) {
    for (const f of ["server.js", "app.js", "index.js"]) {
      const fp = path.join(dir, sub, f);
      if (!exists(fp)) continue;
      const src = fs.readFileSync(fp, "utf8");
      const m = src.match(/listen\s*\(\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{4,5})/);
      if (m) return Number(m[1]);
    }
  }
  return 3000;
}

// ── Main detection logic ──────────────────────────────────────────────────────

function detectProject(rootDir) {
  const result = {
    name: path.basename(rootDir),
    type: "other",
    path: rootDir,
    frontend: null,
    backend: null,
    envFilePath: null,
  };

  // ── 1. Plain HTML (no package.json at root, just an index.html) ────────────
  if (!exists(path.join(rootDir, "package.json")) && exists(path.join(rootDir, "index.html"))) {
    result.type = "html";
    result.frontend = { cwd: ".", cmd: "npx serve .", port: 8080 };
    return result;
  }

  const rootPkg = readJson(path.join(rootDir, "package.json"));

  // ── 1b. No package.json at root but exactly one subdir has one — treat that
  //        subdir as the effective root to avoid doubled cwd paths.
  if (!rootPkg) {
    try {
      const subdirs = fs.readdirSync(rootDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
        .filter(e => exists(path.join(rootDir, e.name, "package.json")));
      if (subdirs.length === 1) {
        return detectProject(path.join(rootDir, subdirs[0].name));
      }
    } catch { /* ignore */ }
  }

  // ── 2. Monorepo / MERN — scan sub-directories ─────────────────────────────
  const FRONTEND_NAMES = ["client", "frontend", "web", "app", "ui"];
  const BACKEND_NAMES  = ["server", "backend", "api", "service", "services"];

  // Check well-known sub-dir names first
  for (const name of FRONTEND_NAMES) {
    const sub = path.join(rootDir, name);
    if (exists(sub) && isFrontendDir(sub)) {
      const pkg = readJson(path.join(sub, "package.json"));
      const cmd = pickCmd(pkg?.scripts);
      const port = detectVitePort(sub) || 5173;
      result.frontend = { cwd: name, cmd, port };
      break;
    }
  }
  for (const name of BACKEND_NAMES) {
    const sub = path.join(rootDir, name);
    // Try JS backend first
    if (exists(sub) && isBackendDir(sub)) {
      const pkg = readJson(path.join(sub, "package.json"));
      const cmd = pickCmd(pkg?.scripts);
      const port = detectBackendPort(sub);
      result.backend = { cwd: name, cmd, port };
      for (const ef of [".env", ".env.local"]) {
        if (exists(path.join(sub, ef))) { result.envFilePath = path.join(name, ef); break; }
      }
      break;
    }
    // Try Python backend
    const pyConfig = exists(sub) ? detectPythonBackend(sub) : null;
    if (pyConfig) {
      result.backend = { cwd: name, cmd: pyConfig.cmd, port: pyConfig.port };
      for (const ef of [".env", ".env.local"]) {
        if (exists(path.join(sub, ef))) { result.envFilePath = path.join(name, ef); break; }
      }
      break;
    }
  }

  // ── 3. Also scan ALL sub-dirs for backend-like dirs (e.g. script-to-video-backend)
  // Only scan direct children of rootDir — never recurse into subdirs of subdirs,
  // which would produce doubled cwd paths like "subdir/subdir-backend".
  if (!result.backend) {
    // Build the set of dirs to scan: direct children of rootDir.
    // If a frontend subdir was detected, also scan inside that subdir for a co-located backend.
    const scanRoots = [{ base: rootDir, prefix: "" }];
    if (result.frontend && result.frontend.cwd && result.frontend.cwd !== ".") {
      scanRoots.push({
        base: path.join(rootDir, result.frontend.cwd),
        prefix: result.frontend.cwd + "/",
      });
    }

    outer:
    for (const { base, prefix } of scanRoots) {
      try {
        const entries = fs.readdirSync(base, { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "venv") continue;
          // Skip the dir that is already the frontend cwd to avoid treating it as a backend
          if (!prefix && result.frontend?.cwd === e.name) continue;
          const sub = path.join(base, e.name);
          const cwd = prefix + e.name;

          // JS backend
          if (isBackendDir(sub)) {
            const pkg = readJson(path.join(sub, "package.json"));
            const cmd = pickCmd(pkg?.scripts);
            const port = detectBackendPort(sub);
            result.backend = { cwd, cmd, port };
            for (const ef of [".env", ".env.local"]) {
              if (exists(path.join(sub, ef))) { result.envFilePath = path.join(cwd, ef); break; }
            }
            break outer;
          }

          // Python backend
          const pyConfig = detectPythonBackend(sub);
          if (pyConfig) {
            result.backend = { cwd, cmd: pyConfig.cmd, port: pyConfig.port };
            for (const ef of [".env", ".env.local"]) {
              if (exists(path.join(sub, ef))) { result.envFilePath = path.join(cwd, ef); break; }
            }
            break outer;
          }
        }
      } catch { /* ignore readdir errors */ }
    }
  }

  // ── 4. Root-level single-app (no sub-dirs detected) ───────────────────────
  if (!result.frontend && rootPkg) {
    if (isFrontendDir(rootDir)) {
      const cmd = pickCmd(rootPkg.scripts);
      const port = detectVitePort(rootDir) || 5173;
      result.frontend = { cwd: ".", cmd, port };
    } else if (isBackendDir(rootDir)) {
      const cmd = pickCmd(rootPkg.scripts);
      const port = detectBackendPort(rootDir);
      result.backend = { cwd: ".", cmd, port };
    }
  }
  // Root-level Python backend (e.g. api_server.py at repo root + web/ frontend)
  if (!result.backend) {
    const pyConfig = detectPythonBackend(rootDir);
    if (pyConfig) {
      const proxyPort = detectNextProxyPort(rootDir, result.frontend?.cwd);
      if (proxyPort) pyConfig.port = proxyPort;
      result.backend = { cwd: ".", cmd: pyConfig.cmd, port: pyConfig.port };
    }
  }


  // ── 5. Env file at root ────────────────────────────────────────────────────
  if (!result.envFilePath) {
    for (const ef of [".env", ".env.local", ".env.development"]) {
      if (exists(path.join(rootDir, ef))) {
        result.envFilePath = ef;
        break;
      }
    }
  }

  // ── 6. Determine type ──────────────────────────────────────────────────────
  if (result.frontend && result.backend) result.type = "mern";
  else if (result.frontend) result.type = "html";
  else if (result.backend) result.type = "other";

  return result;
}

// ── Route ─────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const projectPath = req.query.path;
  if (!projectPath || !path.isAbsolute(projectPath)) {
    return res.status(400).json({ error: "Provide an absolute ?path= query param" });
  }
  if (!exists(projectPath)) {
    return res.status(404).json({ error: `Path does not exist: ${projectPath}` });
  }
  try {
    const detected = detectProject(projectPath);

    // ── Resolve port conflicts ─────────────────────────────────────────────
    // Read already-registered projects to know which ports are taken
    let reservedPorts = [];
    try {
      const dataPath = path.join(__dirname, "../data/projects.json");
      const existing = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      for (const p of existing) {
        if (p.frontend?.port) reservedPorts.push(p.frontend.port);
        if (p.backend?.port)  reservedPorts.push(p.backend.port);
      }
    } catch { /* ignore */ }

    // DevHub server itself is on 3001, DevHub UI likely on 8080
    reservedPorts.push(3001);

    if (detected.frontend) {
      const orig = detected.frontend.port;
      const free = await findFreePort(orig, reservedPorts);
      if (free !== orig) {
        detected.frontend.cmd  = withPort(detected.frontend.cmd, free);
        detected.frontend.port = free;
        detected.portConflict  = { service: "frontend", original: orig, assigned: free };
      }
      reservedPorts.push(free);
    }

    if (detected.backend) {
      const orig = detected.backend.port;
      const free = await findFreePort(orig, reservedPorts);
      if (free !== orig) {
        detected.backend.cmd  = withBackendPort(detected.backend.cmd, free);
        detected.backend.port = free;
        detected.portConflict  = detected.portConflict
          ? { ...detected.portConflict, backendOriginal: orig, backendAssigned: free }
          : { service: "backend", original: orig, assigned: free };
      }
    }

    detected.setup = {};
    for (const type of ["frontend", "backend"]) {
      if (!detected[type]) continue;
      const plan = setupManager.describeSetupPlan(
        { path: projectPath, [type]: detected[type] },
        type
      );
      detected.setup[type] = {
        needsInstall: plan.needed,
        steps: plan.steps.map((s) => s.cmd),
      };
    }

    res.json(detected);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
