/**
 * routes/env.js
 * Read and write .env files for a project.
 *
 * GET  /api/projects/:id/env  → [{ id, key, value }]
 * PUT  /api/projects/:id/env  → { ok: true }
 */

"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const { readEnvFile, writeEnvFile } = require("../services/envEditor");

const router = express.Router({ mergeParams: true }); // inherit :id from parent

const DATA_PATH = path.join(__dirname, "../data/projects.json");

async function findProject(id) {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    const projects = JSON.parse(raw);
    return projects.find((p) => p.id === id) || null;
  } catch {
    return null;
  }
}

function resolveEnvPath(project) {
  if (!project.envFilePath) return null;
  // envFilePath can be absolute or relative to project.path
  if (path.isAbsolute(project.envFilePath)) return project.envFilePath;
  return path.join(project.path, project.envFilePath);
}

// ── GET /api/projects/:id/env ─────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const project = await findProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const envPath = resolveEnvPath(project);
    if (!envPath) return res.json([]);

    const vars = await readEnvFile(envPath);
    res.json(vars);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/projects/:id/env ─────────────────────────────────────────────────
router.put("/", async (req, res) => {
  try {
    const project = await findProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const envPath = resolveEnvPath(project);
    if (!envPath) {
      return res.status(400).json({ error: "No envFilePath configured for this project" });
    }

    const vars = req.body; // [{ key, value }]
    if (!Array.isArray(vars)) {
      return res.status(400).json({ error: "Body must be an array of { key, value } objects" });
    }

    await writeEnvFile(envPath, vars);
    res.json({ ok: true, path: envPath, count: vars.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
