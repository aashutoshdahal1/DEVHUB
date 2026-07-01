/**
 * routes/projects.js
 * REST routes for project registry + process control.
 */

"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const { v4: uuidv4 } = require("uuid");
const pm = require("../services/processManager");

const router = express.Router();

// ── Path to the persisted project registry ────────────────────────────────────
const DATA_PATH = path.join(__dirname, "../data/projects.json");

// ── Registry helpers ──────────────────────────────────────────────────────────
async function readProjects() {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeProjects(projects) {
  await fs.writeFile(DATA_PATH, JSON.stringify(projects, null, 2), "utf8");
}

function withStatus(project) {
  const status = pm.getStatus(project.id);
  return { ...project, status };
}

// ── GET /api/projects ─────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const projects = await readProjects();
    res.json(projects.map(withStatus));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/projects/:id ─────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const projects = await readProjects();
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(withStatus(project));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/projects ────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { name, type, path: projectPath, frontend, backend, envFilePath } = req.body;
    if (!name || !projectPath) {
      return res.status(400).json({ error: "name and path are required" });
    }
    const projects = await readProjects();
    const newProject = {
      id: uuidv4(),
      name,
      type: type || "other",
      path: projectPath,
      frontend: frontend || null,
      backend: backend || null,
      envFilePath: envFilePath || null,
    };
    projects.push(newProject);
    await writeProjects(projects);

    if (req.body.autoStart) {
      pm.startAllServices(newProject).catch((err) => {
        console.error(`[projects] autoStart failed for ${newProject.id}:`, err.message);
      });
    }

    res.status(201).json(withStatus(newProject));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/projects/:id ─────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const projects = await readProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Project not found" });

    // Merge — never change the id
    projects[idx] = { ...projects[idx], ...req.body, id: projects[idx].id };
    await writeProjects(projects);
    res.json(withStatus(projects[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/projects/:id ──────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const projects = await readProjects();
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Project not found" });

    // Stop running services before removing
    pm.stopService(req.params.id, "frontend");
    pm.stopService(req.params.id, "backend");

    projects.splice(idx, 1);
    await writeProjects(projects);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/projects/:id/status ──────────────────────────────────────────────
router.get("/:id/status", async (req, res) => {
  try {
    res.json(pm.getStatus(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Service control helpers ───────────────────────────────────────────────────
async function resolveProject(id) {
  const projects = await readProjects();
  return projects.find((p) => p.id === id) || null;
}

// POST /api/projects/:id/services/:type/start
router.post("/:id/services/:type/start", async (req, res) => {
  try {
    const { id, type } = req.params;
    if (!["frontend", "backend"].includes(type)) {
      return res.status(400).json({ error: "type must be frontend or backend" });
    }
    const project = await resolveProject(id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const result = pm.startService(project, type);
    if (!result.ok) return res.status(409).json({ error: result.reason });
    res.json({ ok: true, status: pm.getStatus(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/services/:type/stop
router.post("/:id/services/:type/stop", async (req, res) => {
  try {
    const { id, type } = req.params;
    if (!["frontend", "backend"].includes(type)) {
      return res.status(400).json({ error: "type must be frontend or backend" });
    }
    const result = pm.stopService(id, type);
    if (!result.ok) return res.status(409).json({ error: result.reason });
    res.json({ ok: true, status: pm.getStatus(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/setup — install dependencies for all services
router.post("/:id/setup", async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const result = await pm.setupProject(project);
    res.json({ ...result, status: pm.getStatus(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/services/start-all — install deps + start backend then frontend
router.post("/:id/services/start-all", async (req, res) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const result = await pm.startAllServices(project);
    if (!result.ok) return res.status(409).json({ error: result.reason });
    res.json({ ok: true, status: pm.getStatus(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/projects/:id/services/:type/restart
router.post("/:id/services/:type/restart", async (req, res) => {
  try {
    const { id, type } = req.params;
    if (!["frontend", "backend"].includes(type)) {
      return res.status(400).json({ error: "type must be frontend or backend" });
    }
    const project = await resolveProject(id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const result = await pm.restartService(project, type);
    if (!result.ok) return res.status(500).json({ error: result.reason });
    res.json({ ok: true, status: pm.getStatus(id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
